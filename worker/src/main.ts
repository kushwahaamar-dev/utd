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
  chain: await chain(),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`${signal}: shutting down`);
    worker.stop();
    process.exit(0);
  });
}
