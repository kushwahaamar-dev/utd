import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, test } from "vitest";
import { isDevnetUrl, loadChainConfig, parseKeypair } from "./config";
import { describeError } from "./client";
import { entryResultFromEvent, fallbackRunHash, mirrorStatus, trackHashOf, upsertRaceArgs } from "./mirror";
import { createRacePayload, issueCredentialPayload, parsePayload, settleRacePayload, submitResultPayload } from "./payloads";
import { eventsFromLogs } from "./watch";
import { RACE_DISCRIMINATORS, type Race } from "@/lib/solana/race";
import { Writer } from "@/lib/solana/passport";

const wallet = Keypair.generate().publicKey.toBase58();
const hex = "ab".repeat(32);

describe("keypair parsing", () => {
  const kp = Keypair.generate();
  test("reads a JSON array and base58", () => {
    expect(parseKeypair(JSON.stringify([...kp.secretKey])).publicKey.equals(kp.publicKey)).toBe(true);
    expect(parseKeypair(bs58.encode(kp.secretKey)).publicKey.equals(kp.publicKey)).toBe(true);
  });
  test("rejects the wrong length without echoing the value", () => {
    expect(() => parseKeypair("[1,2,3]")).toThrow(/64-byte/);
  });
  test("loadChainConfig names what is missing", () => {
    expect(() => loadChainConfig({})).toThrow(/SOLANA_ISSUER_KEYPAIR is not set/);
    const key = bs58.encode(kp.secretKey);
    expect(() => loadChainConfig({ SOLANA_ISSUER_KEYPAIR: key })).toThrow(/PROGRAM_ID/);
    const ok = loadChainConfig({ SOLANA_ISSUER_KEYPAIR: key, NEXT_PUBLIC_SOLANA_PROGRAM_ID: Keypair.generate().publicKey.toBase58() });
    expect(ok.rpcUrl).toBe("https://api.devnet.solana.com");
    expect(() => loadChainConfig({ SOLANA_ISSUER_KEYPAIR: "0OIl", SOLANA_PROGRAM_ID: Keypair.generate().publicKey.toBase58() })).toThrow(/could not be read/);
  });
});

describe("payloads", () => {
  test("issue_credential", () => {
    expect(parsePayload(issueCredentialPayload, JSON.stringify({ wallet, skillId: "drone:quad5:safety", score: 90, replayHash: hex })).ok).toBe(true);
    const bad = parsePayload(issueCredentialPayload, { wallet: "x", skillId: "a", score: 1, replayHash: hex });
    expect(bad).toMatchObject({ ok: false });
    expect(parsePayload(issueCredentialPayload, "{nope")).toEqual({ ok: false, error: "payload is not JSON" });
  });
  test("submit_result takes the module's shape", () => {
    const ok = parsePayload(submitResultPayload, { raceId: "4", onchain: Keypair.generate().publicKey.toBase58(), entryId: "7", wallet, bestMs: 8123, lapId: "12" });
    expect(ok.ok).toBe(true);
    expect(parsePayload(submitResultPayload, { onchain: wallet, wallet, bestMs: 0 }).ok).toBe(false);
  });
  test("settle_race tolerates an empty ranking and null times", () => {
    const onchain = Keypair.generate().publicKey.toBase58();
    expect(parsePayload(settleRacePayload, { onchain })).toMatchObject({ ok: true, data: { ranking: [] } });
    expect(parsePayload(settleRacePayload, { onchain, ranking: [{ entryId: "1", wallet, bestMs: null }] }).ok).toBe(true);
  });
  test("create_race coerces u64 strings", () => {
    const r = parsePayload(createRacePayload, { course: "neon", entryLamports: "10000000", closesAt: Math.floor(Date.now() / 1000) + 3600 });
    expect(r).toMatchObject({ ok: true, data: { entryLamports: BigInt(10_000_000), seedLamports: BigInt(0) } });
    expect(parsePayload(createRacePayload, { course: "", entryLamports: 1, closesAt: 1 }).ok).toBe(false);
  });
});

