import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { Stamp, type StampMotif, type StampTone } from "./Stamp";

/** The page's one narrow column. `wide` is for the hero and anything that earns a little more room. */
export function Column({ wide, className, ...rest }: ComponentProps<"div"> & { wide?: boolean }) {
  return (
    <div
      className={cx("mx-auto", wide ? "w-[min(var(--column-wide),calc(100%-2rem))]" : "w-[min(var(--column),calc(100%-2.5rem))]", className)}
      {...rest}
    />
  );
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
  children: ReactNode;
  className?: string;
};

/** A titled section: a postage stamp, a small heading, then the content a little way below. */
export function Section({ id, title, n, motif, tone, tilt, aside, children, className }: SectionProps) {
  return (
    <section aria-labelledby={id} className={cx("mt-[clamp(64px,8vw,104px)]", className)}>
      <header className="flex items-center gap-3.5">
        <Stamp motif={motif} tone={tone} value={n} tilt={tilt} size={46} />
        <h2 id={id} className="min-w-0 flex-1 text-[18px] font-medium leading-snug tracking-[-0.014em]">
          {title}
        </h2>
        {aside}
      </header>
      <div className="mt-6">{children}</div>
    </section>
  );
}
