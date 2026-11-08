import { droneBuild, ledDiagnosis, type Script } from "./scripts";
import type { Job, JobStatus, Mission, Proposal, ProposalStatus, Step, Watcher } from "./types";

// The offline demo: a recorded run replayed on a clock. The snapshot is a pure function of the elapsed time, so
// the page can be designed, tested and screenshotted without a backend.

const GAP_MS = 450;
const OWNER = "demo";

type Run = {
  id: string;
  goal: string;
  kind: string;
  roomCode?: string;
  script: Script;
  startedAt: number;
  speed: number;
  cancelledAt?: number;
  decisions: Map<number, ProposalStatus>;
};

export type Snapshot = Pick<Mission, "job" | "steps" | "proposals" | "watchers">;

export function scriptFor(kind: string): Script {
  return kind === "diagnose" ? ledDiagnosis : droneBuild;
}

function starts(script: Script): number[] {
  let at = 0;
  return script.steps.map((step) => {
    const start = at;
    at += step.ms + GAP_MS;
    return start;
  });
}

export function scriptLength(script: Script): number {
  const offsets = starts(script);
  const last = script.steps.length - 1;
  return offsets[last] + script.steps[last].ms + GAP_MS;
}

const WATCHERS: Watcher[] = [
  { id: "w1", name: "Maya", color: "#ef6a4c" },
  { id: "w2", name: "Ken", color: "#76a0e2" },
  { id: "w3", name: "Priya", color: "#93d3b0" },
];

export function snapshotAt(run: Run, now: number): Snapshot {
  const { script } = run;
  const elapsed = Math.max(0, ((run.cancelledAt ?? now) - run.startedAt) * run.speed);
  const offsets = starts(script);
  const total = scriptLength(script);
  const cancelled = run.cancelledAt !== undefined && elapsed < total;

  const steps: Step[] = [];
  script.steps.forEach((s, i) => {
    if (elapsed < offsets[i]) return;
    const running = elapsed < offsets[i] + s.ms;
    steps.push({
      id: `${run.id}-s${i}`,
      jobId: run.id,
      idx: i,
      role: s.role,
      title: s.title,
      tool: s.tool,
      input: s.input,
      output: running ? {} : s.output,
      status: running ? (cancelled ? "error" : "running") : "ok",
      model: s.model,
      ms: running ? Math.round(elapsed - offsets[i]) : s.ms,
      at: run.startedAt + offsets[i] / run.speed,
    });
  });

  const finished = elapsed >= total;
  const lastIdx = steps.length - 1;
  const latest = steps[lastIdx];
  let status: JobStatus = "queued";
  if (cancelled) status = "cancelled";
  else if (finished) status = "done";
  else if (latest) status = latest.role === "planner" ? "planning" : latest.role === "critic" ? "reviewing" : "running";

  const endedAt = finished ? run.startedAt + total / run.speed : (run.cancelledAt ?? now);
  const job: Job = {
    id: run.id,
    owner: OWNER,
    roomCode: run.roomCode,
    kind: run.kind,
    goal: run.goal,
    status,
    result: finished ? script.result : undefined,
    createdAt: run.startedAt,
    updatedAt: finished || cancelled ? endedAt : now,
  };

  const proposals: Proposal[] = finished
    ? script.proposals.map((p, i) => ({
        id: `${run.id}-p${i}`,
        jobId: run.id,
        kind: p.kind,
        payload: p.payload,
        status: run.decisions.get(i) ?? "pending",
        at: endedAt,
      }))
    : [];

  return { job, steps, proposals, watchers: run.roomCode ? WATCHERS : [] };
}

const runs = new Map<string, Run>();
const listeners = new Set<() => void>();
const cache = new Map<string, { key: string; snap: Snapshot }>();
let counter = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function notify() {
  for (const listener of listeners) listener();
}

function signature(snap: Snapshot): string {
  const steps = snap.steps.map((s) => `${s.status}${s.title}`).join("|");
  const proposals = snap.proposals.map((p) => p.status).join(",");
  return `${snap.job?.status}#${steps}#${proposals}#${snap.watchers.length}`;
}

export function startDemoRun(input: { kind: string; goal: string; roomCode?: string; speed?: number }): string {
  const id = `demo-${++counter}`;
  runs.set(id, {
    id,
    goal: input.goal,
    kind: input.kind,
    roomCode: input.roomCode,
    script: scriptFor(input.kind),
    startedAt: Date.now(),
    speed: input.speed ?? 1,
    decisions: new Map(),
  });
  notify();
  return id;
}

/** A link to /mission/demo-3 after a reload has no run in memory: replay the default build from the top. */
export function ensureDemoRun(id: string, speed = 1): boolean {
  if (runs.has(id)) return true;
  if (!id.startsWith("demo")) return false;
  const kind = id.includes("diagnose") ? "diagnose" : "build";
  runs.set(id, {
    id,
    goal: kind === "diagnose" ? "Why does my LED burn out?" : "5-inch drone that flies 8 minutes, under $400",
    kind,
    script: scriptFor(kind),
    startedAt: Date.now(),
    speed,
    decisions: new Map(),
  });
  return true;
}

export function snapshotFor(id: string): Snapshot | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  const next = snapshotAt(run, Date.now());
  const key = signature(next);
  const hit = cache.get(id);
  if (hit && hit.key === key) return hit.snap;
  cache.set(id, { key, snap: next });
  return next;
}

export function cancelDemoRun(id: string) {
  const run = runs.get(id);
  if (!run || run.cancelledAt !== undefined) return;
  run.cancelledAt = Date.now();
  notify();
}

export function resolveDemoProposal(proposalId: string, accept: boolean) {
  const match = /^(.*)-p(\d+)$/.exec(proposalId);
  const run = match ? runs.get(match[1]) : undefined;
  if (!match || !run) return;
  run.decisions.set(Number(match[2]), accept ? "accepted" : "rejected");
  notify();
}

export function listDemoRuns(): Job[] {
  return [...runs.keys()].flatMap((id) => snapshotFor(id)?.job ?? []).reverse();
}

/** A cheap string that changes when the list does, for useSyncExternalStore. */
export function demoRunsKey(): string {
  return listDemoRuns()
    .map((job) => `${job.id}:${job.status}`)
    .join(";");
}

export function subscribeDemo(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(notify, 250);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
