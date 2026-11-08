// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "buffer";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, test } from "vitest";
import {
  ENTRY_ACCOUNT_SIZE,
  RACE_ACCOUNT_SIZE,
  RACE_DISCRIMINATORS,
  closeRaceIx,
  createRaceIx,
  decodeEntry,
  decodeRace,
  enterRaceIx,
  entryAddress,
  parseRaceEvents,
  raceAddress,
  settleIx,
  splitPot,
  submitResultIx,
} from "./race";
import { Writer } from "./passport";

const programId = Keypair.generate().publicKey;
const anchorDisc = (prefix: string) => [...createHash("sha256").update(prefix).digest().subarray(0, 8)];
const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const idl = JSON.parse(readFileSync(join(__dirname, "idl", "iynk_passport.json"), "utf8"));

test("discriminators match Anchor and the exported IDL", () => {
  const ixs = ["createRace", "enterRace", "submitResult", "closeRace", "settle", "cancelRace", "refundEntry"] as const;
  for (const ix of ixs) {
    expect(RACE_DISCRIMINATORS[ix]).toEqual(anchorDisc(`global:${snake(ix)}`));
    expect(idl.instructions.find((i: { name: string }) => i.name === snake(ix)).discriminator).toEqual(RACE_DISCRIMINATORS[ix]);
  }
  for (const acc of ["Race", "Entry"] as const) {
    expect(RACE_DISCRIMINATORS[acc]).toEqual(anchorDisc(`account:${acc}`));
    expect(idl.accounts.find((a: { name: string }) => a.name === acc).discriminator).toEqual(RACE_DISCRIMINATORS[acc]);
  }
  for (const ev of ["RaceCreated", "RaceEntered", "ResultSubmitted", "RaceSettled", "RaceCancelled", "EntryRefunded"] as const) {
    expect(RACE_DISCRIMINATORS[ev]).toEqual(anchorDisc(`event:${ev}`));
    expect(idl.events.find((e: { name: string }) => e.name === ev).discriminator).toEqual(RACE_DISCRIMINATORS[ev]);
  }
});

test("PDAs use the race and entry seeds", () => {
  const player = Keypair.generate().publicKey;
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(BigInt(77));
  const race = raceAddress(programId, 77);
  expect(race.equals(PublicKey.findProgramAddressSync([Buffer.from("race"), id], programId)[0])).toBe(true);
  expect(entryAddress(programId, race, player).equals(PublicKey.findProgramAddressSync([Buffer.from("entry"), race.toBuffer(), player.toBuffer()], programId)[0])).toBe(true);
});

describe("splitPot mirrors the program", () => {
  test("50/30/20 and renormalised splits", () => {
    expect(splitPot(BigInt(1000), 3)).toEqual([BigInt(500), BigInt(300), BigInt(200)]);
    expect(splitPot(BigInt(800), 2)).toEqual([BigInt(500), BigInt(300)]);
    expect(splitPot(BigInt(1000), 1)).toEqual([BigInt(1000)]);
  });
  test("always sums to the pot, first place takes the dust", () => {
    for (const pot of [BigInt(0), BigInt(1), BigInt(7), BigInt(1_000_003), BigInt("18446744073709551615")]) {
      for (const n of [1, 2, 3]) {
        const parts = splitPot(pot, n);
        expect(parts.reduce((a, b) => a + b, BigInt(0))).toBe(pot);
        expect(parts[0] >= parts[parts.length - 1]).toBe(true);
      }
    }
  });
});

function raceBytes(): Buffer {
  const w = new Writer().bytes(RACE_DISCRIMINATORS.Race).u64(BigInt(9));
  w.bytes(Keypair.generate().publicKey.toBuffer()).bytes(Keypair.generate().publicKey.toBuffer());
  w.u64(BigInt(10_000_000)).u64(BigInt(5)).bytes(new Uint8Array(32).fill(7)).i64(1_800_000_000).u8(2).u32(4);
  const first = Keypair.generate().publicKey;
  w.bytes(first.toBuffer()).u32(8123).bytes(new Uint8Array(32).fill(1));
  for (let i = 0; i < 2; i++) w.bytes(new Uint8Array(68));
  w.u64(BigInt(40_000_005)).i64(1_700_000_000).u8(254);
  const out = w.done();
  expect(out.length).toBe(RACE_ACCOUNT_SIZE);
  return out;
}

