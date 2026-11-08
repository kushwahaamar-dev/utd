// Layout primitives for the editorial pages. Pages use the whole screen on desktop and stack on phones.
//
//   <Container>                 page frame: fluid gutters, up to 1600px, same edges as the header and footer
//   <Container bleed>           edge to edge, no gutter (full-bleed bands); put a <Container> inside for text
//   <Grid>                      one column below 1024px, 12 columns from 1024px up (gap scales with the viewport)
//   <Cell span={7} start={1}>   place content on the 12 columns from 1024px up; `span` 1-12, `start` 1-12.
//                               Below 1024px every cell is full width. `sm` does the same from 640px (6-column row).
//   <Prose>                     caps long-form text at ~70ch; use it inside wide cells
//   <Section ...>               stamped section header + content. `split` puts the header on the left four columns
//                               (sticky) and the content on the right eight from 1024px up.
//
// `riseIndex(n)` staggers the .rise entrance. No Date/Math.random: everything here prerenders.

import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { Stamp, type StampMotif, type StampTone } from "./Stamp";

type ContainerProps = ComponentProps<"div"> & {
  /** Edge to edge: no max width and no gutter. */
  bleed?: boolean;
};

/** The page frame. Its edges line up with the header and footer (--shell-max / --shell-pad in globals.css). */
export function Container({ bleed, className, ...rest }: ContainerProps) {
  return <div className={cx("mx-auto w-full", bleed ? undefined : "max-w-(--shell-max) px-(--shell-pad)", className)} {...rest} />;
}

export function Prose({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cx("max-w-[70ch] text-pretty", className)} {...rest} />;
}

// Tailwind only emits classes it can see, so the 12 spans and starts are spelled out.
const SPAN = ["", "lg:col-span-1", "lg:col-span-2", "lg:col-span-3", "lg:col-span-4", "lg:col-span-5", "lg:col-span-6", "lg:col-span-7", "lg:col-span-8", "lg:col-span-9", "lg:col-span-10", "lg:col-span-11", "lg:col-span-12"] as const;
const START = ["", "lg:col-start-1", "lg:col-start-2", "lg:col-start-3", "lg:col-start-4", "lg:col-start-5", "lg:col-start-6", "lg:col-start-7", "lg:col-start-8", "lg:col-start-9", "lg:col-start-10", "lg:col-start-11", "lg:col-start-12"] as const;
const SM_SPAN = ["", "sm:col-span-1", "sm:col-span-2", "sm:col-span-3", "sm:col-span-4", "sm:col-span-5", "sm:col-span-6"] as const;

type Count = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export function Grid({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cx("grid grid-cols-1 gap-x-[clamp(16px,2vw,32px)] gap-y-10 sm:grid-cols-6 lg:grid-cols-12", className)} {...rest} />;
}

export function Cell({ span = 12, start, sm, className, ...rest }: ComponentProps<"div"> & { span?: Count; start?: Count; sm?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  return <div className={cx("col-span-full min-w-0", sm && SM_SPAN[sm], SPAN[span], start && START[start], className)} {...rest} />;
}

/** Stagger for `.rise`: element n starts n x 70ms after the first. */
export function riseIndex(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

type SectionProps = {
  id: string;
  title: string;
  /** The stamp's denomination, usually the section number. */
  n?: string;
  motif: StampMotif;
  tone?: StampTone;
  tilt?: number;
  aside?: ReactNode;
  /** Short text under the header, shown with it in `split` mode. */
  lede?: ReactNode;
  /** Header left, content right on desktop. */
  split?: boolean;
  children: ReactNode;
  className?: string;
};

/** A titled section: a postage stamp, a small heading, then the content a little way below. */
export function Section({ id, title, n, motif, tone, tilt, aside, lede, split, children, className }: SectionProps) {
  const header = (
    <>
      <header className="flex items-center gap-3.5">
        <Stamp motif={motif} tone={tone} value={n} tilt={tilt} size={46} />
        <h2 id={id} className="min-w-0 flex-1 text-[18px] font-medium leading-snug tracking-[-0.014em]">
          {title}
        </h2>
        {aside}
      </header>
      {lede ? <div className="mt-4 max-w-[46ch] text-[15px] leading-[1.6] text-muted">{lede}</div> : null}
    </>
  );
  return (
    <section aria-labelledby={id} className={cx("mt-[clamp(64px,8vw,120px)]", className)}>
      {split ? (
        <Grid className="gap-y-6">
          <Cell span={4} className="lg:sticky lg:top-24 lg:self-start">
            {header}
          </Cell>
          <Cell span={8} start={5}>
            {children}
          </Cell>
        </Grid>
      ) : (
        <>
          {header}
          <div className="mt-6">{children}</div>
        </>
      )}
    </section>
  );
}
