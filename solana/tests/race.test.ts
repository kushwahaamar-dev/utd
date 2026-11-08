import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { before, describe, it } from "node:test";

import type * as AnchorModule from "@coral-xyz/anchor";
import type { Keypair, PublicKey } from "@solana/web3.js";

import type { IynkPassport } from "../../src/lib/solana/idl/iynk_passport";

const anchor = createRequire(import.meta.url)("@coral-xyz/anchor") as typeof AnchorModule;
const { BN, web3 } = anchor;

const url = process.env.ANCHOR_PROVIDER_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) {
  throw new Error(`Refusing to run against "${url}". Run "npm test", which starts a local validator.`);
}

const connection = new web3.Connection(url, "confirmed");
const admin = web3.Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET ?? "", "utf8"))),
);
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const idl = JSON.parse(readFileSync(new URL("../target/idl/iynk_passport.json", import.meta.url), "utf8"));
const program = new anchor.Program<IynkPassport>(idl, provider);

const SOL = web3.LAMPORTS_PER_SOL;
const FEE = 10_000_000; // 0.01 SOL
const oracle = web3.Keypair.generate();
const track = [...createHash("sha256").update("track:neon-loop", "utf8").digest()];
let nextId = 1000;

const racePda = (id: number): PublicKey => {
  const idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(BigInt(id));
  return web3.PublicKey.findProgramAddressSync([Buffer.from("race"), idBytes], program.programId)[0];
};
const entryPda = (race: PublicKey, player: PublicKey): PublicKey =>
  web3.PublicKey.findProgramAddressSync([Buffer.from("entry"), race.toBuffer(), player.toBuffer()], program.programId)[0];
const hash = (text: string): number[] => [...createHash("sha256").update(text, "utf8").digest()];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const balance = (key: PublicKey) => connection.getBalance(key, "confirmed");

async function funded(sol = 1): Promise<Keypair> {
  const keypair = web3.Keypair.generate();
  await provider.sendAndConfirm(
    new web3.Transaction().add(
      web3.SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: keypair.publicKey, lamports: sol * SOL }),
    ),
  );
  return keypair;
}

async function fails(action: Promise<unknown>, expected: string): Promise<void> {
  await assert.rejects(action, (err: unknown) => {
    const e = err as { error?: { errorCode?: { code?: string } }; logs?: string[]; transactionLogs?: string[]; message?: string };
    const text = [e.error?.errorCode?.code, e.message, ...(e.logs ?? e.transactionLogs ?? [])].join("\n");
    assert.ok(text.includes(expected), `expected "${expected}" in:\n${text.slice(0, 2000)}`);
    return true;
  });
}

async function eventsOf(signature: string) {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  assert.ok(tx?.meta);
  const parser = new anchor.EventParser(program.programId, program.coder);
  return [...parser.parseLogs(tx.meta.logMessages ?? [])];
}

async function createRace(opts: { closesIn?: number; seed?: number; fee?: number; creator?: Keypair } = {}) {
  const id = nextId++;
  const creator = opts.creator ?? admin;
  const closesAt = Math.floor(Date.now() / 1000) + (opts.closesIn ?? 3600);
  const signature = await program.methods
    .createRace(new BN(id), new BN(opts.fee ?? FEE), track, new BN(closesAt), new BN(opts.seed ?? 0))
    .accounts({ creator: creator.publicKey })
    .signers(creator === admin ? [] : [creator])
    .rpc();
  return { id, race: racePda(id), signature, closesAt };
}

const enter = (race: PublicKey, player: Keypair) =>
  program.methods.enterRace().accountsPartial({ race, player: player.publicKey }).signers([player]).rpc();

const submit = (race: PublicKey, player: PublicKey, lap: number, signer: Keypair = oracle) =>
  program.methods
    .submitResult(lap, hash(`run:${player.toBase58()}:${lap}`))
    .accountsPartial({ race, player, authority: signer.publicKey })
    .signers([signer])
    .rpc();

function settle(race: PublicKey, winners: PublicKey[], signer: Keypair = oracle) {
  return program.methods
    .settle()
    .accountsPartial({ race, settler: signer.publicKey })
    .remainingAccounts(
      winners.flatMap((w) => [
        { pubkey: w, isWritable: true, isSigner: false },
        { pubkey: entryPda(race, w), isWritable: true, isSigner: false },
      ]),
    )
    .signers([signer])
    .rpc();
}

