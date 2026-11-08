import { DbConnection, tables } from "@/lib/stdb/bindings";
import type { AgentJob as JobRow, ChainJob as ChainRow } from "@/lib/stdb/bindings/types";
import { createModel } from "./model";
import { runJob, JobCancelled } from "./agent/run";
import { StdbSink, type Conn } from "./sinks/stdb";
import { JOB_KINDS, type AgentJob, type JobKind } from "./types";

const LIVE = new Set(["planning", "running", "reviewing"]);

export type WorkerOptions = {
  uri: string;
  database: string;
  secret: string;
  concurrency: number;
  fake?: boolean;
  fakeDelayMs?: number;
  /** Runs one chain_job; leave out to ignore the chain queue. */
  chain?: (job: { id: bigint; kind: string; payload: unknown }) => Promise<{ status: "confirmed" | "failed"; sig?: string; error?: string; pda?: string }>;
  log?: (line: string) => void;
};

function parseContext(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toJob(row: JobRow): AgentJob {
  return {
    id: row.id.toString(),
    kind: (JOB_KINDS as readonly string[]).includes(row.kind) ? (row.kind as JobKind) : "partner",
    goal: row.goal,
    context: parseContext(row.context),
    owner: row.owner.toHexString(),
    roomCode: row.roomCode ?? undefined,
  };
}

/** Connects to SpacetimeDB as the worker, registers, and works the agent_job and chain_job queues until stopped. */
export async function startWorker(options: WorkerOptions): Promise<{ stop(): void; conn: Conn }> {
  const log = options.log ?? console.log;
  const model = createModel({ fake: options.fake, fakeDelayMs: options.fakeDelayMs });
  const running = new Map<bigint, StdbSink>();
  const waiting: JobRow[] = [];
  const chainSeen = new Set<bigint>();
  const chainQueue: ChainRow[] = [];
  let chainBusy = false;
  let stopped = false;

  const conn = await new Promise<Conn>((resolve, reject) => {
    DbConnection.builder()
      .withUri(options.uri)
      .withDatabaseName(options.database)
      .onConnect((c) => resolve(c))
      .onConnectError((_ctx, error) => reject(error))
      .onDisconnect((_ctx, error) => {
        if (stopped) return;
        log(`disconnected from SpacetimeDB${error ? `: ${error.message}` : ""}`);
        process.exit(1);
      })
      .build();
  });

  await conn.reducers.workerRegister({ secret: options.secret });
  log(`worker registered as ${conn.identity?.toHexString().slice(0, 12)} on ${options.database}`);

  async function runOne(row: JobRow) {
    const sink = new StdbSink(conn, row.id);
    running.set(row.id, sink);
    log(`job ${row.id} (${row.kind}) started`);
    try {
      await runJob(toJob(row), { model, sink });
      log(`job ${row.id} done`);
    } catch (error) {
      if (error instanceof JobCancelled) log(`job ${row.id} cancelled`);
      else log(`job ${row.id} failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      running.delete(row.id);
      pump();
    }
  }

  function pump() {
    while (!stopped && running.size < options.concurrency && waiting.length) {
      const row = waiting.shift()!;
      // A job cancelled while it waited is not started.
      const fresh = conn.db.workerAgentJobs.id.find(row.id);
      if (!fresh || fresh.status !== "queued") continue;
      void runOne(fresh);
    }
  }

  function enqueue(row: JobRow) {
    if (row.status !== "queued" || running.has(row.id) || waiting.some((w) => w.id === row.id)) return;
    waiting.push(row);
    pump();
  }

  async function pumpChain() {
    if (chainBusy || !options.chain) return;
    chainBusy = true;
    try {
      while (!stopped && chainQueue.length) {
        const row = chainQueue.shift()!;
        const fresh = conn.db.workerChainJobs.id.find(row.id);
        if (!fresh || fresh.status !== "queued") continue;
        let payload: unknown = {};
        try {
          payload = JSON.parse(fresh.payload);
        } catch {
          // The chain module reports the bad payload as a failed job.
        }
        const outcome = await options.chain({ id: fresh.id, kind: fresh.kind, payload });
        log(`chain job ${fresh.id} (${fresh.kind}) ${outcome.status}${outcome.error ? `: ${outcome.error}` : ""}`);
        await conn.reducers.workerChainResult({ jobId: fresh.id, status: outcome.status, sig: outcome.sig, error: outcome.error, pda: outcome.pda });
      }
    } finally {
      chainBusy = false;
    }
  }

  function enqueueChain(row: ChainRow) {
    if (!options.chain || row.status !== "queued" || chainSeen.has(row.id)) return;
    chainSeen.add(row.id);
    chainQueue.push(row);
    chainQueue.sort((a, b) => (a.id < b.id ? -1 : 1));
    void pumpChain().catch((error) => log(`chain queue: ${error instanceof Error ? error.message : error}`));
  }

  conn.db.workerAgentJobs.onInsert((_ctx, row) => enqueue(row));
  conn.db.workerAgentJobs.onUpdate((_ctx, _old, row) => {
    if (row.status === "cancelled") running.get(row.id)?.cancel();
  });
  conn.db.workerChainJobs.onInsert((_ctx, row) => enqueueChain(row));

  await new Promise<void>((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(ctx.event ?? new Error("subscription failed")))
      .subscribe([tables.workerAgentJobs, tables.workerChainJobs]);
  });

  // A previous worker run can leave jobs in flight; nothing will finish them now.
  for (const row of conn.db.workerAgentJobs.iter()) {
    if (LIVE.has(row.status)) {
      await conn.reducers.workerJobStatus({ jobId: row.id, status: "failed", error: "The worker restarted while this job was running. Start it again." });
    } else enqueue(row);
  }
  for (const row of conn.db.workerChainJobs.iter()) enqueueChain(row);

  log(`worker ready: ${waiting.length + running.size} queued jobs, concurrency ${options.concurrency}${options.chain ? ", chain on" : ", chain off"}`);
  return {
    conn,
    stop() {
      stopped = true;
      conn.disconnect();
    },
  };
}