describe("mirroring", () => {
  const race: Race = {
    address: "R",
    raceId: BigInt(1),
    authority: "a",
    creator: "c",
    entryLamports: BigInt(10),
    seedLamports: BigInt(0),
    trackHash: hex,
    closesAt: 1_800_000_000,
    status: "cancelled",
    entryCount: 0,
    top3: [],
    potLamports: BigInt(55),
    createdAt: 0,
  };
  test("cancelled shows as closed; closes_at becomes a Date", () => {
    expect(mirrorStatus("cancelled")).toBe("closed");
    expect(upsertRaceArgs(race)).toEqual({ onchain: "R", entryLamports: BigInt(10), potLamports: BigInt(55), closesAt: new Date(1_800_000_000_000), status: "closed" });
  });
  test("only an improving ResultSubmitted updates an entry", () => {
    const base = { name: "ResultSubmitted", race: "R", player: wallet, lapMs: 9000, runHash: hex, rank: 0 } as const;
    expect(entryResultFromEvent({ ...base, improved: true }, "sig")).toMatchObject({ wallet, bestMs: 9000, verified: true, resultSig: "sig" });
    expect(entryResultFromEvent({ ...base, improved: false }, "sig")).toBeNull();
  });
  test("hashes are stable 32-byte values", () => {
    expect(trackHashOf("neon-loop")).toHaveLength(32);
    expect(Buffer.from(trackHashOf("a")).equals(Buffer.from(trackHashOf("a")))).toBe(true);
    expect(Buffer.from(fallbackRunHash(wallet, 1, "2")).equals(Buffer.from(fallbackRunHash(wallet, 2, "2")))).toBe(false);
  });
});

test("describeError prefers the Anchor error name", () => {
  const logs = ["Program log: AnchorError thrown in programs/x.rs:1. Error Code: RaceNotClosed. Error Number: 6021. Error Message: The race has not closed yet."];
  expect(describeError({ logs, message: "boom" })).toBe("RaceNotClosed: The race has not closed yet");
  expect(describeError(new Error("  plain\nmessage "))).toBe(" plain message ");
});

test("eventsFromLogs merges credential and race events", () => {
  const w = new Writer().bytes(RACE_DISCRIMINATORS.EntryRefunded).bytes(Keypair.generate().publicKey.toBuffer()).bytes(Keypair.generate().publicKey.toBuffer()).u64(BigInt(5));
  const events = eventsFromLogs([`Program data: ${w.done().toString("base64")}`]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ name: "EntryRefunded", lamports: BigInt(5) });
});

describe("signing limits", () => {
  test("a race stake or seed over 1 SOL, or a close date far away, is refused", () => {
    const soon = Math.floor(Date.now() / 1000) + 3600;
    expect(parsePayload(createRacePayload, { course: "neon", entryLamports: "2000000000", closesAt: soon }).ok).toBe(false);
    expect(parsePayload(createRacePayload, { course: "neon", entryLamports: 1000, seedLamports: "5000000000", closesAt: soon }).ok).toBe(false);
    expect(parsePayload(createRacePayload, { course: "neon", entryLamports: 1000, closesAt: soon + 90 * 24 * 3600 }).ok).toBe(false);
  });

  test("the issuer key only talks to devnet or a local validator", () => {
    expect(isDevnetUrl("https://api.devnet.solana.com")).toBe(true);
    expect(isDevnetUrl("http://127.0.0.1:8899")).toBe(true);
    expect(isDevnetUrl("https://api.mainnet-beta.solana.com")).toBe(false);
    expect(isDevnetUrl("not a url")).toBe(false);
    const key = JSON.stringify(Array.from(Keypair.generate().secretKey));
    const base = { SOLANA_ISSUER_KEYPAIR: key, SOLANA_PROGRAM_ID: Keypair.generate().publicKey.toBase58() };
    expect(() => loadChainConfig({ ...base, SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" })).toThrow("devnet");
    expect(loadChainConfig({ ...base, SOLANA_RPC_URL: "https://api.devnet.solana.com" }).rpcUrl).toContain("devnet");
  });
});
