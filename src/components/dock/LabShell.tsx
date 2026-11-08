"use client";

import {
  useCallback,
  useId,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useCommonT } from "@/i18n/client";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import "./LabShell.css";

type Layout = {
  l: number | null;
  r: number | null;
  lOpen: boolean;
  rOpen: boolean;
};

const DEFAULT: Layout = { l: null, r: null, lOpen: true, rOpen: true };
const LIMITS = { l: [224, 560], r: [320, 920] } as const;
const STAGE_MIN = 360;

const layouts = new Map<string, Layout>();
const listeners = new Set<() => void>();

function clamp(n: number, [lo, hi]: readonly [number, number]) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function read(key: string): Layout {
  try {
    const raw = JSON.parse(
      localStorage.getItem(`iynk:labshell:${key}`) ?? "null",
    ) as Partial<Layout> | null;
    if (!raw || typeof raw !== "object") return DEFAULT;
    return {
      l: typeof raw.l === "number" ? clamp(raw.l, LIMITS.l) : null,
      r: typeof raw.r === "number" ? clamp(raw.r, LIMITS.r) : null,
      lOpen: raw.lOpen !== false,
      rOpen: raw.rOpen !== false,
    };
  } catch {
    return DEFAULT;
  }
}

function snapshot(key: string): Layout {
  let value = layouts.get(key);
  if (!value) {
    value = read(key);
    layouts.set(key, value);
  }
  return value;
}

