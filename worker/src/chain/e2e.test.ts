// End-to-end against a local validator that has iynk_passport loaded as an upgradeable
// program. Skipped unless CHAIN_E2E_RPC is set; see solana/README.md ("Worker end-to-end").
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { configAddress } from "@/lib/solana/passport";
import { enterRaceIx, getEntries, getRace, listRaces, raceAddress, splitPot } from "@/lib/solana/race";
import { createChainClient, type ChainEvent } from "./index";
import { watchProgramLogs } from "./watch";

const rpc = process.env.CHAIN_E2E_RPC;
const programId = new PublicKey(process.env.CHAIN_E2E_PROGRAM ?? "BYFLDTLNi946Z8jT4JnxgE8Cpzkr9ud7tSrnThFTv31w");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const FEE = 10_000_000;

test.skipIf(!rpc)("create, enter, submit, settle and mirror events on a local validator", async () => {
  const connection = new Connection(rpc!, "confirmed");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.CHAIN_E2E_ADMIN!, "utf8"))));
  const oracle = Keypair.generate();
  const players = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()];
  for (const k of [admin, oracle, ...players]) {
    await connection.confirmTransaction(await connection.requestAirdrop(k.publicKey, 3 * LAMPORTS_PER_SOL), "confirmed");
  }

  const init = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: configAddress(programId), isSigner: false, isWritable: true },
      { pubkey: PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER)[0], isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]), oracle.publicKey.toBuffer()]),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(init), [admin]);

  const events: ChainEvent[] = [];
  const stop = await watchProgramLogs(connection, programId, (e) => events.push(e));
  const chain = createChainClient({ rpcUrl: rpc!, programId, signer: oracle }, { connection });

  const raceId = BigInt(Date.now());
  const closesAt = Math.floor(Date.now() / 1000) + 8;
  const created = await chain.process({ id: 1, kind: "create_race", payload: { chainRaceId: raceId.toString(), course: "neon-loop", entryLamports: String(FEE), closesAt, seedLamports: "50000000" } });
  expect(created).toMatchObject({ status: "confirmed", pda: raceAddress(programId, raceId).toBase58() });
  expect((await chain.process({ id: 1, kind: "create_race", payload: { chainRaceId: raceId.toString(), course: "neon-loop", entryLamports: String(FEE), closesAt } })).sig).toBeUndefined();

  const race = raceAddress(programId, raceId);
  for (const p of players) await sendAndConfirmTransaction(connection, new Transaction().add(enterRaceIx(programId, race, p.publicKey)), [p]);

  const [a, b, c, d] = players.map((p) => p.publicKey.toBase58());
  const submit = (wallet: string, bestMs: number) => chain.process({ id: 2, kind: "submit_result", payload: { onchain: race.toBase58(), wallet, bestMs, lapId: "1" } });
  expect((await submit(b, 8000)).status).toBe("confirmed");
  expect((await submit(a, 9000)).status).toBe("confirmed");
  const dup = await submit(a, 9500);
  expect(dup).toMatchObject({ status: "confirmed" });
  expect(dup.sig).toBeUndefined();

  const before = await Promise.all(players.map((p) => connection.getBalance(p.publicKey)));
  // c is only in the settle ranking: settle submits the missing result itself. d never finished.
  const settled = await chain.process({
    id: 3,
    kind: "settle_race",
    payload: { onchain: race.toBase58(), ranking: [{ wallet: b, bestMs: 8000 }, { wallet: c, bestMs: 8500 }, { wallet: a, bestMs: 9000 }, { wallet: d, bestMs: null }] },
  });
  expect(settled.status, settled.error).toBe("confirmed");
  expect(settled.sig).toBeDefined();

  const pot = BigInt(50_000_000 + 4 * FEE);
  const [x, y, z] = splitPot(pot, 3);
  const after = await Promise.all(players.map((p) => connection.getBalance(p.publicKey)));
  expect(BigInt(after[1] - before[1])).toBe(x);
  expect(BigInt(after[2] - before[2])).toBe(y);
  expect(BigInt(after[0] - before[0])).toBe(z);
  expect(after[3]).toBe(before[3]);

  expect((await getRace(connection, programId, raceId))?.status).toBe("settled");
  expect((await listRaces(connection, programId)).some((r) => r.address === race.toBase58())).toBe(true);
  expect((await getEntries(connection, programId, race)).map((e) => e.lapMs)).toEqual([8000, 8500, 9000, 0]);
  expect((await chain.process({ id: 3, kind: "settle_race", payload: { onchain: race.toBase58() } })).status).toBe("confirmed");

  await new Promise((r) => setTimeout(r, 2000));
  const names = events.map((e) => e.event.name);
  expect(names.filter((n) => n === "RaceEntered")).toHaveLength(4);
  expect(names).toContain("ResultSubmitted");
  expect(names).toContain("RaceSettled");
  await stop();

  const cred = await chain.process({
    id: 4,
    kind: "issue_credential",
    payload: { wallet: a, skillId: "drone:quad5:safety", score: 88, replayHash: "cd".repeat(32) },
  });
  expect(cred.status, cred.error).toBe("confirmed");
  expect(cred.pda).toBeDefined();

  const empty = await chain.process({ id: 5, kind: "create_race", payload: { chainRaceId: String(raceId + BigInt(1)), course: "x", entryLamports: String(FEE), closesAt: closesAt + 5, seedLamports: "20000000" } });
  expect(empty.status).toBe("confirmed");
  const none = await chain.process({ id: 6, kind: "settle_race", payload: { onchain: empty.pda, ranking: [] } });
  expect(none.status, none.error).toBe("confirmed");
  expect((await getRace(connection, programId, raceId + BigInt(1)))?.status).toBe("cancelled");
}, 120_000);
