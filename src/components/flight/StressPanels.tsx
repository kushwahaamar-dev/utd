"use client";

import { Button, Chip, cx } from "@/components/ui";
import type { ChipTone } from "@/components/ui/Chip";
import type { Messages } from "@/i18n/namespaces";
import type { StressGrade, StressKind, StressOutcome, StressSpec } from "@/lib/flight";

type Strings = Messages["flight"]["stress"];

const TONE: Record<StressKind, ChipTone> = { gusts: "cobalt", degrade: "tomato", sag: "mustard", night: "ink", fog: "plain", downdraft: "mint", gps: "blush" };
const BAR: Record<StressKind, string> = { gusts: "bg-cobalt", degrade: "bg-tomato", sag: "bg-mustard", night: "bg-ink", fog: "bg-muted", downdraft: "bg-mint", gps: "bg-blush" };

/** The schedule as chips (lit while on) over a track with one bar per event and a playhead: what is coming, what is here. */
export function StressHud({ spec, t, active, strings, className }: { spec: StressSpec; t: number; active: StressKind[]; strings: Strings; className?: string }) {
  const kinds = [...new Set(spec.events.map((e) => e.kind))];
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / spec.limit) * 100))}%`;
  return (
    <section
      aria-label={strings.title}
      data-testid="stress-hud"
      className={cx("pointer-events-none w-full max-w-[34rem] rounded-ink-sm border-[1.5px] border-rule bg-paper/90 px-3 py-2 shadow-ink-sm", className)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {kinds.map((k) => (
          <Chip key={k} tone={active.includes(k) ? TONE[k] : "plain"} data-active={active.includes(k)} className={active.includes(k) ? "" : "opacity-60"} dot={active.includes(k)}>
            {strings.kinds[k]}
          </Chip>
        ))}
        <span className="tabular ms-auto font-ui text-xs font-semibold">
          {Math.min(t, spec.limit).toFixed(0)} / {spec.limit} s
        </span>
      </div>
      <div role="img" aria-label={strings.timeline} className="relative mt-2 rounded-sm bg-sunken" style={{ height: spec.events.length * 6 + 2 }}>
        {spec.events.map((e, i) => (
          <span key={`${e.kind}-${i}`} className={cx("absolute h-[5px] rounded-full opacity-80", BAR[e.kind])} style={{ top: 1 + i * 6, left: pct(e.at), width: `calc(${pct(Math.min(e.until, spec.limit))} - ${pct(e.at)})` }} />
        ))}
        <span className="absolute inset-y-[-2px] w-0.5 rounded-full bg-ink" style={{ left: pct(t) }} />
      </div>
    </section>
  );
}

export type StressReportData = {
  outcome: StressOutcome;
  /** The crash line ("Hit a building"), when it ended in one. */
  what: string | null;
  t: number;
  limit: number;
  hits: number;
  total: number;
  grade: StressGrade;
  score: number;
  maxTilt: number;
  minCell: number;
  peakAmps: number;
  cut: number;
  seen: StressKind[];
  facts: { cos: number; tw: number; tw2: number; loss: number; hover: number; sagTimes: number; wind: number; down: number };
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The end screen: a grade, the numbers, and the physics of what happened in plain words, tied to the build. */
export function StressReport({ r, strings, tr, onAgain, onClose }: { r: StressReportData; strings: Strings; tr: Translate; onAgain: () => void; onClose: () => void }) {
  const f = r.facts;
  const rows: Array<[string, string]> = [
    [strings.report.rows.survived, tr("stress.report.values.survived", { t: r.t.toFixed(1), limit: r.limit })],
    [strings.report.rows.checkpoints, tr("stress.report.values.checkpoints", { hits: r.hits, total: r.total })],
    [strings.report.rows.tilt, tr("stress.report.values.tilt", { deg: Math.round(r.maxTilt) })],
    [strings.report.rows.volts, tr("stress.report.values.volts", { v: r.minCell.toFixed(2) })],
    [strings.report.rows.peak, tr("stress.report.values.peak", { a: Math.round(r.peakAmps) })],
    [strings.report.rows.ended, r.outcome === "crashed" ? (r.what ?? "") : strings.report.ended[r.outcome]],
  ];
  const seen = (k: StressKind) => r.seen.includes(k);
  const lines: string[] = [];
  if (r.maxTilt > 8) lines.push(tr("stress.report.tilt", { deg: Math.round(r.maxTilt), cos: f.cos }));
  if (seen("sag")) lines.push(tr("stress.report.sag", { v: r.minCell.toFixed(2), a: Math.round(r.peakAmps), cut: r.cut.toFixed(1), x: f.sagTimes.toFixed(1) }));
  if (seen("degrade")) lines.push(tr("stress.report.degrade", { loss: f.loss, hover: f.hover, tw: f.tw.toFixed(1), tw2: f.tw2.toFixed(1) }));
  if (seen("gusts")) lines.push(tr("stress.report.gusts", { w: f.wind }));
  if (seen("downdraft")) lines.push(tr("stress.report.downdraft", { g: f.down }));
  if (seen("night") || seen("fog")) lines.push(strings.report.dark);
  lines.push(tr(f.tw < 7 ? "stress.report.bench.weak" : "stress.report.bench.strong", { tw: f.tw.toFixed(1) }));
  return (
    <section
      role="dialog"
      aria-labelledby="stress-report-title"
      data-testid="stress-report"
      data-outcome={r.outcome}
      data-grade={r.grade}
      className="pointer-events-auto max-h-full w-full max-w-[30rem] overflow-y-auto rounded-ink border-2 border-line bg-surface p-4 shadow-ink-lg animate-ink-fade"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="ink-label">{strings.title}</p>
          <h3 id="stress-report-title" className="font-head text-2xl leading-tight">
            {strings.report.title}
          </h3>
        </div>
        <div className="text-end">
          <p className="font-head text-5xl leading-none" aria-label={tr("stress.report.grade", { grade: r.grade })}>
            {r.grade}
          </p>
          <p className="tabular font-ui text-xs text-muted">{tr("stress.report.score", { score: r.score })}</p>
        </div>
      </div>
      <dl className="mt-3 divide-y divide-rule text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular text-end font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mt-3 font-head text-lg">{strings.report.physicsTitle}</h4>
      <ul className="mt-1 space-y-2 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onAgain} data-testid="stress-again">
          {strings.report.again}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {strings.report.close}
        </Button>
      </div>
    </section>
  );
}
