import { t } from "spacetimedb/server";
import spacetimedb from "./schema";
import { checkLap } from "./lapcheck";
import { addMillis, bumpActivity, fail, limit, limitGlobal, requireJson, requireLang, requireName, requirePlayer, requireStringArray, type Ctx } from "./util";

const PROGRESS_KEY = /^[a-z0-9][a-z0-9:._-]{0,95}$/;
const COURSE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const LAP_MS = { min: 1_000, max: 60 * 60 * 1000 };
const MAX_PROGRESS_KEYS = 500;
const MAX_LAPS_PER_IDENTITY = 40;
const BUDDY_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_KINDS = new Set([
  "flight.start",
  "led.blink",
  "lesson.attempt",
  "lesson.pass",
  "fault",
  "ai.call",
  "hw.connect",
  "search.call",
]);

export const recordProgress = spacetimedb.reducer({ key: t.string() }, (ctx, { key }) => {
  limit(ctx, "progress", 20, 1);
  if (!PROGRESS_KEY.test(key)) fail("bad progress key");
  const mine = [...ctx.db.progress.identity.filter(ctx.sender)];
  if (mine.some((row) => row.key === key)) return;
  if (mine.length >= MAX_PROGRESS_KEYS) fail("too many progress keys");
  ctx.db.progress.insert({ id: 0n, identity: ctx.sender, key, at: ctx.timestamp });
  bumpActivity(ctx, "step.done");
});

export const trackActivity = spacetimedb.reducer({ kind: t.string(), count: t.u32() }, (ctx, { kind, count }) => {
  limit(ctx, "track", 30, 3);
  if (!ACTIVITY_KINDS.has(kind)) fail("unknown activity kind");
  if (count < 1 || count > 25) fail("bad count");
  bumpActivity(ctx, kind, count);
});

export const submitLap = spacetimedb.reducer(
  { course: t.string(), timeMs: t.u32(), inputs: t.string(), name: t.option(t.string()) },
  (ctx, { course, timeMs, inputs, name }) => {
    limit(ctx, "lap", 10, 0.2);
    limitGlobal(ctx, "lap", 60, 10);
    if (!COURSE.test(course)) fail("bad course id");
    if (timeMs < LAP_MS.min || timeMs > LAP_MS.max) fail("lap time is outside what a course can produce");
    const parsedInputs = requireJson(inputs, 64 * 1024, "inputs");
    const check = checkLap(course, timeMs, parsedInputs, Number(ctx.timestamp.microsSinceUnixEpoch / 1000n));
    const player = requirePlayer(ctx);
    const display = name != null ? requireName(name) : player.name;

    const lap = ctx.db.lap.insert({
      id: 0n,
      identity: ctx.sender,
      name: display,
      course,
      timeMs,
      inputs,
      verified: check.ok,
      at: ctx.timestamp,
    });
    pruneLaps(ctx);
    // Only a lap that passed the checks can set a board time or a race result.
    if (!check.ok) return;

    const best = ctx.db.leaderboard.byCourseIdentity.filter([course, ctx.sender]).next().value;
    if (!best) {
      ctx.db.leaderboard.insert({ id: 0n, course, identity: ctx.sender, name: display, bestMs: timeMs, lapId: lap.id, at: ctx.timestamp });
    } else if (timeMs < best.bestMs) {
      ctx.db.leaderboard.id.update({ ...best, name: display, bestMs: timeMs, lapId: lap.id, at: ctx.timestamp });
    }

    for (const entry of [...ctx.db.raceEntry.identity.filter(ctx.sender)]) {
      const race = ctx.db.race.id.find(entry.raceId);
      if (!race || race.course !== course || race.status !== "open") continue;
      if (race.closesAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) continue;
      if (entry.bestMs == null || timeMs < entry.bestMs) {
        ctx.db.raceEntry.id.update({ ...entry, bestMs: timeMs, lapId: lap.id });
      }
    }
    bumpActivity(ctx, "flight.lap");
  },
);

/** Replay logs are big; an identity keeps its newest laps and whichever ones a board or a race still points at. */
function pruneLaps(ctx: Ctx) {
  const mine = [...ctx.db.lap.identity.filter(ctx.sender)];
  if (mine.length <= MAX_LAPS_PER_IDENTITY) return;
  const pinned = new Set<bigint>();
  for (const row of ctx.db.leaderboard.iter()) if (row.identity.equals(ctx.sender)) pinned.add(row.lapId);
  for (const row of ctx.db.raceEntry.identity.filter(ctx.sender)) if (row.lapId != null) pinned.add(row.lapId);
  mine.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const old of mine.slice(0, mine.length - MAX_LAPS_PER_IDENTITY)) {
    if (!pinned.has(old.id)) ctx.db.lap.id.delete(old.id);
  }
}

export const upsertBuddy = spacetimedb.reducer(
  { name: t.string(), lang: t.string(), interests: t.string(), built: t.string(), wants: t.string() },
  (ctx, { name, lang, interests, built, wants }) => {
    limit(ctx, "buddy", 5, 0.1);
    limitGlobal(ctx, "buddy", 30, 2);
    requirePlayer(ctx);
    const cleanWants = wants.trim();
    if (Array.from(cleanWants).length > 280) fail("wants is over 280 characters");
    requireStringArray(interests, 12, 40, "interests");
    const builtKeys = requireStringArray(built, 64, 96, "built");
    if (!builtKeys.every((k) => PROGRESS_KEY.test(k))) fail("built has a bad key");
    const row = {
      identity: ctx.sender,
      name: requireName(name),
      lang: requireLang(lang),
      interests,
      built,
      wants: cleanWants,
      updatedAt: ctx.timestamp,
      expiresAt: addMillis(ctx.timestamp, BUDDY_TTL_MS),
    };
    if (ctx.db.buddyProfile.identity.find(ctx.sender)) ctx.db.buddyProfile.identity.update(row);
    else ctx.db.buddyProfile.insert(row);
  },
);

export const deleteBuddy = spacetimedb.reducer((ctx) => {
  ctx.db.buddyProfile.identity.delete(ctx.sender);
});
