import "./boot";
import { config } from "./config";
import { startWorker, type WorkerOptions } from "./stdb";

if (!config.workerSecret) {
  console.error("STDB_WORKER_SECRET is not set; the module only accepts a registered worker.");
  process.exit(1);
}

const chainReady = Boolean(process.env.SOLANA_ISSUER_KEYPAIR && (process.env.SOLANA_PROGRAM_ID || process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID));

async function chain(): Promise<WorkerOptions["chain"]> {
  if (!chainReady) {
    console.log("chain jobs are left queued: SOLANA_ISSUER_KEYPAIR and SOLANA_PROGRAM_ID are not both set");
    return undefined;
  }
  const { processChainJob } = await import("./chain");
  return (job) => processChainJob(job);
}

const worker = await startWorker({
  uri: config.stdbUri,
  database: config.stdbDatabase,
  secret: config.workerSecret,
  concurrency: config.concurrency,
  fake: config.fake,
  fakeDelayMs: config.fakeDelayMs,
  chain: await chain(),
});

let stopMirror: (() => Promise<void>) | undefined;
if (chainReady) {
  const { startRaceMirror } = await import("./races");
  stopMirror = await startRaceMirror(worker.conn, console.log).catch((error) => {
    console.error(`race mirror is off: ${error instanceof Error ? error.message : error}`);
    return undefined;
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`${signal}: shutting down`);
    worker.stop();
    void (stopMirror?.() ?? Promise.resolve()).finally(() => process.exit(0));
  });
}
