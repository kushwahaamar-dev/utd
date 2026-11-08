import { isDroneId } from "../../src/content/ids";
import floors from "../../src/lib/verify/lap-floors.json";

const STEP_MS = 10;
const MAX_LOG = 6000;
const BOARD_DAILY = /^daily-\d{8}$/;
const KNOWN_ACTIONS = new Set(["arm", "disarm", "toggleArm", "reset", "mode", "wind", "sticks", "design"]);

/** A daily board is named for a UTC day; only yesterday, today and tomorrow exist. */
function isRecentDay(yyyymmdd: string, nowMs: number): boolean {
  const at = Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8));
  return Math.abs(at - nowMs) <= 36 * 3_600_000;
}

export type LapCheck = { ok: true } | { ok: false; reason: string };

const no = (reason: string): LapCheck => ({ ok: false, reason });

/**
 * Is a submitted lap believable? This is not a replay: the lap's craft design comes from the client, so the module
 * cannot re-fly it. It checks that the claim is internally consistent (time, steps and log agree), names a real
 * craft and course, took at least as long as the course physically can, and carries an input log with an arm in it.
 * Laps that fail are stored but stay off the leaderboards and out of race results.
 */
export function checkLap(board: string, timeMs: number, inputs: unknown, nowMs: number): LapCheck {
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) return no("inputs are not an object");
  const o = inputs as Record<string, unknown>;
  if (o.v !== 1) return no("unknown inputs version");
  const { craft, course, time, steps, log } = o;
  if (typeof craft !== "string" || !isDroneId(craft)) return no("unknown craft");
  if (typeof course !== "string") return no("no course");
  const key = `${craft}-${course}`;
  if (board !== key && !(BOARD_DAILY.test(board) && isRecentDay(board.slice(6), nowMs))) return no("board does not match the flown course");
  const floor = (floors as Record<string, number>)[key];
  if (floor === undefined) return no("unknown course");
  if (timeMs < floor) return no("faster than the course allows");
  if (typeof time !== "number" || !Number.isFinite(time) || Math.abs(time * 1000 - timeMs) > 2) return no("time does not match the log header");
  if (typeof steps !== "number" || !Number.isInteger(steps) || steps * STEP_MS < timeMs - 20) return no("fewer physics steps than the lap needs");
  if (!Array.isArray(log) || log.length === 0 || log.length > MAX_LOG) return no("no usable input log");
  let last = 0;
  let armed = false;
  for (const entry of log) {
    if (typeof entry !== "object" || entry === null) return no("bad log entry");
    const { step, action } = entry as { step?: unknown; action?: { type?: unknown } };
    if (typeof step !== "number" || !Number.isInteger(step) || step < last || step > steps) return no("log steps are out of order");
    last = step;
    const type = action?.type;
    if (typeof type !== "string" || !KNOWN_ACTIONS.has(type)) return no("unknown action in the log");
    if (type === "arm" || type === "toggleArm") armed = true;
  }
  return armed ? { ok: true } : no("the log never arms the craft");
}
