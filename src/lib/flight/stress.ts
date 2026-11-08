import type { StressEvent, StressKind, StressSpec } from "./types";

// Stress tests: a schedule of trouble keyed to the flight time (seconds since arming), so the same inputs replay to
// the same flight. Every event eases in and out over RAMP seconds instead of switching, the way weather and a tiring
// motor really arrive.

const RAMP = 3;

/** What is in force at one moment. All zero when nothing is scheduled. */
export interface StressFx {
  wind: number; // m/s extra mean wind
  degrade: number; // motors' worth of thrust lost (one motor's share, 0..1)
  sag: number; // extra pack resistance, a multiple of the pack's own
  down: number; // m/s^2 downdraft
  drift: number; // m/s of position drift where the craft holds position
  night: number; // 0..1
  fog: number; // 0..1
}

export const calmFx = (): StressFx => ({ wind: 0, degrade: 0, sag: 0, down: 0, drift: 0, night: 0, fog: 0 });

const FIELD: Record<StressKind, keyof StressFx> = {
  gusts: "wind",
  degrade: "degrade",
  sag: "sag",
  downdraft: "down",
  gps: "drift",
  night: "night",
  fog: "fog",
};

/** How far an event is in: 0 before it, 1 once ramped in, back to 0 after it ends. */
export function ramp(e: StressEvent, t: number): number {
  if (t < e.at) return 0;
  const up = Math.min(1, (t - e.at) / RAMP);
  const down = e.until === Infinity ? 1 : Math.min(1, Math.max(0, (e.until - t) / RAMP + 0.001));
  return t >= e.until ? 0 : Math.min(up, down);
}

export function stressFx(spec: StressSpec, t: number): StressFx {
  const fx = calmFx();
  for (const e of spec.events) {
    const k = ramp(e, t);
    if (k > 0) fx[FIELD[e.kind]] = Math.max(fx[FIELD[e.kind]], e.level * k);
  }
  return fx;
}
