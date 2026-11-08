import { t } from "spacetimedb/server";
import spacetimedb from "./schema";
import { byteLength, fail, limit, requireJson, requireWorker, registerWorker, type Ctx } from "./util";

const KINDS = ["build", "diagnose", "partner", "plan", "match"];
const LIVE = ["queued", "planning", "running", "reviewing"];
const STATUSES = [...LIVE, "done", "failed", "cancelled"];
const MAX_GOAL = 2000;
const MAX_ACTIVE_PER_OWNER = 3;
const MAX_STEP_BYTES = 128 * 1024;

const fit = (text: string) => (byteLength(text) > MAX_STEP_BYTES ? JSON.stringify({ truncated: true }) : text);

function jobFor(ctx: Ctx, id: bigint) {
  return ctx.db.agentJob.id.find(id) ?? fail("no such job");
}

export const startAgentJob = spacetimedb.reducer(
  { kind: t.string(), goal: t.string(), context: t.string(), roomCode: t.option(t.string()) },
  (ctx, { kind, goal, context, roomCode }) => {
    limit(ctx, "agent_job", 5, 1 / 20);
    if (!KINDS.includes(kind)) fail(`kind must be one of ${KINDS.join(", ")}`);
    const text = goal.trim();
    if (!text) fail("goal is empty");
    if (Array.from(text).length > MAX_GOAL) fail(`goal is over ${MAX_GOAL} characters`);
    requireJson(context, 32 * 1024, "context");
    if (roomCode != null && ![...ctx.db.roomMember.roomCode.filter(roomCode)].some((m) => m.identity.equals(ctx.sender))) {
      fail("you are not in that room");
    }
    const active = [...ctx.db.agentJob.owner.filter(ctx.sender)].filter((j) => LIVE.includes(j.status));
    if (active.length >= MAX_ACTIVE_PER_OWNER) fail("you already have jobs running; wait for one to finish or cancel it");
    ctx.db.agentJob.insert({
      id: 0n,
      owner: ctx.sender,
      roomCode,
      kind,
      goal: text,
      context,
      status: "queued",
      result: undefined,
      error: undefined,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  },
);

export const cancelAgentJob = spacetimedb.reducer({ jobId: t.u64() }, (ctx, { jobId }) => {
  const job = jobFor(ctx, jobId);
  if (!job.owner.equals(ctx.sender)) fail("not your job");
  if (!LIVE.includes(job.status)) return;
  ctx.db.agentJob.id.update({ ...job, status: "cancelled", updatedAt: ctx.timestamp });
});

export const resolveProposal = spacetimedb.reducer({ proposalId: t.u64(), accept: t.bool() }, (ctx, { proposalId, accept }) => {
  limit(ctx, "proposal", 20, 2);
  const proposal = ctx.db.agentProposal.id.find(proposalId) ?? fail("no such proposal");
  const job = jobFor(ctx, proposal.jobId);
  if (!job.owner.equals(ctx.sender)) fail("not your job");
  if (proposal.status !== "pending") fail("already resolved");
  ctx.db.agentProposal.id.update({ ...proposal, status: accept ? "accepted" : "rejected" });
});

export const workerRegister = spacetimedb.reducer({ secret: t.string() }, (ctx, { secret }) => {
  limit(ctx, "worker_register", 5, 0.1);
  registerWorker(ctx, secret);
});

export const workerJobStatus = spacetimedb.reducer(
  { jobId: t.u64(), status: t.string(), result: t.option(t.string()), error: t.option(t.string()) },
  (ctx, { jobId, status, result, error }) => {
    requireWorker(ctx);
    if (!STATUSES.includes(status)) fail("bad status");
    const job = jobFor(ctx, jobId);
    // A cancelled or finished job stays that way, whatever a slow worker says.
    if (!LIVE.includes(job.status)) return;
    ctx.db.agentJob.id.update({
      ...job,
      status,
      result: result ?? job.result,
      error: error ?? job.error,
      updatedAt: ctx.timestamp,
    });
  },
);

export const workerStepStart = spacetimedb.reducer(
  {
    jobId: t.u64(),
    idx: t.u32(),
    role: t.string(),
    title: t.string(),
    tool: t.option(t.string()),
    input: t.string(),
    model: t.option(t.string()),
  },
  (ctx, { jobId, idx, role, title, tool, input, model }) => {
    requireWorker(ctx);
    jobFor(ctx, jobId);
    if (!["planner", "executor", "critic", "tool", "system"].includes(role)) fail("bad role");
    const row = {
      jobId,
      idx,
      role,
      title: title.slice(0, 200),
      tool,
      input: fit(input),
      output: "{}",
      status: "running",
      model,
      ms: 0,
      at: ctx.timestamp,
    };
    const old = ctx.db.agentStep.byJobIdx.filter([jobId, idx]).next().value;
    if (old) ctx.db.agentStep.id.update({ ...old, ...row });
    else ctx.db.agentStep.insert({ id: 0n, ...row });
  },
);

export const workerStepFinish = spacetimedb.reducer(
  { jobId: t.u64(), idx: t.u32(), output: t.string(), status: t.string(), ms: t.u32() },
  (ctx, { jobId, idx, output, status, ms }) => {
    requireWorker(ctx);
    if (status !== "ok" && status !== "error") fail("status must be ok or error");
    const step = ctx.db.agentStep.byJobIdx.filter([jobId, idx]).next().value ?? fail("no such step");
    ctx.db.agentStep.id.update({ ...step, output: fit(output), status, ms });
  },
);

export const workerAddProposal = spacetimedb.reducer(
  { jobId: t.u64(), kind: t.string(), payload: t.string() },
  (ctx, { jobId, kind, payload }) => {
    requireWorker(ctx);
    jobFor(ctx, jobId);
    ctx.db.agentProposal.insert({ id: 0n, jobId, kind: kind.slice(0, 64), payload: fit(payload), status: "pending", at: ctx.timestamp });
  },
);

export const workerSetTranslation = spacetimedb.reducer(
  { messageId: t.u64(), lang: t.string(), text: t.string() },
  (ctx, { messageId, lang, text }) => {
    requireWorker(ctx);
    const message = ctx.db.chatMessage.id.find(messageId) ?? fail("no such message");
    const old = [...ctx.db.chatTranslation.messageId.filter(messageId)].find((row) => row.lang === lang);
    if (old) ctx.db.chatTranslation.id.update({ ...old, text: text.slice(0, 2000) });
    else ctx.db.chatTranslation.insert({ id: 0n, messageId, roomCode: message.roomCode, lang, text: text.slice(0, 2000) });
  },
);