function commit(key: string, patch: Partial<Layout>) {
  const next = { ...snapshot(key), ...patch };
  layouts.set(key, next);
  try {
    localStorage.setItem(`iynk:labshell:${key}`, JSON.stringify(next));
  } catch {
    // private window or blocked storage: the layout still holds for this visit
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

type SplitterProps = {
  side: "l" | "r";
  panel: string;
  open: boolean;
  /** The element whose width the splitter sets. */
  target: React.RefObject<HTMLElement | null>;
  shell: React.RefObject<HTMLDivElement | null>;
  onSize: (px: number | null, commitNow: boolean) => void;
  onToggle: () => void;
  className: string;
};

function Splitter({
  side,
  panel,
  open,
  target,
  shell,
  onSize,
  onToggle,
  className,
}: SplitterProps) {
  const t = useCommonT();
  const drag = useRef<{ x: number; w: number; now: number } | null>(null);
  const limits = LIMITS[side];
  const sign = side === "l" ? 1 : -1;

  const [now, setNow] = useState(0);
  useEffect(() => {
    const el = target.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() =>
      setNow(Math.round(el.getBoundingClientRect().width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [target]);

  const width = () => target.current?.getBoundingClientRect().width ?? 0;
  // The stage keeps STAGE_MIN px: the other rail's width is what is left of the shell.
  const max = () => {
    const total = shell.current?.getBoundingClientRect().width ?? 0;
    const other =
      shell.current
        ?.querySelector<HTMLElement>(
          side === "l" ? "[data-lab-rail=right]" : "[data-lab-rail=left]",
        )
        ?.getBoundingClientRect().width ?? 0;
    return Math.max(
      limits[0],
      Math.min(limits[1], total - other - STAGE_MIN - 48),
    );
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!open || e.button !== 0 || (e.target as HTMLElement).closest("button"))
      return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width(), now: width() };
    e.currentTarget.dataset.drag = "true";
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    d.now = Math.min(
      max(),
      Math.max(limits[0], d.w + (e.clientX - d.x) * sign),
    );
    onSize(d.now, false);
  }
  function end(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    delete e.currentTarget.dataset.drag;
    onSize(d.now, true);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    const step = e.shiftKey ? 64 : 16;
    const grow = side === "l" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "l" ? "ArrowLeft" : "ArrowRight";
    let next: number | null | undefined;
    if (e.key === grow) next = width() + step;
    else if (e.key === shrink) next = width() - step;
    else if (e.key === "Home") next = limits[0];
    else if (e.key === "End") next = max();
    else if (e.key === "Enter") next = null;
    else return;
    e.preventDefault();
    onSize(
      next === null ? null : Math.min(max(), Math.max(limits[0], next)),
      true,
    );
  }

  const name = t("labshell.resize", { panel });
  const toggleName = t(open ? "labshell.collapse" : "labshell.expand", {
    panel,
  });
  const Chevron = (open ? side === "l" : side === "r")
    ? "chevron-left"
    : "chevron-right";

  return (
    <div className={className}>
      <div
        role={open ? "separator" : undefined}
        aria-orientation={open ? "vertical" : undefined}
        aria-label={open ? name : undefined}
        aria-valuenow={open ? now : undefined}
        aria-valuemin={open ? limits[0] : undefined}
        aria-valuemax={open ? limits[1] : undefined}
        tabIndex={open ? 0 : undefined}
        data-closed={!open}
        className="lab-grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        onDoubleClick={() => open && onSize(null, true)}
      />
      <button
        type="button"
        className="lab-collapse"
        aria-label={toggleName}
        aria-expanded={open}
        title={toggleName}
        onClick={onToggle}
      >
        <Icon name={Chevron} size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

type LabShellProps = {
  /** A <WorkspaceBar>. */
  bar: ReactNode;
  /** The figure column: toolbar row, <FigureFrame fill>, overlays, a readout row or <StageDrawer>. */
  stage: ReactNode;
  /** The guide: lesson text, steps, overview. Leave out for a shell with two columns. */
  left?: ReactNode;
  /** The guide brings its own scrolling and padding (a <Tabs fill>). */
  leftFlush?: boolean;
  /** Its heading and the name of its splitter. */
  leftLabel?: string;
  /** The inspector: usually <Tabs fill> inside a <Panel>. */
  right: ReactNode;
  rightLabel: string;
  /** Where the panel sizes are remembered, per lab: "board", "lesson", "bench", "drone". */
  storageKey: string;
  /** Under lg: "sticky" pins the stage under the header while the rest scrolls past; "full" gives it the screen. */
  phoneStage?: "sticky" | "full";
  /** Under lg, which of the two panels follows the stage. */
  phoneFirst?: "left" | "right";
  className?: string;
} & Omit<ComponentProps<"div">, "className" | "children">;

/**
 * Pro-tool workspace layout. From 80rem: guide | stage | inspector, each rail
 * resizable (drag, arrow keys, double-click to reset) and collapsible, sizes kept
 * in localStorage. From 64rem the guide stacks over the inspector beside the
 * stage. Under that the page is one column with the stage pinned on top.
 */
export function LabShell({
  bar,
  stage,
  left,
  leftLabel,
  leftFlush,
  right,
  rightLabel,
  storageKey,
  phoneStage = "sticky",
  phoneFirst = "right",
  className,
  ...rest
}: LabShellProps) {
  const layout = useSyncExternalStore(
    subscribe,
    () => snapshot(storageKey),
    () => DEFAULT,
  );
  const t = useCommonT();
  const id = useId();
  const shell = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const resize = useCallback(
    (side: "l" | "r") => (px: number | null, commitNow: boolean) => {
      const prop = side === "l" ? "--l-eff" : "--r-eff";
      if (!commitNow) return shell.current?.style.setProperty(prop, `${px}px`);
      if (px === null) shell.current?.style.removeProperty(prop);
      commit(storageKey, { [side]: px });
    },
    [storageKey],
  );

  const style: CSSProperties = {
    ...(layout.l !== null ? { "--l-eff": `${layout.l}px` } : null),
    ...(layout.r !== null ? { "--r-eff": `${layout.r}px` } : null),
  } as CSSProperties;
  const lOpen = layout.lOpen;
  const toggleLeft = () => commit(storageKey, { lOpen: !lOpen });

  return (
    <div
      ref={shell}
      data-frame="workspace"
      data-phone-stage={phoneStage}
      data-phone-first={phoneFirst}
      data-left={left ? "rail" : "none"}
      data-l-open={lOpen}
      data-r-open={layout.rOpen}
      className={cx("lab-shell", className)}
      style={style}
      {...rest}
    >
      <div className="lab-bar">{bar}</div>
      {left ? (
        <div
          ref={leftRef}
          data-lab-rail="left"
          data-open={lOpen}
          className="lab-left"
        >
          <section
            aria-labelledby={`${id}-left`}
            className="ink-card flex min-h-0 flex-col overflow-clip"
          >
            <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-rule ps-4 pe-1.5">
              <h2
                id={`${id}-left`}
                className="min-w-0 flex-1 truncate font-head text-lg"
              >
                {leftLabel}
              </h2>
              <IconButton
                icon="chevron-down"
                size="sm"
                label={t(lOpen ? "labshell.collapse" : "labshell.expand", {
                  panel: leftLabel ?? "",
                })}
                aria-expanded={lOpen}
                className="lab-header-toggle"
                onClick={toggleLeft}
              />
            </div>
            <div
              tabIndex={leftFlush ? undefined : 0}
              className={cx(
                "min-h-0 flex-1",
                leftFlush ? "flex flex-col" : "overflow-y-auto p-4",
              )}
            >
              {left}
            </div>
          </section>
        </div>
      ) : null}
      {left ? (
        <Splitter
          side="l"
          panel={leftLabel ?? ""}
          open={lOpen}
          target={leftRef}
          shell={shell}
          onSize={resize("l")}
          onToggle={toggleLeft}
          className="lab-splitter-left"
        />
      ) : null}
      <div className="lab-stage">{stage}</div>
      <Splitter
        side="r"
        panel={rightLabel}
        open={layout.rOpen}
        target={rightRef}
        shell={shell}
        onSize={resize("r")}
        onToggle={() => commit(storageKey, { rOpen: !layout.rOpen })}
        className="lab-splitter-right"
      />
      <div ref={rightRef} data-lab-rail="right" className="lab-right">
        {right}
      </div>
    </div>
  );
}
