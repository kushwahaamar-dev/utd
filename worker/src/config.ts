const flag = (v: string | undefined) => v === "1" || v === "true";

export const config = {
  fake: flag(process.env.NEMOTRON_FAKE),
  fakeDelayMs: Number(process.env.NEMOTRON_FAKE_DELAY_MS) || 0,
  workerSecret: process.env.STDB_WORKER_SECRET ?? process.env.WORKER_SECRET ?? "",
  stdbUri: process.env.STDB_URI ?? "ws://127.0.0.1:3100",
  stdbDatabase: process.env.STDB_DB ?? process.env.STDB_DATABASE ?? "iynk",
  concurrency: Math.max(1, Number(process.env.JOB_CONCURRENCY) || 2),
} as const;
