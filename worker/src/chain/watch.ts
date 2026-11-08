import type { Connection, PublicKey } from "@solana/web3.js";
import { parseEvents, type PassportEvent } from "@/lib/solana/passport";
import { parseRaceEvents, type RaceEvent } from "@/lib/solana/race";

export type ChainEvent = { signature: string; slot: number; event: RaceEvent | PassportEvent };

export const eventsFromLogs = (logs: readonly string[]): (RaceEvent | PassportEvent)[] => [...parseEvents(logs), ...parseRaceEvents(logs)];

/**
 * Subscribes to the program's logs and reports every iynk_passport event
 * (RaceCreated, RaceEntered, ResultSubmitted, RaceSettled, RaceCancelled,
 * EntryRefunded, CredentialIssued, BountyPaid). Failed transactions emit nothing.
 * Returns a function that stops listening.
 */
export async function watchProgramLogs(
  connection: Connection,
  programId: PublicKey,
  onEvent: (e: ChainEvent) => void,
): Promise<() => Promise<void>> {
  const id = connection.onLogs(
    programId,
    (logs, ctx) => {
      if (logs.err) return;
      for (const event of eventsFromLogs(logs.logs)) onEvent({ signature: logs.signature, slot: ctx.slot, event });
    },
    "confirmed",
  );
  return () => connection.removeOnLogsListener(id);
}

/**
 * Replays the program's recent history, oldest first, for a worker that was
 * down. `until` is the newest signature already mirrored.
 */
export async function replayRecent(
  connection: Connection,
  programId: PublicKey,
  onEvent: (e: ChainEvent) => void,
  opts: { until?: string; limit?: number } = {},
): Promise<number> {
  const sigs = await connection.getSignaturesForAddress(programId, { until: opts.until, limit: opts.limit ?? 100 }, "confirmed");
  let count = 0;
  for (const info of sigs.filter((s) => !s.err).reverse()) {
    const tx = await connection.getTransaction(info.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    for (const event of eventsFromLogs(tx?.meta?.logMessages ?? [])) {
      onEvent({ signature: info.signature, slot: info.slot, event });
      count += 1;
    }
  }
  return count;
}
