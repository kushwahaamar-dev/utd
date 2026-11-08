import type { FlightOrigin } from "./session";
import type { FlightAction } from "./types";

/** A finished lap or run as the range reports it: the time (s) and the session's input log up to that step. */
export type LapFinish = { time: number; steps: number; origin: FlightOrigin; log: ReadonlyArray<{ step: number; action: FlightAction }> };

/** The module accepts laps from 1 s to 1 h and inputs up to 64 KiB. */
export const LAP_MS = { min: 1_000, max: 3_600_000 } as const;
const MAX_INPUT_CHARS = 60_000;

export const lapMs = (seconds: number) => Math.round(seconds * 1000);
export const onBoard = (ms: number) => ms >= LAP_MS.min && ms <= LAP_MS.max;

/**
 * What the server keeps beside the best lap so it can be replayed: which craft, course and mode flew it and every
 * action with the physics step it landed on. A session whose log is too big to store keeps the summary only.
 */
export function lapInputs(finish: LapFinish): Record<string, unknown> {
  const { origin } = finish;
  const head = { v: 1, craft: origin.craft.id, course: origin.course.id, mode: origin.opts.mode ?? null, time: finish.time, steps: finish.steps };
  const full = { ...head, log: finish.log };
  return JSON.stringify(full).length <= MAX_INPUT_CHARS ? full : { ...head, log: null };
}