before(async () => {
  await provider.sendAndConfirm(
    new web3.Transaction().add(
      web3.SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: oracle.publicKey, lamports: 5 * SOL }),
    ),
  );
  await program.methods.setIssuer(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc();
});

describe("create_race", () => {
  it("stores the race and holds the seed", async () => {
    const { race, signature, closesAt } = await createRace({ seed: 50_000_000 });
    const state = await program.account.race.fetch(race);
    assert.ok(state.authority.equals(oracle.publicKey));
    assert.ok(state.creator.equals(admin.publicKey));
    assert.equal(state.entryLamports.toNumber(), FEE);
    assert.equal(state.closesAt.toNumber(), closesAt);
    assert.equal(state.pot.toNumber(), 50_000_000);
    assert.equal(state.entryCount, 0);
    assert.deepEqual(state.status, { open: {} });
    const info = await connection.getAccountInfo(race, "confirmed");
    assert.ok(info);
    assert.equal(info.lamports, (await connection.getMinimumBalanceForRentExemption(info.data.length)) + 50_000_000);
    const events = await eventsOf(signature);
    assert.deepEqual(events.map((e) => e.name), ["raceCreated"]);
  });

  it("refuses a past close time and a dust entry fee", async () => {
    await fails(
      program.methods.createRace(new BN(nextId++), new BN(FEE), track, new BN(1), new BN(0)).accounts({ creator: admin.publicKey }).rpc(),
      "ClosesInPast",
    );
    await fails(createRace({ fee: 1000 }), "EntryTooSmall");
  });

  it("refuses a reused race id", async () => {
    const { id } = await createRace();
    await fails(
      program.methods
        .createRace(new BN(id), new BN(FEE), track, new BN(Math.floor(Date.now() / 1000) + 100), new BN(0))
        .accounts({ creator: admin.publicKey })
        .rpc(),
      "already in use",
    );
  });
});

describe("enter_race", () => {
  it("moves the fee into the pot and counts the entrant", async () => {
    const { race } = await createRace();
    const a = await funded();
    const before = await balance(race);
    const sig = await enter(race, a);
    assert.equal((await balance(race)) - before, FEE);
    const state = await program.account.race.fetch(race);
    assert.equal(state.entryCount, 1);
    assert.equal(state.pot.toNumber(), FEE);
    const entry = await program.account.entry.fetch(entryPda(race, a.publicKey));
    assert.ok(entry.player.equals(a.publicKey));
    assert.equal(entry.lapMs, 0);
    assert.equal(entry.verified, false);
    assert.deepEqual((await eventsOf(sig)).map((e) => e.name), ["raceEntered"]);
  });

  it("allows one entry per player", async () => {
    const { race } = await createRace();
    const a = await funded();
    await enter(race, a);
    await fails(enter(race, a), "already in use");
  });

  it("refuses entries once the race has closed", async () => {
    const { race } = await createRace({ closesIn: 3 });
    await sleep(6000);
    await fails(enter(race, await funded()), "RaceClosed");
  });
});

