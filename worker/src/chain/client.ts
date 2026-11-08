import { Connection, PublicKey, Transaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { credentialAddress, issueCredentialIx } from "@/lib/solana/passport";
import { openBountiesFor } from "@/lib/solana/reads";
import {
  cancelRaceIx,
  createRaceIx,
  decodeEntry,
  decodeRace,
  entryAddress,
  getEntries,
  raceAddress,
  settleIx,
  submitResultIx,
  type Entry,
  type Race,
} from "@/lib/solana/race";
import { loadChainConfig, type ChainConfig } from "./config";
import { fallbackRunHash, hexToBytes, trackHashOf } from "./mirror";
import {
  createRacePayload,
  issueCredentialPayload,
  parsePayload,
  settleRacePayload,
  submitResultPayload,
  type SettleRacePayload,
} from "./payloads";

export type ChainJob = { id: number | bigint | string; kind: string; payload: unknown };

export type ChainResult = {
  status: "confirmed" | "failed";
  sig?: string;
  error?: string;
  /** The account the job created or touched: the credential or race PDA. */
  pda?: string;
};

export type ChainClient = {
  readonly config: ChainConfig;
  readonly connection: Connection;
  process(job: ChainJob): Promise<ChainResult>;
  getRace(address: string): Promise<Race | null>;
  getEntries(raceAddress: string): Promise<Entry[]>;
};

const MAX_BOUNTIES = 6;
const SETTLE_RETRIES = 6;
const SETTLE_RETRY_MS = 3000;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

/** The readable part of a failed transaction: the Anchor error name if there is one. */
export function describeError(error: unknown): string {
  const e = error as { logs?: unknown; transactionLogs?: unknown; message?: unknown } | null;
  const logs = [e?.logs, e?.transactionLogs].find(Array.isArray) as unknown[] | undefined;
  const anchor = logs?.map(String).find((l) => l.includes("Error Code:"));
  if (anchor) {
    const m = /Error Code: (\w+)\. Error Number: \d+\. Error Message: (.*?)\.?$/.exec(anchor);
    return m ? `${m[1]}: ${m[2]}` : anchor.slice(0, 200);
  }
  const message = e?.message ? String(e.message) : String(error);
  return message.replace(/\s+/g, " ").slice(0, 240);
}

export function createChainClient(
  config: ChainConfig = loadChainConfig(),
  deps: { connection?: Connection; sleep?: (ms: number) => Promise<void> } = {},
): ChainClient {
  const connection = deps.connection ?? new Connection(config.rpcUrl, { commitment: "confirmed" });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { programId, signer } = config;

  async function send(...ixs: TransactionInstruction[]): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(signer as Keypair);
    const signature = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
    const { value } = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (value.err) throw Object.assign(new Error(`transaction failed on-chain: ${JSON.stringify(value.err)}`), { onChain: value.err });
    return signature;
  }

  async function loadRace(address: string): Promise<Race | null> {
    const info = await connection.getAccountInfo(new PublicKey(address));
    if (!info || !info.owner.equals(programId)) return null;
    return decodeRace(address, info.data);
  }

  async function oracleRace(address: string): Promise<{ race: Race } | { error: string }> {
    const race = await loadRace(address);
    if (!race) return { error: "no such race on-chain" };
    if (race.authority !== signer.publicKey.toBase58()) return { error: "this signer is not the race's oracle" };
    return { race };
  }

  async function issueCredential(raw: unknown): Promise<ChainResult> {
    const parsed = parsePayload(issueCredentialPayload, raw);
    if (!parsed.ok) return { status: "failed", error: parsed.error };
    const p = parsed.data;
    const learner = new PublicKey(p.wallet);
    const hash = sha256(p.skillId);
    const credential = credentialAddress(programId, learner, hash);
    if (await connection.getAccountInfo(credential)) return { status: "confirmed", pda: credential.toBase58() };
    const bounties = (await openBountiesFor(connection, programId, hash, learner)).slice(0, MAX_BOUNTIES);
    const sig = await send(
      issueCredentialIx({
        programId,
        issuer: signer.publicKey,
        payer: signer.publicKey,
        learner,
        skillId: p.skillId,
        skillHash: hash,
        replayHash: hexToBytes(p.replayHash),
        score: p.score,
        bounties: bounties.map((b) => new PublicKey(b.address)),
      }),
    );
    return { status: "confirmed", sig, pda: credential.toBase58() };
  }

  async function submitOne(address: string, player: string, bestMs: number, runHash: Uint8Array): Promise<string | null> {
    const info = await connection.getAccountInfo(entryAddress(programId, new PublicKey(address), new PublicKey(player)));
    if (!info) throw new Error("the player never entered this race on-chain");
    const entry = decodeEntry("", info.data);
    if (entry && entry.lapMs > 0 && entry.lapMs <= bestMs) return null;
    return send(
      submitResultIx({
        programId,
        race: new PublicKey(address),
        player: new PublicKey(player),
        oracle: signer.publicKey,
        lapMs: bestMs,
        runHash,
      }),
    );
  }

  async function submitResult(raw: unknown): Promise<ChainResult> {
    const parsed = parsePayload(submitResultPayload, raw);
    if (!parsed.ok) return { status: "failed", error: parsed.error };
    const p = parsed.data;
    const checked = await oracleRace(p.onchain);
    if ("error" in checked) return { status: "failed", error: checked.error };
    if (checked.race.status === "settled" || checked.race.status === "cancelled") return { status: "failed", error: "the race is already finished" };
    const runHash = p.runHash ? hexToBytes(p.runHash) : fallbackRunHash(p.wallet, p.bestMs, p.lapId);
    const sig = await submitOne(p.onchain, p.wallet, p.bestMs, runHash);
    return sig ? { status: "confirmed", sig, pda: p.onchain } : { status: "confirmed", pda: p.onchain };
  }

  async function settleRace(raw: unknown): Promise<ChainResult> {
    const parsed = parsePayload(settleRacePayload, raw);
    if (!parsed.ok) return { status: "failed", error: parsed.error };
    const p: SettleRacePayload = parsed.data;
    const checked = await oracleRace(p.onchain);
    if ("error" in checked) return { status: "failed", error: checked.error };
    if (checked.race.status === "settled") return { status: "confirmed", pda: p.onchain };
    if (checked.race.status === "cancelled") return { status: "failed", error: "the race was cancelled" };
    const race = new PublicKey(p.onchain);

    // The queue may run settle before the result jobs have landed, so make sure
    // the podium's results are on-chain first. Only the first three can place.
    const finishers = p.ranking.filter((r) => r.bestMs != null).sort((a, b) => a.bestMs! - b.bestMs!);
    for (const r of finishers.slice(0, 3)) {
      const runHash = r.runHash ? hexToBytes(r.runHash) : fallbackRunHash(r.wallet, r.bestMs!, r.lapId);
      await submitOne(p.onchain, r.wallet, r.bestMs!, runHash);
    }

    const fresh = (await loadRace(p.onchain)) ?? checked.race;
    if (fresh.top3.length === 0) {
      const sig = await send(cancelRaceIx(programId, race, new PublicKey(fresh.creator), signer.publicKey));
      return { status: "confirmed", sig, pda: p.onchain };
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < SETTLE_RETRIES; attempt++) {
      try {
        const sig = await send(settleIx(programId, race, signer.publicKey, fresh.top3.map((x) => new PublicKey(x.player))));
        return { status: "confirmed", sig, pda: p.onchain };
      } catch (error) {
        lastError = error;
        // The module's close timer can fire a moment before the cluster's clock reaches closes_at.
        if (!describeError(error).startsWith("RaceNotClosed")) break;
        await sleep(SETTLE_RETRY_MS);
      }
    }
    throw lastError;
  }

  async function createRace(raw: unknown): Promise<ChainResult> {
    const parsed = parsePayload(createRacePayload, raw);
    if (!parsed.ok) return { status: "failed", error: parsed.error };
    const p = parsed.data;
    const raceId = p.chainRaceId ?? BigInt(Date.now());
    const address = raceAddress(programId, raceId);
    if (await connection.getAccountInfo(address)) return { status: "confirmed", pda: address.toBase58() };
    const sig = await send(
      createRaceIx({
        programId,
        creator: signer.publicKey,
        raceId,
        entryLamports: p.entryLamports,
        trackHash: trackHashOf(p.course),
        closesAt: p.closesAt,
        seedLamports: p.seedLamports,
      }),
    );
    return { status: "confirmed", sig, pda: address.toBase58() };
  }

  return {
    config,
    connection,
    async process(job) {
      try {
        switch (job.kind) {
          case "issue_credential":
            return await issueCredential(job.payload);
          case "submit_result":
            return await submitResult(job.payload);
          case "settle_race":
            return await settleRace(job.payload);
          case "create_race":
            return await createRace(job.payload);
          default:
            return { status: "failed", error: `unknown chain job kind: ${job.kind}` };
        }
      } catch (error) {
        return { status: "failed", error: describeError(error) };
      }
    },
    getRace: loadRace,
    getEntries: (address) => getEntries(connection, programId, new PublicKey(address)),
  };
}
