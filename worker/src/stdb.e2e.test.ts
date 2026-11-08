// Runs the worker against a real SpacetimeDB. Skipped unless STDB_E2E=1.
//   spacetime publish <db> --server http://127.0.0.1:3100 -p spacetime   (with WORKER_SECRET set)
//   STDB_E2E=1 STDB_DATABASE=<db> WORKER_SECRET=<secret> npm --prefix worker test
import { describe, expect, it } from "vitest";
import { DbConnection } from "@/lib/stdb/bindings";
import { startWorker } from "./stdb";

const uri = process.env.STDB_URI ?? "ws://127.0.0.1:3100";
const database = process.env.STDB_DATABASE ?? "iynk";
const secret = process.env.WORKER_SECRET ?? "dev-worker-secret";

function connectClient(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((c) => resolve(c))
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

const until = async (check: () => boolean, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe.skipIf(!process.env.STDB_E2E)("worker against SpacetimeDB", () => {
  it("claims a queued build job, streams its steps and finishes it", async () => {
    const worker = await startWorker({ uri, database, secret, concurrency: 1, fake: true, log: () => {} });
    const client = await connectClient();
    await new Promise<void>((resolve, reject) =>
      client
        .subscriptionBuilder()
        .onApplied(() => resolve())
        .onError(() => reject(new Error("subscribe failed")))
        .subscribe(["SELECT * FROM agent_job", "SELECT * FROM agent_step", "SELECT * FROM agent_proposal"]),
    );
    await client.reducers.startAgentJob({ kind: "build", goal: "5-inch drone, 8 minutes flight, under $500", context: "{}", roomCode: undefined });

    await until(() => [...client.db.agentJob.iter()].some((j) => j.kind === "build" && j.status === "done"));
    const job = [...client.db.agentJob.iter()].find((j) => j.kind === "build" && j.status === "done")!;
    const steps = [...client.db.agentStep.iter()].filter((s) => s.jobId === job.id).sort((a, b) => a.idx - b.idx);
    expect(steps[0].role).toBe("planner");
    expect(steps.every((s) => s.status !== "running")).toBe(true);
    expect(steps.some((s) => s.tool === "drone_optimize" && s.status === "ok")).toBe(true);
    expect(JSON.parse(job.result ?? "{}")).toMatchObject({ within_budget: true });

    await client.reducers.startAgentJob({
      kind: "diagnose",
      goal: "LED dark",
      context: JSON.stringify({ itemId: "led-resistor", faults: ["led-backwards"], symptom: "dark" }),
      roomCode: undefined,
    });
    await until(() => [...client.db.agentJob.iter()].filter((j) => j.kind === "diagnose" && j.status === "done").length >= 1);
    expect([...client.db.agentProposal.iter()].map((p) => p.kind)).toEqual(expect.arrayContaining(["propose_change", "highlight_part"]));
    client.disconnect();
    worker.stop();
  });

  it("stops a job a human cancels", async () => {
    const worker = await startWorker({ uri, database, secret, concurrency: 1, fake: true, fakeDelayMs: 150, log: () => {} });
    const client = await connectClient();
    await new Promise<void>((resolve, reject) =>
      client.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error("subscribe failed"))).subscribe(["SELECT * FROM agent_job"]),
    );
    const known = new Set([...client.db.agentJob.iter()].map((j) => j.id));
    await client.reducers.startAgentJob({ kind: "build", goal: "5-inch drone, 8 minutes flight, under $500", context: "{}", roomCode: undefined });
    await until(() => [...client.db.agentJob.iter()].some((j) => !known.has(j.id) && j.status === "running"));
    const job = [...client.db.agentJob.iter()].find((j) => !known.has(j.id))!;
    await client.reducers.cancelAgentJob({ jobId: job.id });
    await new Promise((r) => setTimeout(r, 1500));
    expect(client.db.agentJob.id.find(job.id)?.status).toBe("cancelled");
    client.disconnect();
    worker.stop();
  });
});