describe("submit_result", () => {
  it("accepts only the oracle", async () => {
    const { race } = await createRace();
    const a = await funded();
    await enter(race, a);
    await fails(submit(race, a.publicKey, 9000, a), "NotOracle");
    await fails(submit(race, a.publicKey, 0), "InvalidLap");
  });

  it("refuses a player who never entered", async () => {
    const { race } = await createRace();
    const stranger = web3.Keypair.generate().publicKey;
    await assert.rejects(submit(race, stranger, 9000));
  });

  it("keeps each player's best lap and orders the podium", async () => {
    const { race } = await createRace();
    const [a, b, c, d] = await Promise.all([funded(), funded(), funded(), funded()]);
    for (const p of [a, b, c, d]) await enter(race, p);

    await submit(race, a.publicKey, 9000);
    await submit(race, b.publicKey, 8000);
    await submit(race, c.publicKey, 8500);
    await submit(race, d.publicKey, 9500); // fourth, off the podium
    let state = await program.account.race.fetch(race);
    assert.deepEqual(state.top3.map((p) => p.lapMs), [8000, 8500, 9000]);
    assert.ok(state.top3[0].player.equals(b.publicKey));

    const slower = await submit(race, b.publicKey, 12000); // worse than own best: ignored
    const [ev] = await eventsOf(slower);
    assert.equal((ev.data as { improved: boolean }).improved, false);
    assert.equal((await program.account.entry.fetch(entryPda(race, b.publicKey))).lapMs, 8000);

    const faster = await submit(race, d.publicKey, 7000);
    state = await program.account.race.fetch(race);
    assert.deepEqual(state.top3.map((p) => p.lapMs), [7000, 8000, 8500]);
    assert.ok(state.top3[0].player.equals(d.publicKey));
    const [ev2] = await eventsOf(faster);
    assert.equal((ev2.data as { rank: number }).rank, 0);
    const entry = await program.account.entry.fetch(entryPda(race, d.publicKey));
    assert.equal(entry.verified, true);
    assert.deepEqual(entry.runHash, hash(`run:${d.publicKey.toBase58()}:7000`));
  });
});

describe("settle", () => {
  it("refuses to settle before the race closes", async () => {
    const { race } = await createRace();
    const a = await funded();
    await enter(race, a);
    await submit(race, a.publicKey, 9000);
    await fails(settle(race, [a.publicKey]), "RaceNotClosed");
  });

  it("refuses with no verified result", async () => {
    const { race } = await createRace({ closesIn: 3 });
    await enter(race, await funded());
    await sleep(6000);
    await fails(settle(race, []), "NoFinishers");
  });

  it("pays 50/30/20 of the exact pot in one transaction, once", async () => {
    const sponsor = await funded();
    const { race } = await createRace({ closesIn: 4, seed: 100_000_000, creator: sponsor });
    const players = await Promise.all([funded(), funded(), funded(), funded()]);
    for (const p of players) await enter(race, p);
    const [p1, p2, p3, p4] = players;
    await submit(race, p2.publicKey, 8000);
    await submit(race, p3.publicKey, 8500);
    await submit(race, p1.publicKey, 9000);
    await submit(race, p4.publicKey, 9900);

    const pot = 100_000_000 + 4 * FEE;
    const before = await Promise.all([p2, p3, p1, p4].map((p) => balance(p.publicKey)));
    const raceBefore = await balance(race);
    await sleep(6000);

    const winners = [p2, p3, p1].map((p) => p.publicKey);
    await fails(settle(race, winners.slice(0, 2)), "BadPayoutAccounts");
    await fails(settle(race, [winners[1], winners[0], winners[2]]), "PayoutMismatch");
    await fails(settle(race, winners, sponsor), "SettleTooEarly");

    const sig = await settle(race, winners);
    const after = await Promise.all([p2, p3, p1, p4].map((p) => balance(p.publicKey)));
    assert.equal(after[0] - before[0], pot * 0.5);
    assert.equal(after[1] - before[1], pot * 0.3);
    assert.equal(after[2] - before[2], pot * 0.2);
    assert.equal(after[3], before[3]);
    assert.equal(raceBefore - (await balance(race)), pot);

    const state = await program.account.race.fetch(race);
    assert.deepEqual(state.status, { settled: {} });
    assert.equal(state.pot.toNumber(), 0);
    for (const w of winners) assert.equal((await program.account.entry.fetch(entryPda(race, w))).paid, true);

    const [ev] = await eventsOf(sig);
    assert.equal(ev.name, "raceSettled");
    const data = ev.data as { pot: BN; payouts: { player: PublicKey; amount: BN }[] };
    assert.equal(data.pot.toNumber(), pot);
    assert.deepEqual(data.payouts.map((p) => p.amount.toNumber()), [pot * 0.5, pot * 0.3, pot * 0.2]);

    await fails(settle(race, winners), "RaceFinished");
    await fails(submit(race, p1.publicKey, 5000), "RaceFinished");
  });

  it("gives a lone finisher the whole pot, and splits 5/8 and 3/8 between two", async () => {
    const solo = await createRace({ closesIn: 3 });
    const [a, b] = await Promise.all([funded(), funded()]);
    await enter(solo.race, a);
    await enter(solo.race, b);
    await submit(solo.race, a.publicKey, 9000);
    await sleep(6000);
    const beforeA = await balance(a.publicKey);
    await settle(solo.race, [a.publicKey]);
    assert.equal((await balance(a.publicKey)) - beforeA, 2 * FEE);

    const duo = await createRace({ closesIn: 3, seed: 1_000_001 });
    const [c, d] = await Promise.all([funded(), funded()]);
    await enter(duo.race, c);
    await enter(duo.race, d);
    await submit(duo.race, d.publicKey, 7000);
    await submit(duo.race, c.publicKey, 7500);
    await sleep(6000);
    const pot = 1_000_001 + 2 * FEE;
    const [bc, bd] = [await balance(c.publicKey), await balance(d.publicKey)];
    await settle(duo.race, [d.publicKey, c.publicKey]);
    const second = Math.floor((pot * 30) / 80);
    assert.equal((await balance(c.publicKey)) - bc, second);
    assert.equal((await balance(d.publicKey)) - bd, pot - second);
  });

  it("oracle close_race ends entries early and unlocks settling", async () => {
    const { race } = await createRace();
    const a = await funded();
    await enter(race, a);
    await program.methods.closeRace().accountsPartial({ race, authority: oracle.publicKey }).signers([oracle]).rpc();
    await fails(enter(race, await funded()), "RaceNotOpen");
    await submit(race, a.publicKey, 9000);
    await fails(program.methods.closeRace().accountsPartial({ race, authority: a.publicKey }).signers([a]).rpc(), "NotOracle");
    await settle(race, [a.publicKey]);
  });
});

