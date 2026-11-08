"use client";

import { useId, useMemo } from "react";
import { Callout, Chip, cx } from "@/components/ui";
import { useLocale } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { createTranslator, type Translate } from "@/i18n/translate";
import { useLeaderboard, useStdb } from "@/lib/stdb";
import { formatLap } from "./format";
import type { DataMessages } from "./messages";

type LeaderboardProps = {
  /** Course id, as the flight range names it ("quad5-bando"). */
  course: string;
  /** The course's title in the page language, for the caption. */
  courseLabel: string;
  messages: DataMessages["leaderboard"];
  /** Rows shown above the pilot's own (1-50). */
  limit?: number;
  className?: string;
};

type Row = { rank: number; name: string; timeMs: number; you: boolean };

/**
 * Best lap per pilot on one course, ranked, with the pilot's own place even
 * when it is below the shown rows. Rows arrive over the SpacetimeDB
 * subscription, so a lap flown in another tab shows up without a refresh.
 */
export function Leaderboard({ course, courseLabel, messages, limit = 10, className }: LeaderboardProps) {
  const locale = useLocale();
  const t = useMemo(() => createTranslator(locale, messages, `${locale}/data.leaderboard`), [locale, messages]);
  const { status, identity } = useStdb();
  const { entries, ready } = useLeaderboard(course, 500);
  const headingId = useId();

  const rows = useMemo<Row[]>(
    () =>
      entries.map((e, i) => ({
        rank: i + 1,
        name: e.name,
        timeMs: e.bestMs,
        you: !!identity && e.identity.isEqual(identity),
      })),
    [entries, identity],
  );
  const shown = rows.slice(0, limit);
  const own = rows.find((r) => r.you);
  const ownBelow = own && !shown.includes(own) ? own : null;
  const offline = status === "offline";

  return (
    <section aria-labelledby={headingId} className={cx("flex flex-col gap-3", className)}>
      <header className="min-w-0">
        <h2 id={headingId} className="font-head text-lg leading-tight">
          {t("title")}
        </h2>
        <p className="text-sm text-muted">{t("caption", { course: courseLabel })}</p>
      </header>

      {offline ? (
        <Callout variant="quiet" title={t("offTitle")}>
          <span className="mt-0.5 block">{t("offBody")}</span>
        </Callout>
      ) : null}

      {!offline && !ready ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">{t("loading")}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 rounded-ink-sm bg-sunken motion-safe:animate-pulse" />
          ))}
        </div>
      ) : null}

      {!offline && ready && rows.length === 0 ? (
        <p role="status" className="text-sm text-muted">
          {t("empty")}
        </p>
      ) : null}

      {!offline && ready && rows.length > 0 ? (
        <>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("caption", { course: courseLabel })}</caption>
            <thead>
              <tr className="ink-kicker text-start">
                <th scope="col" className="w-10 pb-1 text-start font-bold">
                  {t("rank")}
                </th>
                <th scope="col" className="pb-1 text-start font-bold">
                  {t("pilot")}
                </th>
                <th scope="col" className="pb-1 text-end font-bold">
                  {t("best")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <BoardRow key={row.rank} row={row} t={t} locale={locale} />
              ))}
              {ownBelow ? (
                <>
                  <tr aria-hidden="true">
                    <td colSpan={3} className="py-1 text-center text-muted">
                      ⋯
                    </td>
                  </tr>
                  <BoardRow row={ownBelow} t={t} locale={locale} />
                </>
              ) : null}
            </tbody>
          </table>
          <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{t("pilots", { count: rows.length })}</span>
            <span>{own ? t("yourRank", { rank: own.rank }) : t("notOnBoard")}</span>
          </p>
        </>
      ) : null}
    </section>
  );
}

function BoardRow({ row, t, locale }: { row: Row; t: Translate<DataMessages["leaderboard"]>; locale: Locale }) {
  return (
    <tr aria-current={row.you ? "true" : undefined} className={cx("border-t-[1.5px] border-rule", row.you && "bg-mustard/35")}>
      <td className="py-2 pe-2 font-ui font-extrabold tabular">{row.rank}</td>
      <td className="max-w-0 py-2 pe-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className={cx("[overflow-wrap:anywhere]", !row.name && "italic text-muted")}>{row.name || t("anonymous")}</span>
          {row.you ? (
            <Chip tone="ink" className="shrink-0">
              {t("you")}
            </Chip>
          ) : null}
        </span>
      </td>
      <td className="py-2 text-end font-ui font-bold tabular">{formatLap(row.timeMs, locale)}</td>
    </tr>
  );
}
