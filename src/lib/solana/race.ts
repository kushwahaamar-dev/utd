import { Buffer } from "buffer";
import bs58 from "bs58";
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta, type Connection } from "@solana/web3.js";
import { Reader, Writer, body, configAddress, u64le } from "./passport";

// Race prize pools in iynk_passport. Same approach as passport.ts: the Anchor
// layouts are encoded by hand, so browsers and the worker need no Anchor.
// race.test.ts checks every discriminator and layout against the exported IDL.

export const RACE_DISCRIMINATORS = {
  createRace: [233, 107, 148, 159, 241, 155, 226, 54],
  enterRace: [242, 118, 55, 253, 83, 235, 115, 31],
  submitResult: [240, 42, 89, 180, 10, 239, 9, 214],
  closeRace: [43, 141, 231, 200, 195, 209, 100, 140],
  settle: [175, 42, 185, 87, 144, 131, 102, 212],
  cancelRace: [223, 214, 232, 232, 43, 15, 165, 234],
  refundEntry: [214, 5, 136, 23, 253, 7, 230, 81],
  Race: [114, 93, 186, 119, 99, 123, 162, 192],
  Entry: [63, 18, 152, 113, 215, 246, 221, 250],
  RaceCreated: [92, 229, 121, 9, 205, 210, 225, 9],
  RaceEntered: [225, 152, 64, 182, 188, 220, 210, 240],
  ResultSubmitted: [156, 153, 163, 89, 245, 144, 63, 94],
  RaceSettled: [182, 88, 145, 67, 233, 56, 43, 181],
  RaceCancelled: [211, 217, 124, 48, 45, 246, 250, 44],
  RacePayout: [79, 103, 209, 68, 254, 249, 217, 178],
  EntryRefunded: [34, 82, 130, 116, 93, 139, 188, 234],
} as const;

export const RACE_STATUSES = ["open", "closed", "settled", "cancelled"] as const;
export type RaceStatus = (typeof RACE_STATUSES)[number];

/** Prize split in percent for first, second and third. Mirrors PRIZE_WEIGHTS in the program. */
export const PRIZE_WEIGHTS = [50, 30, 20] as const;
/** Seconds after `closesAt` during which only the oracle may settle. */
export const SETTLE_GRACE_SECS = 3600;

export type Placing = { player: string; lapMs: number; runHash: string };

export type Race = {
  address: string;
  raceId: bigint;
  authority: string;
  creator: string;
  entryLamports: bigint;
  seedLamports: bigint;
  trackHash: string;
  closesAt: number;
  status: RaceStatus;
  entryCount: number;
  /** Podium in rank order; only finishers are present. */
  top3: Placing[];
  potLamports: bigint;
  createdAt: number;
};

export type Entry = {
  address: string;
  race: string;
  player: string;
  lapMs: number;
  runHash: string;
  verified: boolean;
  paid: boolean;
};

export type RaceEvent =
  | { name: "RaceCreated"; race: string; raceId: bigint; creator: string; entryLamports: bigint; seedLamports: bigint; trackHash: string; closesAt: number }
  | { name: "RaceEntered"; race: string; player: string; entryCount: number; potLamports: bigint }
  | { name: "ResultSubmitted"; race: string; player: string; lapMs: number; runHash: string; improved: boolean; rank: number | null }
  | { name: "RaceSettled"; race: string; potLamports: bigint; payouts: { player: string; lamports: bigint }[] }
  | { name: "RaceCancelled"; race: string; refundableLamports: bigint }
  | { name: "EntryRefunded"; race: string; player: string; lamports: bigint };

/* ---------- PDAs ---------- */

export function raceAddress(programId: PublicKey, raceId: bigint | number): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("race"), u64le(BigInt(raceId))], programId)[0];
}

export function entryAddress(programId: PublicKey, race: PublicKey, player: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("entry"), race.toBuffer(), player.toBuffer()], programId)[0];
}

/* ---------- prize math ---------- */

/**
 * Splits `pot` between 1 to 3 finishers by the 50/30/20 weights renormalised
 * over the places that exist. First place takes the rounding dust. Always sums to `pot`.
 */
export function splitPot(pot: bigint, finishers: number): bigint[] {
  const n = Math.min(3, Math.max(1, finishers));
  const weights = PRIZE_WEIGHTS.slice(0, n).map(BigInt);
  const total = weights.reduce((a, b) => a + b, BigInt(0));
  const out = weights.map((w, i) => (i === 0 ? BigInt(0) : (pot * w) / total));
  out[0] = pot - out.reduce((a, b) => a + b, BigInt(0));
  return out;
}