describe("cancel_race and refund_entry", () => {
  it("returns the seed to the creator and each fee to its entrant", async () => {
    const sponsor = await funded();
    const { race } = await createRace({ seed: 30_000_000, creator: sponsor });
    const [a, b] = await Promise.all([funded(), funded()]);
    await enter(race, a);
    await enter(race, b);

    await fails(
      program.methods.cancelRace().accountsPartial({ race, creator: sponsor.publicKey, signer: a.publicKey }).signers([a]).rpc(),
      "NotOracle",
    );
    await fails(
      program.methods.cancelRace().accountsPartial({ race, creator: sponsor.publicKey, signer: sponsor.publicKey }).signers([sponsor]).rpc(),
      "NotCreator",
    );
    await fails(program.methods.refundEntry().accountsPartial({ race, player: a.publicKey }).signers([a]).rpc(), "RaceNotCancelled");

    const sponsorBefore = await balance(sponsor.publicKey);
    await program.methods
      .cancelRace()
      .accountsPartial({ race, creator: sponsor.publicKey, signer: oracle.publicKey })
      .signers([oracle])
      .rpc();
    assert.equal((await balance(sponsor.publicKey)) - sponsorBefore, 30_000_000);

    const beforeA = await balance(a.publicKey);
    await program.methods.refundEntry().accountsPartial({ race, player: a.publicKey }).signers([a]).rpc();
    assert.equal((await balance(a.publicKey)) - beforeA, FEE);
    await fails(program.methods.refundEntry().accountsPartial({ race, player: a.publicKey }).signers([a]).rpc(), "EntryAlreadyPaid");
    await program.methods.refundEntry().accountsPartial({ race, player: b.publicKey }).signers([b]).rpc();

    const info = await connection.getAccountInfo(race, "confirmed");
    assert.ok(info);
    assert.equal(info.lamports, await connection.getMinimumBalanceForRentExemption(info.data.length));
    assert.equal((await program.account.race.fetch(race)).pot.toNumber(), 0);
    await fails(enter(race, await funded()), "RaceNotOpen");
  });

  it("lets the creator cancel an empty race", async () => {
    const sponsor = await funded();
    const { race } = await createRace({ creator: sponsor, seed: 20_000_000 });
    await program.methods
      .cancelRace()
      .accountsPartial({ race, creator: sponsor.publicKey, signer: sponsor.publicKey })
      .signers([sponsor])
      .rpc();
    assert.deepEqual((await program.account.race.fetch(race)).status, { cancelled: {} });
  });
});
