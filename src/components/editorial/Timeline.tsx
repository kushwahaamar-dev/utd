import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export type TimelineItem = {
  title: ReactNode;
  /** The dates, version or role on the line under the title. */
  meta?: string;
  text?: string;
  bullets?: readonly string[];
};

/** Entries on a dotted vertical connector, each marked with a diamond; sub-points get small dots. */
export function Timeline({ items, className }: { items: readonly TimelineItem[]; className?: string }) {
  return (
    <ol className={cx("flex flex-col", className)}>
      {items.map((item, i) => (
        <li key={i} className="relative ps-7 pb-8 last:pb-0">
          {i < items.length - 1 ? <span aria-hidden="true" className="absolute start-[4.5px] top-5 bottom-1 border-s border-dotted border-muted/55" /> : null}
          <span aria-hidden="true" className="absolute start-0 top-[7px] size-[10px] rotate-45 rounded-[2px] bg-copper" />
          <h3 className="text-[15px] font-medium leading-snug">{item.title}</h3>
          {item.meta ? <p className="mt-0.5 font-ui text-xs text-muted">{item.meta}</p> : null}
          {item.text ? <p className="mt-2 text-[14px] leading-[1.55] text-muted">{item.text}</p> : null}
          {item.bullets?.length ? (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {item.bullets.map((bullet) => (
                <li key={bullet} className="flex items-baseline gap-2.5 text-[14px] leading-[1.5] text-muted">
                  <span aria-hidden="true" className="size-1 shrink-0 translate-y-[-2px] rounded-full bg-select" />
                  {bullet}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
