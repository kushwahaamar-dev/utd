import { createChainClient, type ChainClient, type ChainJob, type ChainResult } from "./client";
import { watchProgramLogs, type ChainEvent } from "./watch";

// Entry point for the worker service. The signer and RPC come from
// SOLANA_ISSUER_KEYPAIR, SOLANA_RPC_URL and SOLANA_PROGRAM_ID (falling back to
// NEXT_PUBLIC_SOLANA_PROGRAM_ID).

let shared: ChainClient | null = null;

/** The process-wide client, built on first use. Throws if the environment is incomplete. */
export function chainClient(): ChainClient {
  shared ??= createChainClient();
  return shared;
}

/**
 * Runs one chain_job and never throws: failures come back as
 * `{ status: "failed", error }`. Run jobs one at a time, oldest first.
 */
export async function processChainJob(job: ChainJob): Promise<ChainResult> {
  let client: ChainClient;
  try {
    client = chainClient();
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "chain is not configured" };
  }
  return client.process(job);
}

/** Streams the program's events (RaceEntered, ResultSubmitted, RaceSettled, CredentialIssued, ...); resolves to a stop function. */
export function watchProgram(onEvent: (e: ChainEvent) => void): Promise<() => Promise<void>> {
  const { connection, config } = chainClient();
  return watchProgramLogs(connection, config.programId, onEvent);
}

export { replayRecent, type ChainEvent } from "./watch";
export { createChainClient, describeError, type ChainClient, type ChainJob, type ChainResult } from "./client";
export { loadChainConfig, parseKeypair, type ChainConfig } from "./config";
export { entryResultFromEvent, mirrorStatus, trackHashOf, upsertRaceArgs } from "./mirror";