test("decodeRace reads the on-chain layout", () => {
  const race = decodeRace("addr", raceBytes());
  expect(race).toMatchObject({
    raceId: BigInt(9),
    entryLamports: BigInt(10_000_000),
    seedLamports: BigInt(5),
    closesAt: 1_800_000_000,
    status: "settled",
    entryCount: 4,
    potLamports: BigInt(40_000_005),
    createdAt: 1_700_000_000,
  });
  expect(race?.top3).toHaveLength(1);
  expect(race?.top3[0].lapMs).toBe(8123);
  expect(decodeRace("addr", Buffer.alloc(RACE_ACCOUNT_SIZE))).toBeNull();
});

test("decodeEntry reads the on-chain layout", () => {
  const race = Keypair.generate().publicKey;
  const player = Keypair.generate().publicKey;
  const data = new Writer().bytes(RACE_DISCRIMINATORS.Entry).bytes(race.toBuffer()).bytes(player.toBuffer()).u32(9000).bytes(new Uint8Array(32).fill(2)).u8(1).u8(0).u8(255).done();
  expect(data.length).toBe(ENTRY_ACCOUNT_SIZE);
  expect(decodeEntry("e", data)).toMatchObject({ race: race.toBase58(), player: player.toBase58(), lapMs: 9000, verified: true, paid: false });
});

test("instruction accounts and data", () => {
  const creator = Keypair.generate().publicKey;
  const create = createRaceIx({ programId, creator, raceId: BigInt(3), entryLamports: BigInt(10_000_000), trackHash: new Uint8Array(32), closesAt: 1_800_000_000, seedLamports: BigInt(1) });
  expect(create.data.length).toBe(8 + 8 + 8 + 32 + 8 + 8);
  expect(create.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([[false, false], [false, true], [true, true], [false, false]]);

  const race = raceAddress(programId, 3);
  const enter = enterRaceIx(programId, race, creator);
  expect(enter.keys[1].pubkey.equals(entryAddress(programId, race, creator))).toBe(true);

  const oracle = Keypair.generate().publicKey;
  const submit = submitResultIx({ programId, race, player: creator, oracle, lapMs: 8000, runHash: new Uint8Array(32) });
  expect(submit.data.readUInt32LE(8)).toBe(8000);
  expect(submit.keys[3]).toMatchObject({ isSigner: true, isWritable: false });

  const settle = settleIx(programId, race, oracle, [creator, oracle]);
  expect(settle.keys).toHaveLength(2 + 4);
  expect(settle.keys.slice(2).every((k, i) => k.isWritable === true && !k.isSigner && (i % 2 === 0 ? k.pubkey.equals(i === 0 ? creator : oracle) : true))).toBe(true);
  expect(closeRaceIx(programId, race, oracle).data.length).toBe(8);
});

test("parseRaceEvents decodes the program's event lines", () => {
  const race = Keypair.generate().publicKey;
  const player = Keypair.generate().publicKey;
  const line = (w: Writer) => `Program data: ${w.done().toString("base64")}`;
  const settled = new Writer().bytes(RACE_DISCRIMINATORS.RaceSettled).bytes(race.toBuffer()).u64(BigInt(1000)).u32(2);
  settled.bytes(player.toBuffer()).u64(BigInt(625)).bytes(race.toBuffer()).u64(BigInt(375));
  const submitted = new Writer().bytes(RACE_DISCRIMINATORS.ResultSubmitted).bytes(race.toBuffer()).bytes(player.toBuffer()).u32(7000).bytes(new Uint8Array(32)).u8(1).u8(255);
  const events = parseRaceEvents(["Program log: hi", line(submitted), line(settled), "Program data: AAAA"]);
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ name: "ResultSubmitted", lapMs: 7000, improved: true, rank: null });
  expect(events[1]).toMatchObject({ name: "RaceSettled", potLamports: BigInt(1000) });
  expect((events[1] as { payouts: unknown[] }).payouts).toHaveLength(2);
});
