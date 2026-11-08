import type { SVGProps } from "react";
import { cx } from "@/components/ui/cx";

const TOOL_PATHS: Record<string, string> = {
  drone_calc: "M5 19V9m5 10V5m5 14v-7m5 7V8M3.5 19.5h17",
  sim_run: "M8 5.5v13l10.5-6.5z",
  parts_price: "M3.5 12.5l8.6-8.6h7.9v7.9l-8.6 8.6zM15.5 8.5h.01",
  bench_check: "M3 12h4l2.2-6 4 12 2.3-6H21",
  datasheet_search: "M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 13.5h6M9 17h4",
};
const FALLBACK = "M14.8 3.6a4.8 4.8 0 0 0-4.6 6.3L3.8 16.3a1.9 1.9 0 0 0 2.7 2.7l6.4-6.4a4.8 4.8 0 0 0 6.3-4.6l-2.9 2.1-2.6-.9-.9-2.6z";

/** A tool's mark inside a postage-stamp frame: dashed perforated edge, small line glyph. */
export function ToolStamp({ tool, className }: { tool: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("grid size-9 shrink-0 place-items-center rounded-[7px] border border-dashed border-muted/60 bg-sunken/60 text-ink", className)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={TOOL_PATHS[tool] ?? FALLBACK} />
      </svg>
    </span>
  );
}

export type DiamondTone = "ink" | "good" | "warn" | "bad" | "idle";

const toneClass: Record<DiamondTone, string> = {
  ink: "bg-ink border-ink",
  good: "bg-good border-good",
  warn: "bg-warn border-warn",
  bad: "bg-bad border-bad",
  idle: "bg-paper border-muted",
};

/** The timeline bullet: a small rotated square. While a step runs it breathes and a ring pulses behind it. */
export function Diamond({ tone, live, className }: { tone: DiamondTone; live?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cx("relative grid size-4 place-items-center", className)}>
      {live ? <span className="absolute size-3 rotate-45 border border-[var(--accent)] motion-safe:animate-ping" /> : null}
      <span className={cx("relative size-2.5 rotate-45 border", live ? "border-[var(--accent)] bg-[var(--accent)] motion-safe:animate-pulse" : toneClass[tone])} />
    </span>
  );
}

export function Chevron({ open, ...rest }: { open: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest} className={cx("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90", rest.className)}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}
