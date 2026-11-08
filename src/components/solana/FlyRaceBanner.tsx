"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Callout, Chip } from "@/components/ui";
import { useLocale } from "@/i18n/client";
import { useRaces } from "@/lib/stdb";
import { formatLap, formatSol } from "./format";
import { SolanaText, useSolanaT } from "./SolanaText";
import { raceFlyHref, splitRaceCourse } from "./race-link";
import { useRaceView } from "./useRaceView";

type Props = {
  /** The `race` query param: the module's race id. */
  raceId: string;
  /** The drone whose fly page this is. */
  drone: string;
  /** Called once when the race is on this drone, with the course id inside the drone's range. */
  onCourse?: (courseId: string) => void;
};

function Banner({ raceId, drone, onCourse }: Props) {
  const t = useSolanaT();
  const lang = useLocale();
  const { races } = useRaces();
  const race = races.find((r) => r.id.toString() === raceId);
  const view = useRaceView(race);
  const parts = race ? splitRaceCourse(race.course) : null;
  const here = parts?.drone === drone;
  const called = useRef(false);

  useEffect(() => {
    if (!here || !parts || called.current) return;
    called.current = true;
    onCourse?.(parts.courseId);
  }, [here, parts, onCourse]);

  if (!race || !view) return null;
  const other = parts && !here ? raceFlyHref(lang, race.course, race.id) : null;

  return (
    <Callout tone="note" title={t("races.banner.title")}>
      <div className="grid gap-2 text-sm">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Chip tone={view.card.status === "open" ? "mint" : "mustard"} dot>
            {view.card.status === "open" ? t("races.card.open") : t("races.card.closedStatus")}
          </Chip>
          <span>
            {t("races.card.pot")}: <strong className="tabular">{formatSol(view.card.potLamports)}</strong>
          </span>
          <span>
            {t("races.card.entryFee")}: <span className="tabular">{formatSol(view.card.entryLamports)}</span>
          </span>
        </p>
        {view.card.status !== "open" ? (
          <p>{t("races.banner.closedNote")}</p>
        ) : !view.mine ? (
          <p>{t("races.banner.notIn")}</p>
        ) : view.mine.bestMs == null ? (
          <p>{t("races.banner.noLap")}</p>
        ) : (
          <p>
            {t("races.banner.yourBest")}: <strong className="tabular">{formatLap(view.mine.bestMs)}</strong>
            {view.myRank ? <> · {t("races.banner.rank", { rank: view.myRank, count: view.finishers })}</> : null}
          </p>
        )}
        {other ? (
          <p>
            {t("races.banner.otherDrone", { drone: parts?.drone ?? "" })}{" "}
            <Link href={other} className="font-bold">
              {t("races.banner.flyThere")}
            </Link>
          </p>
        ) : null}
        <p>
          <Link href={`/${lang}/races`} className="font-bold">
            {view.mine || view.card.status !== "open" ? t("races.banner.allRaces") : t("races.banner.enterOn")}
          </Link>
        </p>
      </div>
    </Callout>
  );
}

/** Shown on the drone fly page when it opens with ?race=<id>; loads its own strings. */
export function FlyRaceBanner(props: Props) {
  return (
    <SolanaText>
      <Banner {...props} />
    </SolanaText>
  );
}
