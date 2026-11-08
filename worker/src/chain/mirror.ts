import { createHash } from "node:crypto";
import type { Race, RaceEvent } from "@/lib/solana/race";

// Pure helpers that turn chain state into the arguments of the worker-only
// SpacetimeDB reducers (worker_upsert_race, worker_race_entry_result).

/** The 32-byte track hash of a course name. */
export const trackHashOf = (course: string): Uint8Array => createHash("sha256").update(`course:${course}`, "utf8").digest();

export const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));

/** Used when the job carries no replay hash: sha256 of the lap reference and time. */
export function fallbackRunHash(wallet: string, bestMs: number, lapId: string | number | null | undefined): Uint8Array {
  return createHash("sha256").update(`lap:${wallet}:${lapId ?? ""}:${bestMs}`, "utf8").digest();
}

/** SpacetimeDB races are open, closed or settled; a cancelled race shows as closed. */
export const mirrorStatus = (status: Race["status"]): "open" | "closed" | "settled" => (status === "settled" ? "settled" : status === "open" ? "open" : "closed");

export type UpsertRaceArgs = {
  onchain: string;
  entryLamports: bigint;
  potLamports: bigint;
  closesAt: Date;
  status: "open" | "closed" | "settled";
};

/** Arguments for worker_upsert_race, minus `course` and `settleSig`, which the caller knows. */
export function upsertRaceArgs(race: Race): UpsertRaceArgs {
  return {
    onchain: race.address,
    entryLamports: race.entryLamports,
    potLamports: race.potLamports,
    closesAt: new Date(race.closesAt * 1000),
    status: mirrorStatus(race.status),
  };
}

export type EntryResultArgs = { wallet: string; verified: boolean; bestMs: number; resultSig: string | null; payoutLamports: bigint | null };

/** What a chain event means for a race_entry row, for the ones that touch it. */
export function entryResultFromEvent(event: RaceEvent, signature: string): EntryResultArgs | null {
  if (event.name === "ResultSubmitted" && event.improved) {
    return { wallet: event.player, verified: true, bestMs: event.lapMs, resultSig: signature, payoutLamports: null };
  }
  return null;
}
