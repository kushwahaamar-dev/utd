"use client";

import { useEffect, useRef } from "react";

// A bus along the top that repeats at any width, drawn once as a mask so the colour can follow the theme.
const BAR = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="36" fill="none" stroke="#000" stroke-width="1.2" stroke-linejoin="round"><path d="M0 9H50L58 17H100L108 9H150L158 17H200L208 9H240"/><path d="M0 25H70L76 21H130L136 25H240"/><path d="M0 31H22L26 27H64" opacity=".7"/><path d="M168 31H240" opacity=".7"/><g fill="#000" stroke="none"><circle cx="50" cy="9" r="2"/><circle cx="108" cy="9" r="2"/><circle cx="158" cy="17" r="2"/><circle cx="208" cy="9" r="2"/><circle cx="76" cy="21" r="2"/><circle cx="136" cy="25" r="2"/><circle cx="64" cy="27" r="1.6"/></g><g stroke-width="1"><circle cx="58" cy="17" r="3.4"/><circle cx="200" cy="17" r="3.4"/><circle cx="130" cy="21" r="3.4"/></g></svg>`,
);

function Side({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 560"
      width="64"
      height="560"
      aria-hidden="true"
      focusable="false"
      className={`absolute top-0 hidden text-(--trace) lg:block ${flip ? "right-0 -scale-x-100" : "left-0"}`}
      style={{ maskImage: "linear-gradient(to bottom, #000 35%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 35%, transparent)" }}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
        <path d="M14 0V120L26 132V250L14 262V430L22 438V560" />
        <path d="M30 0V70L42 82V180L30 192V320L42 332V470" opacity=".8" />
        <path d="M46 0V40L54 48V120" opacity=".6" />
        <circle cx="26" cy="132" r="3.4" />
        <circle cx="14" cy="262" r="3.4" />
        <circle cx="42" cy="332" r="3.4" />
        <circle cx="54" cy="120" r="3" />
      </g>
      <g fill="currentColor">
        <circle cx="14" cy="120" r="2" />
        <circle cx="30" cy="70" r="2" />
        <circle cx="30" cy="320" r="2" />
        <circle cx="42" cy="470" r="2" />
      </g>
      <g fill="none" stroke="var(--trace-pulse)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path className="trace-pulse" style={{ animationDelay: "1s" }} pathLength="100" d="M14 0V120L26 132V250L14 262V430L22 438V560" />
        <path className="trace-pulse" style={{ animationDelay: "5.5s", animationDuration: "9s" }} pathLength="100" d="M30 0V70L42 82V180L30 192V320L42 332V470" />
      </g>
    </svg>
  );
}

/**
 * Ornament: a PCB bus along the top edge and a pair of traces down the sides, with the odd pulse of current
 * running along them. Pure decoration, it pauses itself when scrolled out of view.
 */
export function PcbTraces() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      el.dataset.paused = entry.isIntersecting ? "false" : "true";
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className="pcb pointer-events-none absolute inset-x-0 top-0 z-0 h-[560px] overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-9 overflow-hidden bg-(--trace) [mask-repeat:repeat-x]"
        style={{
          maskImage: `url("data:image/svg+xml,${BAR}")`,
          WebkitMaskImage: `url("data:image/svg+xml,${BAR}")`,
        }}
      >
        <div className="pcb-sweep absolute inset-y-0 start-0 w-40 bg-[linear-gradient(90deg,transparent,var(--trace-pulse),transparent)]" />
      </div>
      <Side />
      <Side flip />
    </div>
  );
}
