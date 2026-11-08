"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Callout, cx } from "@/components/ui";
import { useLocale } from "@/i18n/client";
import { createTranslator } from "@/i18n/translate";
import { useLiveActivity, usePlayers, useStdb } from "@/lib/stdb";
import { formatCount } from "./format";
import type { DataMessages } from "./messages";

const WINDOW_MINUTES = 60;

type LiveCounterProps = {
  messages: DataMessages["live"];
  className?: string;
};

/**
 * "Right now at HackUTD: N builders, M LEDs blinked, K drones flown", plus a
 * strip of events per minute. Everything is a live SpacetimeDB subscription:
 * builders are the players online, the rest comes from the per-minute
 * activity rows the module keeps.
 */
export function LiveCounter({ messages, className }: LiveCounterProps) {
  const locale = useLocale();
  const t = useMemo(() => createTranslator(locale, messages, `${locale}/data.live`), [locale, messages]);
  const { status } = useStdb();
  const { rows: players, ready: playersReady } = usePlayers();
  const { totals, minutes, ready: activityReady } = useLiveActivity(WINDOW_MINUTES);
  const headingId = useId();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const offline = status === "offline";
  const ready = playersReady && activityReady;

  const live = useMemo(() => {
    const perMinute = new Array<number>(WINDOW_MINUTES).fill(0);
    const nowMinute = Math.floor(now / 60_000);
    for (const row of minutes) {
      const age = nowMinute - Math.floor(Number(row.minute.microsSinceUnixEpoch / 1000n) / 60_000);
      if (age >= 0 && age < WINDOW_MINUTES) perMinute[WINDOW_MINUTES - 1 - age] += row.count;
    }
    return {
      builders: players.filter((p) => p.online).length,
      ledsBlinked: totals["led.blink"] ?? 0,
      dronesFlown: totals["flight.start"] ?? 0,
      events: perMinute.reduce((sum, n) => sum + n, 0),
      perMinute,
    };
  }, [players, totals, minutes, now]);

  return (
    <section aria-labelledby={headingId} className={cx("flex flex-col gap-3", className)}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="font-head text-lg leading-tight">
          {t("title")}
        </h2>
        {!offline && ready ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 font-ui text-xs font-bold text-muted">
            <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-line bg-tomato motion-safe:animate-pulse" />
            {t("live")}
          </span>
        ) : null}
      </header>

      {!offline && !ready ? (
        <div role="status" className="grid grid-cols-3 gap-2">
          <span className="sr-only">{t("loading")}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-ink-sm bg-sunken motion-safe:animate-pulse" />
          ))}
        </div>
      ) : null}

      {offline ? (
        <Callout variant="quiet" title={t("offTitle")}>
          <span className="mt-0.5 block">{t("offBody")}</span>
        </Callout>
      ) : null}

      {!offline && ready ? (
        <>
          <dl className="@container grid grid-cols-3 gap-3">
            <Counter value={formatCount(live.builders, locale)} label={t("builders", { count: live.builders })} />
            <Counter value={formatCount(live.ledsBlinked, locale)} label={t("leds", { count: live.ledsBlinked })} />
            <Counter value={formatCount(live.dronesFlown, locale)} label={t("drones", { count: live.dronesFlown })} />
          </dl>
          {live.events === 0 ? (
            <p className="rounded-ink-sm border-2 border-dashed border-line bg-sunken p-3 text-sm">{t("quiet")}</p>
          ) : (
            <figure className="flex flex-col gap-1">
              <Sparkline values={live.perMinute} label={t("chart")} />
              <figcaption className="text-xs text-muted">{t("window")}</figcaption>
            </figure>
          )}
        </>
      ) : null}
    </section>
  );
}

/** Number first, then its label, so each reads like "23 builders"; the number shrinks in a narrow dock. */
function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="ink-kicker leading-tight">{label}</dt>
      <dd className="tabular font-ui text-xl font-extrabold leading-tight tracking-tight @xs:text-2xl @md:text-3xl">{value}</dd>
    </div>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const width = values.length * 4;
  const height = 32;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-10 w-full overflow-visible"
    >
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * (height - 2)) : 0;
        return (
          <rect
            key={i}
            x={i * 4 + 0.5}
            y={height - h}
            width={3}
            height={h}
            className={i === values.length - 1 ? "fill-cobalt" : "fill-mint"}
          />
        );
      })}
      <line x1={0} x2={width} y1={height} y2={height} className="stroke-line" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