/** Smallest entry fee the program accepts, given the rent-exempt minimum of an empty account. */
export const minEntryLamports = (rentFloorEmpty: bigint | number) => BigInt(rentFloorEmpty) * BigInt(2);

/* ---------- accounts ---------- */

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

export const RACE_OFFSETS = { raceCreator: 40, entryRace: 8, entryPlayer: 40 } as const;
export const RACE_ACCOUNT_SIZE = 8 + 354;
export const ENTRY_ACCOUNT_SIZE = 8 + 103;

export function decodeRace(address: string, data: Uint8Array): Race | null {
  const r = body(data, RACE_DISCRIMINATORS.Race);
  if (!r) return null;
  const raceId = r.u64();
  const authority = r.pubkey();
  const creator = r.pubkey();
  const entryLamports = r.u64();
  const seedLamports = r.u64();
  const trackHash = r.hash();
  const closesAt = r.i64();
  const status = RACE_STATUSES[r.u8()];
  const entryCount = r.u32();
  const top3: Placing[] = [];
  for (let i = 0; i < 3; i++) {
    const player = r.pubkey();
    const lapMs = r.u32();
    const runHash = r.hash();
    if (lapMs > 0) top3.push({ player, lapMs, runHash });
  }
  if (!status) return null;
  return {
    address,
    raceId,
    authority,
    creator,
    entryLamports,
    seedLamports,
    trackHash,
    closesAt,
    status,
    entryCount,
    top3,
    potLamports: r.u64(),
    createdAt: r.i64(),
  };
}

export function decodeEntry(address: string, data: Uint8Array): Entry | null {
  const r = body(data, RACE_DISCRIMINATORS.Entry);
  if (!r) return null;
  return {
    address,
    race: r.pubkey(),
    player: r.pubkey(),
    lapMs: r.u32(),
    runHash: r.hash(),
    verified: r.bool(),
    paid: r.bool(),
  };
}

/* ---------- instructions ---------- */

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta => ({ pubkey, isSigner, isWritable });

export type CreateRaceArgs = {
  programId: PublicKey;
  creator: PublicKey;
  raceId: bigint;
  entryLamports: bigint;
  trackHash: Uint8Array;
  closesAt: number;
  seedLamports: bigint;
};

export function createRaceIx(a: CreateRaceArgs): TransactionInstruction {
  const data = new Writer()
    .bytes(RACE_DISCRIMINATORS.createRace)
    .u64(a.raceId)
    .u64(a.entryLamports)
    .bytes(a.trackHash)
    .i64(a.closesAt)
    .u64(a.seedLamports)
    .done();
  return new TransactionInstruction({
    programId: a.programId,
    keys: [
      meta(configAddress(a.programId), false, false),
      meta(raceAddress(a.programId, a.raceId), false, true),
      meta(a.creator, true, true),
      meta(SystemProgram.programId, false, false),
    ],
    data,
  });
}

export function enterRaceIx(programId: PublicKey, race: PublicKey, player: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(race, false, true),
      meta(entryAddress(programId, race, player), false, true),
      meta(player, true, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.from(RACE_DISCRIMINATORS.enterRace),
  });
}

export function submitResultIx(a: {
  programId: PublicKey;
  race: PublicKey;
  player: PublicKey;
  oracle: PublicKey;
  lapMs: number;
  runHash: Uint8Array;
}): TransactionInstruction {
  const data = new Writer().bytes(RACE_DISCRIMINATORS.submitResult).u32(a.lapMs).bytes(a.runHash).done();
  return new TransactionInstruction({
    programId: a.programId,
    keys: [
      meta(a.race, false, true),
      meta(entryAddress(a.programId, a.race, a.player), false, true),
      meta(a.player, false, false),
      meta(a.oracle, true, false),
    ],
    data,
  });
}

export function closeRaceIx(programId: PublicKey, race: PublicKey, oracle: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(race, false, true), meta(oracle, true, false)],
    data: Buffer.from(RACE_DISCRIMINATORS.closeRace),
  });
}

/** `winners` is the podium in rank order, as stored on the race. */
export function settleIx(programId: PublicKey, race: PublicKey, settler: PublicKey, winners: readonly PublicKey[]): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [
      meta(race, false, true),
      meta(settler, true, false),
      ...winners.flatMap((w) => [meta(w, false, true), meta(entryAddress(programId, race, w), false, true)]),
    ],
    data: Buffer.from(RACE_DISCRIMINATORS.settle),
  });
}

