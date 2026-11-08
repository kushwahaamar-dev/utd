// Anonymous usage counts for the live counter. track() and tally() only add to
// an in-memory count; every few seconds (and when the page is hidden) the
// counts go to the SpacetimeDB module as trackActivity(kind, count), which
// folds them into its per-minute activity rows. Nothing is sent while the
// learner has unticked "Share anonymous usage counts" (settings.telemetry),
// and no identifier beyond the SpacetimeDB identity ever leaves the browser.

import { getSettings } from "@/lib/settings/settings";

/** The kinds the module counts; anything else passed to track() is ignored. */
export const ACTIVITY_KINDS = [
  "flight.start",
  "led.blink",
  "lesson.attempt",
  "lesson.pass",
  "fault",
  "ai.call",
  "hw.connect",
  "search.call",
] as const;

export type TelemetryKind = (typeof ACTIVITY_KINDS)[number];
type Context = { room?: string; item?: string };
type Sink = (kind: string, count: number) => Promise<unknown>;

const FLUSH_MS = 4_000;
const KINDS = new Set<string>(ACTIVITY_KINDS);

const counts = new Map<string, number>();
let sink: Sink | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let wired = false;
let context: Context = {};

const inBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";
const optedOut = () => !getSettings().telemetry;

/** Where counts go. The provider bridge sets it while connected and clears it on the way out. */
export function setTelemetrySink(next: Sink | null): void {
  sink = next;
  if (next && counts.size) schedule();
}

/** Room and item the current page is about; kept for callers that still set it. */
export function setTelemetryContext(next: Context): void {
  context = { ...context, ...next };
}

export function getTelemetryContext(): Readonly<Context> {
  return context;
}

/** Counts one event of `kind`. Cheap and synchronous; safe to call anywhere, any time. */
export function track(kind: string, _data?: Record<string, unknown>): void {
  add(kind, 1);
}

/** Counts something that happens too often for one call each (LED blinks). */
export function tally(kind: string, n = 1): void {
  if (n > 0) add(kind, Math.round(n));
}

function add(kind: string, n: number) {
  if (!inBrowser() || !KINDS.has(kind) || optedOut()) return;
  wire();
  counts.set(kind, Math.min((counts.get(kind) ?? 0) + n, 100_000));
  schedule();
}

function schedule() {
  timer ??= setTimeout(() => {
    timer = null;
    flush();
  }, FLUSH_MS);
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

/** Sends every count now. With no connection or after an opt-out they stay (or go) and nothing is sent. */
export function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (optedOut()) return void counts.clear();
  if (!sink) return;
  for (const [kind, count] of [...counts]) {
    counts.delete(kind);
    sink(kind, count).catch(() => {});
  }
}
