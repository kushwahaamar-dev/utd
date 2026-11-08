import { ScheduleAt, Timestamp } from "spacetimedb";
import { t } from "spacetimedb/server";
import spacetimedb, { raceCloseTimer } from "./schema";
import { walletOf } from "./profile";
import { parseRun, verifyRun } from "./verify";
import { RUN_KINDS, type RunKind } from "../../src/lib/verify/runlog";
import { bumpActivity, fail, limit, micros, requireJson, requireScheduler, requireWorker, type Ctx } from "./util";

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const CHAIN_KINDS = ["issue_credential", "submit_result", "settle_race", "create_race"];
const CHAIN_STATUSES = ["queued", "sent", "confirmed", "failed"];
const RACE_STATUSES = ["open", "closed", "settled"];
const MAX_RUN_BYTES = 256 * 1024;

function queueJob(ctx: Ctx, kind: string, payload: unknown, owner?: Ctx["sender"]) {
  const job = ctx.db.chainJob.insert({
    id: 0n,
    kind,
    payload: JSON.stringify(payload),
    status: "queued",
    sig: undefined,
    error: undefined,
    createdAt: ctx.timestamp,
  });
  if (owner) ctx.db.chainJobOwner.insert({ jobId: job.id, identity: owner });
  return job;
}

function scheduleClose(ctx: Ctx, raceId: bigint, at: Timestamp) {
  for (const timer of [...ctx.db.raceCloseTimer.iter()]) {
    if (timer.raceId === raceId) ctx.db.raceCloseTimer.scheduledId.delete(timer.scheduledId);
  }
  ctx.db.raceCloseTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(at.microsSinceUnixEpoch), raceId });
}

export const submitRun = spacetimedb.reducer(
  { kind: t.string(), itemId: t.string(), sub: t.option(t.string()), run: t.string() },
  (ctx, { kind, itemId, sub, run }) => {
    limit(ctx, "submit_run", 5, 0.1);
    if (!(RUN_KINDS as readonly string[]).includes(kind)) fail("unknown run kind");
    const wallet = walletOf(ctx) ?? fail("link a wallet before submitting a run");
    if (run.length > MAX_RUN_BYTES) fail("run log is too large");
    const log = parseRun(run);
    if (typeof log === "string") return fail(log);
    const verdict = verifyRun(kind as RunKind, itemId, sub ?? undefined, log);
    if (!verdict.ok) return fail(verdict.reason);

    const me = ctx.sender.toHexString();
    const issued = [...ctx.db.credential.identity.filter(ctx.sender)].some((c) => c.skill === verdict.skillId);
    const queued = [...ctx.db.chainJob.status.filter("queued"), ...ctx.db.chainJob.status.filter("sent")].some((job) => {
      if (job.kind !== "issue_credential") return false;
      const p = JSON.parse(job.payload) as { identity?: string; skillId?: string };
      return p.identity === me && p.skillId === verdict.skillId;
    });
    if (issued || queued) fail("this credential is already issued or on its way");

    queueJob(
      ctx,
      "issue_credential",
      {
        identity: me,
        wallet,
        skillId: verdict.skillId,
        kind,
        itemId,
        sub: sub ?? null,
        score: verdict.score,
        replayHash: verdict.replayHash,
      },
      ctx.sender,
    );
    bumpActivity(ctx, "run.verified");
  },
);

export const enterRace = spacetimedb.reducer({ raceId: t.u64(), enterSig: t.string() }, (ctx, { raceId, enterSig }) => {
  limit(ctx, "enter_race", 5, 0.1);
  const wallet = walletOf(ctx) ?? fail("link a wallet before entering a race");
  const race = ctx.db.race.id.find(raceId) ?? fail("no such race");
  if (race.status !== "open" || race.closesAt.microsSinceUnixEpoch <= micros(ctx)) fail("this race is closed");
  if (!SIGNATURE.test(enterSig)) fail("that is not a transaction signature");
  const entries = [...ctx.db.raceEntry.raceId.filter(raceId)];
  if (entries.some((e) => e.identity.equals(ctx.sender))) fail("you are already in this race");
  if (entries.some((e) => e.enterSig === enterSig)) fail("that signature is already used");
  ctx.db.raceEntry.insert({
    id: 0n,
    raceId,
    identity: ctx.sender,
    wallet,
    enterSig,
    bestMs: undefined,
    lapId: undefined,
    verified: false,
    resultSig: undefined,
    payoutLamports: undefined,
  });
  bumpActivity(ctx, "race.enter");
});

