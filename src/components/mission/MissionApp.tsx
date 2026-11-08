"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, type ReactNode } from "react";
import { ActionLink, Note, eyebrow, page } from "@/components/editorial/Editorial";
import { cx } from "@/components/ui/cx";
import type { Locale } from "@/i18n/config";
import { Composer } from "./Composer";
import { createDemoAdapter, MissionDataProvider, useMission, useMissionMode, useMyMissions, useStartMission, type MissionAdapter } from "./data";
import { JobHeader } from "./JobHeader";
import { Proposals, ResultPanel } from "./ResultPanel";
import { MissionTextProvider, useMissionText, type MissionMessages } from "./text";
import { Trace } from "./Trace";
import { isActive, type JobKind, type Step } from "./types";
import { readCritic } from "./view";

const column = "mx-auto w-full max-w-[880px]";

/** The page body for /mission, where ?job= picks a mission (the static layout cannot take a path segment for it). The live backend plugs in through `live`; without it only the recorded demo runs. */
export function MissionApp({ lang, messages, head, live }: { lang: Locale; messages: MissionMessages; head?: ReactNode; live?: MissionAdapter }) {
  return (
    <MissionTextProvider locale={lang} messages={messages}>
      <Suspense fallback={<div className={cx(page, "min-h-[50vh]")} aria-busy="true" />}>
        <Frame lang={lang} head={head} live={live} />
      </Suspense>
    </MissionTextProvider>
  );
}

function Frame({ lang, head, live }: { lang: Locale; head?: ReactNode; live?: MissionAdapter }) {
  const params = useSearchParams();
  const jobId = params.get("job") || undefined;
  const demo = params.get("demo") === "1";
  const speed = Math.min(20, Math.max(1, Number(params.get("speed")) || 1));
  const adapter = useMemo(() => (demo ? createDemoAdapter(speed) : live), [demo, speed, live]);
  const roomCode = params.get("room")?.slice(0, 12) || undefined;

  if (!adapter) return <Offline lang={lang} jobId={jobId} />;
  return (
    <MissionDataProvider adapter={adapter}>
      {jobId ? null : <div className={page}>{head}</div>}
      <div className={cx(page, "pb-[clamp(72px,10vw,160px)]")}>
        {jobId ? <JobView lang={lang} jobId={jobId} /> : <Home lang={lang} roomCode={roomCode} />}
      </div>
    </MissionDataProvider>
  );
}

function demoQuery(search: URLSearchParams, keys: readonly string[] = ["demo", "speed", "room"]): string {
  const keep = new URLSearchParams();
  for (const key of keys) {
    const value = search.get(key);
    if (value) keep.set(key, value);
  }
  const text = keep.toString();
  return text ? `?${text}` : "";
}

function Offline({ lang, jobId }: { lang: Locale; jobId?: string }) {
  const { t } = useMissionText();
  return (
    <div className={cx(page, "pb-[clamp(72px,10vw,160px)]")}>
      <div className={cx(column, "mt-12")}>
        <Note
          title={t("state.offline.title")}
          action={
            <ActionLink kind="primary" href={`/${lang}/mission?${jobId ? `job=${encodeURIComponent(jobId)}&` : ""}demo=1`}>
              {t("state.offline.demo")}
            </ActionLink>
          }
        >
          {t("state.offline.body")}
        </Note>
      </div>
    </div>
  );
}

function Home({ lang, roomCode }: { lang: Locale; roomCode?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const start = useStartMission();
  const missions = useMyMissions();
  const { t } = useMissionText();
  const query = demoQuery(search);

  async function onStart(input: { kind: JobKind; goal: string; roomCode?: string }) {
    const id = await start(input);
    router.push(`/${lang}/mission?job=${encodeURIComponent(id)}${query ? `&${query.slice(1)}` : ""}`);
  }

  return (
    <div className={cx(column, "mt-10 sm:mt-14")}>
      <Composer roomCode={roomCode} onStart={onStart} />
      {missions.length ? (
        <section aria-labelledby="recent-title" className="mt-12">
          <h2 id="recent-title" className={eyebrow}>
            {t("recent.title")}
          </h2>
          <ul className="mt-4 list-none divide-y divide-rule p-0">
            {missions.slice(0, 6).map((job) => (
              <li key={job.id}>
                <Link href={`/${lang}/mission?job=${encodeURIComponent(job.id)}${query ? `&${query.slice(1)}` : ""}`} className="flex items-baseline justify-between gap-4 py-3 no-underline hover:text-muted">
                  <span className="min-w-0 truncate">{job.goal}</span>
                  <span className="shrink-0 text-sm text-muted">{t(`status.${job.status}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function JobView({ lang, jobId }: { lang: Locale; jobId: string }) {
  const { t } = useMissionText();
  const search = useSearchParams();
  const mission = useMission(jobId);
  const mode = useMissionMode();
  const { job, steps, proposals, watchers } = mission;
  const home = `/${lang}/mission${demoQuery(search, ["demo", "room"])}`;

  return (
    <div className={cx(column, "mt-8 sm:mt-12")}>
      <Link href={home} className="inline-flex min-h-10 items-center text-sm text-muted no-underline hover:text-ink">
        {`← ${t("job.newMission")}`}
      </Link>

      {mission.state === "loading" ? (
        <p className="mt-6 text-muted" role="status">
          {t("state.loading")}
        </p>
      ) : mission.state === "missing" ? (
        <Note title={t("state.missing.title")} action={<ActionLink kind="primary" href={home}>{t("state.missing.back")}</ActionLink>}>
          {t("state.missing.body")}
        </Note>
      ) : mission.state === "error" || mission.state === "offline" || !job ? (
        <Note title={t(mission.state === "offline" ? "state.offline.title" : "state.error.title")}>
          {t(mission.state === "offline" ? "state.offline.body" : "state.error.body")}
        </Note>
      ) : (
        <div className="mt-4 space-y-10 sm:space-y-14">
          <JobHeader job={job} steps={steps} watchers={watchers} onCancel={mission.cancel} demo={mode === "demo"} />
          <Announcer status={job.status} steps={steps} />
          <Trace job={job} steps={steps} />
          {job.status === "cancelled" ? (
            <Note title={t("state.cancelled.title")}>{t("state.cancelled.body")}</Note>
          ) : job.status === "failed" ? (
            <Note title={t("state.failed.title")}>{job.error ?? t("state.failed.body")}</Note>
          ) : null}
          {job.status === "done" ? <ResultPanel result={job.result} lang={lang} /> : null}
          {job.status === "done" ? <Proposals proposals={proposals} onResolve={mission.resolve} /> : null}
        </div>
      )}
    </div>
  );
}

/** One quiet live region: a line when the planner or critic finishes, and when the mission changes state. Tool steps stay silent. */
function Announcer({ status, steps }: { status: Parameters<typeof isActive>[0]; steps: Step[] }) {
  const { t } = useMissionText();
  const milestone = [...steps].reverse().find((s) => s.status === "ok" && (s.role === "planner" || (s.role === "critic" && readCritic(s))));
  const line = !isActive(status)
    ? t("announce.status", { status: t(`status.${status}`) })
    : milestone
      ? t("announce.step", { role: t(`role.${milestone.role}`), title: milestone.title })
      : "";
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {line}
    </p>
  );
}
