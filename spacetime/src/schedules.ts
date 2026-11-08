import { ScheduleAt } from "spacetimedb";
import spacetimedb, { sweepTimer } from "./schema";
import { destroyRoom } from "./rooms";
import { micros, requireScheduler, type Ctx } from "./util";

const MINUTE = 60_000_000n;
const JOBS: Record<string, bigint> = { rooms: 5n * MINUTE, buddies: 10n * MINUTE, activity: 10n * MINUTE };
const EMPTY_ROOM_TTL = 30n * MINUTE;
const ACTIVITY_KEEP = 24n * 60n * MINUTE;
const BUCKET_KEEP = 60n * MINUTE;

/** Repeating timers are seeded once, at init, and re-checked on every connect in case a republish dropped one. */
export function ensureSchedules(ctx: Ctx) {
  const have = new Set([...ctx.db.sweepTimer.iter()].map((row) => row.job));
  for (const [job, every] of Object.entries(JOBS)) {
    if (!have.has(job)) ctx.db.sweepTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(every), job });
  }
}

export const init = spacetimedb.init((ctx) => {
  ensureSchedules(ctx);
});

export const sweep = spacetimedb.reducer(
  { onSchedule: sweepTimer },
  { timer: sweepTimer.rowType },
  (ctx, { timer }) => {
    requireScheduler(ctx);
    const now = micros(ctx);
    if (timer.job === "rooms") {
      for (const room of [...ctx.db.room.iter()]) {
        const since = room.emptySince;
        if (since && now - since.microsSinceUnixEpoch >= EMPTY_ROOM_TTL) destroyRoom(ctx, room.code);
      }
    } else if (timer.job === "buddies") {
      for (const buddy of [...ctx.db.buddyProfile.iter()]) {
        if (buddy.expiresAt.microsSinceUnixEpoch <= now) ctx.db.buddyProfile.identity.delete(buddy.identity);
      }
    } else if (timer.job === "activity") {
      for (const row of [...ctx.db.activityMinute.iter()]) {
        if (now - row.minute.microsSinceUnixEpoch > ACTIVITY_KEEP) ctx.db.activityMinute.id.delete(row.id);
      }
      for (const bucket of [...ctx.db.rateBucket.iter()]) {
        if (now - bucket.updatedUs > BUCKET_KEEP) ctx.db.rateBucket.key.delete(bucket.key);
      }
      for (const entry of [...ctx.db.searchCache.iter()]) {
        if (entry.expiresAt.microsSinceUnixEpoch <= now) ctx.db.searchCache.key.delete(entry.key);
      }
    }
  },
);
