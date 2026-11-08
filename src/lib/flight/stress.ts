import type { CalcOutputs, StressEvent, StressKind, StressOutcome, StressSpec } from "./types";
import { DEG } from "./math";

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

export type StressGrade = "S" | "A" | "B" | "C" | "D";

/** The report card's score: survival and precision, with a bonus for putting it down safely. */
export function stressGrade(r: { t: number; limit: number; hits: number; total: number; outcome: StressOutcome }): { grade: StressGrade; score: number } {
  const survived = r.outcome === "complete" ? 1 : Math.min(1, r.t / Math.max(1, r.limit));
  const precision = r.total > 0 ? Math.min(1, r.hits / r.total) : 0;
  const down = r.outcome === "landed" || r.outcome === "complete" ? 1 : 0;
  const score = Math.round(100 * (0.45 * survived + 0.45 * precision + 0.1 * down));
  const grade: StressGrade = score >= 95 ? "S" : score >= 80 ? "A" : score >= 60 ? "B" : score >= 35 ? "C" : "D";
  return { grade, score };
}

/** The numbers the report card's physics paragraphs quote, from the build and what the test did to it. */
export function stressFacts(calc: CalcOutputs, spec: StressSpec, stats: { maxTilt: number }) {
  const level = (kind: StressKind) => spec.events.find((e) => e.kind === kind)?.level ?? 0;
  const tw = 1 / Math.max(1e-6, calc.hoverThrottle * calc.hoverThrottle);
  // the same law the sim flies: a failing motor fades faster the harder it works
  const loss = Math.min(1, level("degrade") * (0.7 + calc.hoverThrottle));
  return {
    cos: Math.round(Math.cos(Math.min(89, stats.maxTilt) * DEG) * 100),
    tw,
    tw2: tw * Math.max(0, 1 - loss / Math.max(1, calc.motors)),
    loss: Math.round(loss * 100),
    hover: Math.round(calc.hoverThrottle * 100),
    sagTimes: 1 + level("sag"),
    wind: level("gusts"),
    down: level("downdraft"),
  };
}
