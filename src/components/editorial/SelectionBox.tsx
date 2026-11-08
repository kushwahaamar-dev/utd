"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const CORNERS = ["-left-[3px] -top-[3px]", "-right-[3px] -top-[3px]", "-bottom-[3px] -left-[3px]", "-bottom-[3px] -right-[3px]"];

/**
 * A word in a design tool's selection: a blue outline, corner handles and a badge with the element's real size,
 * measured and kept in step as the text reflows.
 */
export function SelectionBox({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const box = el.getBoundingClientRect();
      const next = { w: Math.round(box.width), h: Math.round(box.height) };
      setSize((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className="relative mx-[1px] inline-block whitespace-nowrap px-[3px] text-ink">
      {children}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 border border-select">
        {CORNERS.map((corner) => (
          <span key={corner} className={`absolute size-[6px] border border-select bg-paper ${corner}`} />
        ))}
        {size ? (
          <span className="absolute left-1/2 top-[calc(100%+3px)] -translate-x-1/2 whitespace-nowrap rounded-[3px] bg-select px-[5px] py-px font-ui text-[10px] font-medium leading-[14px] tracking-normal text-white tabular-nums">
            {size.w} × {size.h}
          </span>
        ) : null}
      </span>
    </span>
  );
}
