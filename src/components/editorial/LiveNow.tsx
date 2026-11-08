"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatCount, formatLap } from "@/components/data/format";
import type { DataMessages } from "@/components/data/messages";
import { cx } from "@/components/ui/cx";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";
import { useLeaderboard, useLiveActivity, usePlayers, useStdb } from "@/lib/stdb";

const WINDOW_MINUTES = 60;
const SHOWN = 5;

export type LiveNowLabels = {
  /** The leaderboard's course in the page language, e.g. "the 5-inch gate race". */
  course: string;
  lobby: string;
};

type LiveNowProps = {
  locale: Locale;
  messages: DataMessages;
  /** Course id as the flight range names it. */
  course: string;
  labels: LiveNowLabels;
  lobbyHref: string;
  className?: string;
};

const kicker = "font-ui text-[11px] font-medium uppercase tracking-[0.1em] text-muted";

/**
 * Who is building right now, from the realtime server: counters and a per-minute strip on one side, the best laps
 * on a course on the other. When the server is unreachable it says so quietly and shows no numbers.
 */
export function LiveNow({ locale, messages, course, labels, lobbyHref, className }: LiveNowProps) {
  const live = useMemo(() => createTranslator(locale, messages.live, `${locale}/data.live`), [locale, messages.live]);
  const board = useMemo(() => createTranslator(locale, messages.leaderboard, `${locale}/data.leaderboard`), [locale, messages.leaderboard]);
  const { status, identity } = useStdb();
  const { rows: players, ready: playersReady } = usePlayers();
  const { totals, minutes, ready: activityReady } = useLiveActivity(WINDOW_MINUTES);
  const { entries, ready: boardReady } = useLeaderboard(course, SHOWN + 20);
  const [nowMinute, setNowMinute] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMinute(Math.floor(Date.now() / 60_000));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const offline = status === "offline";
  const countersReady = playersReady && activityReady;
  const perMinute = useMemo(() => {
    const bars = new Array<number>(WINDOW_MINUTES).fill(0);
    if (nowMinute === null) return bars;
    for (const row of minutes) {
      const age = nowMinute - Math.floor(Number(row.minute.microsSinceUnixEpoch / 1000n) / 60_000);
      if (age >= 0 && age < WINDOW_MINUTES) bars[WINDOW_MINUTES - 1 - age] += row.count;
    }
    return bars;
  }, [minutes, nowMinute]);
  const builders = players.filter((p) => p.online).length;
  const events = perMinute.reduce((sum, n) => sum + n, 0);
  const top = entries.slice(0, SHOWN);

  return (
    <div className={cx("grid gap-x-[clamp(32px,5vw,80px)] gap-y-9 rounded-2xl border border-(--card-line) bg-surface p-5 min-[520px]:grid-cols-2 sm:p-7 lg:grid-cols-[7fr_5fr] lg:p-9", className)}>
      <div className="min-w-0">
        <h3 className={cx(kicker, "flex items-center gap-2")}>
          {live("title")}
          {!offline && countersReady ? <span aria-hidden="true" className="size-1.5 rounded-full bg-pcb [animation:led-blink_2.4s_ease-in-out_infinite]" /> : null}
        </h3>
        {offline ? (
          <Quiet title={live("offTitle")}>{live("offBody")}</Quiet>
        ) : !countersReady ? (
          <Skeleton label={live("loading")} rows={3} />
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3 border-y border-rule py-3">
              <Counter value={formatCount(builders, locale)} label={live("builders", { count: builders })} />
              <Counter value={formatCount(totals["led.blink"] ?? 0, locale)} label={live("leds", { count: totals["led.blink"] ?? 0 })} />
              <Counter value={formatCount(totals["flight.start"] ?? 0, locale)} label={live("drones", { count: totals["flight.start"] ?? 0 })} />
            </dl>
            {events === 0 ? (
              <p className="mt-3 text-[14px] leading-[1.55] text-muted">{live("quiet")}</p>
            ) : (
              <figure className="mt-3">
                <Sparkline values={perMinute} label={live("chart")} />
                <figcaption className="mt-1 text-xs text-muted">{live("window")}</figcaption>
              </figure>
            )}
          </>
        )}
        <Link href={lobbyHref} className="mt-3 inline-flex min-h-8 items-center gap-1 text-[14px] font-medium no-underline hover:underline">
          {labels.lobby}
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="min-w-0">
        <h3 className={kicker}>{board("title")}</h3>
        <p className="mt-1 text-xs text-muted">{board("caption", { course: labels.course })}</p>
        {offline ? (
          <Quiet title={board("offTitle")}>{board("offBody")}</Quiet>
        ) : !boardReady ? (
          <Skeleton label={board("loading")} rows={3} />
        ) : top.length === 0 ? (
          <p className="mt-3 text-[14px] leading-[1.55] text-muted">{board("empty")}</p>
        ) : (
          <ol className="mt-3 divide-y divide-rule border-y border-rule">
            {top.map((entry, i) => {
              const you = !!identity && entry.identity.isEqual(identity);
              return (
                <li key={entry.identity.toHexString()} aria-current={you ? "true" : undefined} className="flex items-center gap-3 py-2.5 text-[14px]">
                  <span aria-hidden="true" className="w-4 shrink-0 font-ui text-xs tabular-nums text-muted">
                    {i + 1}
                  </span>
                  <span className={cx("min-w-0 flex-1 truncate", !entry.name && "text-muted")}>{entry.name || board("anonymous")}</span>
                  {you ? <span className="shrink-0 rounded-full border border-(--card-line) px-2 py-px text-[11px]">{board("you")}</span> : null}
                  <span className="shrink-0 font-ui text-xs tabular-nums text-muted">{formatLap(entry.bestMs, locale)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="text-xs leading-tight text-muted">{label}</dt>
      <dd className="font-ui text-2xl font-medium leading-tight tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}

function Quiet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-y border-rule py-3">
      <p className="text-[14px] font-medium">{title}</p>
      <p className="mt-1 text-[14px] leading-[1.55] text-muted">{children}</p>
    </div>
  );
}

function Skeleton({ label, rows }: { label: string; rows: number }) {
  return (
    <div role="status" className="mt-3 divide-y divide-rule border-y border-rule">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="py-2.5">
          <div className="h-4 rounded-sm bg-sunken motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const height = 32;
  const width = values.length * 4;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-10 w-full overflow-visible">
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * (height - 2)) : 0;
        return <rect key={i} x={i * 4 + 0.5} y={height - h} width={3} height={h} rx={0.8} className={i === values.length - 1 ? "fill-select" : "fill-pcb"} />;
      })}
      <line x1={0} x2={width} y1={height} y2={height} className="stroke-rule" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