export const closeRace = spacetimedb.reducer(
  { onSchedule: raceCloseTimer },
  { timer: raceCloseTimer.rowType },
  (ctx, { timer }) => {
    requireScheduler(ctx);
    const race = ctx.db.race.id.find(timer.raceId);
    if (!race || race.status !== "open") return;
    ctx.db.race.id.update({ ...race, status: "closed" });
    const ranked = [...ctx.db.raceEntry.raceId.filter(race.id)]
      .filter((e) => e.bestMs != null)
      .sort((a, b) => a.bestMs! - b.bestMs! || (a.id < b.id ? -1 : 1));
    for (const entry of ranked) {
      queueJob(ctx, "submit_result", {
        raceId: race.id.toString(),
        onchain: race.onchain,
        entryId: entry.id.toString(),
        wallet: entry.wallet,
        bestMs: entry.bestMs,
        lapId: entry.lapId?.toString() ?? null,
      });
    }
    queueJob(ctx, "settle_race", {
      raceId: race.id.toString(),
      onchain: race.onchain,
      ranking: ranked.map((e) => ({ entryId: e.id.toString(), wallet: e.wallet, bestMs: e.bestMs })),
    });
  },
);

export const workerQueueChainJob = spacetimedb.reducer({ kind: t.string(), payload: t.string() }, (ctx, { kind, payload }) => {
  requireWorker(ctx);
  if (!CHAIN_KINDS.includes(kind)) fail("bad chain job kind");
  requireJson(payload, 16 * 1024, "payload");
  ctx.db.chainJob.insert({ id: 0n, kind, payload, status: "queued", sig: undefined, error: undefined, createdAt: ctx.timestamp });
});

export const workerChainResult = spacetimedb.reducer(
  { jobId: t.u64(), status: t.string(), sig: t.option(t.string()), error: t.option(t.string()), pda: t.option(t.string()) },
  (ctx, { jobId, status, sig, error, pda }) => {
    requireWorker(ctx);
    if (!CHAIN_STATUSES.includes(status)) fail("bad status");
    const job = ctx.db.chainJob.id.find(jobId) ?? fail("no such chain job");
    if (job.status === "confirmed") return;
    ctx.db.chainJob.id.update({ ...job, status, sig: sig ?? job.sig, error: error ?? job.error });
    if (status !== "confirmed") return;

    const payload = JSON.parse(job.payload) as Record<string, unknown>;
    if (job.kind === "issue_credential") {
      const owner = ctx.db.chainJobOwner.jobId.find(jobId);
      if (!owner) return;
      ctx.db.credential.insert({
        id: 0n,
        identity: owner.identity,
        wallet: String(payload.wallet),
        skill: String(payload.skillId),
        pda: pda ?? "",
        sig: sig ?? "",
        at: ctx.timestamp,
      });
      ctx.db.chainJobOwner.jobId.delete(jobId);
      bumpActivity(ctx, "credential.issued");
    } else if (job.kind === "settle_race") {
      const race = ctx.db.race.id.find(BigInt(String(payload.raceId)));
      if (race) ctx.db.race.id.update({ ...race, status: "settled", settleSig: sig ?? race.settleSig });
    } else if (job.kind === "submit_result") {
      const entry = ctx.db.raceEntry.id.find(BigInt(String(payload.entryId)));
      if (entry) ctx.db.raceEntry.id.update({ ...entry, resultSig: sig ?? entry.resultSig });
    }
  },
);

export const workerUpsertRace = spacetimedb.reducer(
  {
    onchain: t.string(),
    course: t.string(),
    entryLamports: t.u64(),
    potLamports: t.u64(),
    closesAt: t.timestamp(),
    status: t.string(),
    settleSig: t.option(t.string()),
  },
  (ctx, { onchain, course, entryLamports, potLamports, closesAt, status, settleSig }) => {
    requireWorker(ctx);
    if (!RACE_STATUSES.includes(status)) fail("bad race status");
    const old = ctx.db.race.onchain.find(onchain);
    const next = { onchain, course, entryLamports, potLamports, closesAt, status, settleSig };
    const race = old ? ctx.db.race.id.update({ ...old, ...next, settleSig: settleSig ?? old.settleSig }) : ctx.db.race.insert({ id: 0n, ...next });
    const moved = !old || old.closesAt.microsSinceUnixEpoch !== closesAt.microsSinceUnixEpoch;
    if (status === "open" && moved) scheduleClose(ctx, race.id, closesAt);
  },
);

export const workerRaceEntryResult = spacetimedb.reducer(
  {
    entryId: t.u64(),
    verified: t.bool(),
    bestMs: t.option(t.u32()),
    lapId: t.option(t.u64()),
    resultSig: t.option(t.string()),
    payoutLamports: t.option(t.u64()),
  },
  (ctx, { entryId, verified, bestMs, lapId, resultSig, payoutLamports }) => {
    requireWorker(ctx);
    const entry = ctx.db.raceEntry.id.find(entryId) ?? fail("no such entry");
    ctx.db.raceEntry.id.update({
      ...entry,
      verified,
      bestMs: bestMs ?? entry.bestMs,
      lapId: lapId ?? entry.lapId,
      resultSig: resultSig ?? entry.resultSig,
      payoutLamports: payoutLamports ?? entry.payoutLamports,
    });
  },
);