export function cancelRaceIx(programId: PublicKey, race: PublicKey, creator: PublicKey, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(race, false, true), meta(creator, false, true), meta(signer, true, false)],
    data: Buffer.from(RACE_DISCRIMINATORS.cancelRace),
  });
}

export function refundEntryIx(programId: PublicKey, race: PublicKey, player: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [meta(race, false, true), meta(entryAddress(programId, race, player), false, true), meta(player, true, true)],
    data: Buffer.from(RACE_DISCRIMINATORS.refundEntry),
  });
}

/* ---------- events ---------- */

/** Race events from a transaction's log lines ("Program data: <base64>"). */
export function parseRaceEvents(logs: readonly string[]): RaceEvent[] {
  const events: RaceEvent[] = [];
  for (const line of logs) {
    const m = /^Program data: ([A-Za-z0-9+/=]+)$/.exec(line);
    if (!m) continue;
    const data = Buffer.from(m[1], "base64");
    try {
      const event = decodeRaceEvent(data);
      if (event) events.push(event);
    } catch {
      // Another program's data line, or a truncated one: not ours.
    }
  }
  return events;
}

function decodeRaceEvent(data: Buffer): RaceEvent | null {
  const D = RACE_DISCRIMINATORS;
  let r: Reader | null;
  if ((r = body(data, D.RaceCreated))) {
    return { name: "RaceCreated", race: r.pubkey(), raceId: r.u64(), creator: r.pubkey(), entryLamports: r.u64(), seedLamports: r.u64(), trackHash: r.hash(), closesAt: r.i64() };
  }
  if ((r = body(data, D.RaceEntered))) {
    return { name: "RaceEntered", race: r.pubkey(), player: r.pubkey(), entryCount: r.u32(), potLamports: r.u64() };
  }
  if ((r = body(data, D.ResultSubmitted))) {
    const race = r.pubkey();
    const player = r.pubkey();
    const lapMs = r.u32();
    const runHash = r.hash();
    const improved = r.bool();
    const rank = r.u8();
    return { name: "ResultSubmitted", race, player, lapMs, runHash, improved, rank: rank === 255 ? null : rank };
  }
  if ((r = body(data, D.RaceSettled))) {
    const race = r.pubkey();
    const potLamports = r.u64();
    const count = r.u32();
    const payouts: { player: string; lamports: bigint }[] = [];
    for (let i = 0; i < count; i++) payouts.push({ player: r.pubkey(), lamports: r.u64() });
    return { name: "RaceSettled", race, potLamports, payouts };
  }
  if ((r = body(data, D.RaceCancelled))) return { name: "RaceCancelled", race: r.pubkey(), refundableLamports: r.u64() };
  if ((r = body(data, D.EntryRefunded))) return { name: "EntryRefunded", race: r.pubkey(), player: r.pubkey(), lamports: r.u64() };
  return null;
}

/* ---------- reads ---------- */

const tag = (discriminator: readonly number[]) => ({ memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(discriminator)) } });

export async function getRace(connection: Connection, programId: PublicKey, raceId: bigint | number): Promise<Race | null> {
  const address = raceAddress(programId, raceId);
  const info = await connection.getAccountInfo(address);
  if (!info || !info.owner.equals(programId)) return null;
  return decodeRace(address.toBase58(), info.data);
}

/** Every race, newest first. */
export async function listRaces(connection: Connection, programId: PublicKey): Promise<Race[]> {
  const accounts = await connection.getProgramAccounts(programId, { filters: [tag(RACE_DISCRIMINATORS.Race)] });
  return accounts
    .map(({ pubkey, account }) => decodeRace(pubkey.toBase58(), account.data))
    .filter((r): r is Race => r !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Every entry of a race, best lap first (entrants without a result last). */
export async function getEntries(connection: Connection, programId: PublicKey, race: PublicKey): Promise<Entry[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [tag(RACE_DISCRIMINATORS.Entry), { memcmp: { offset: RACE_OFFSETS.entryRace, bytes: race.toBase58() } }],
  });
  return accounts
    .map(({ pubkey, account }) => decodeEntry(pubkey.toBase58(), account.data))
    .filter((e): e is Entry => e !== null)
    .sort((a, b) => (a.lapMs || Infinity) - (b.lapMs || Infinity));
}
