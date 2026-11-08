"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, type ReactNode } from "react";
import { Cell, Container, Grid } from "@/components/editorial";
import { ActionLink, Note, eyebrow } from "@/components/editorial/Editorial";
import { cx } from "@/components/ui/cx";
import type { Locale } from "@/i18n/config";
import { Composer } from "./Composer";
import { createDemoAdapter, MissionDataProvider, useMission, useMissionMode, useMissionOnline, useMyMissions, useStartMission } from "./data";
import { JobHeader } from "./JobHeader";
import { liveAdapter } from "./live";
import { Proposals, ResultPanel } from "./ResultPanel";
import { MissionTextProvider, useMissionText, type MissionMessages } from "./text";
import { Trace } from "./Trace";
import { isActive, type JobKind, type Step } from "./types";
import { planBudget, readCritic } from "./view";

/** The page body for /mission, where ?job= picks a mission (the static layout cannot take a path segment for it). The live backend plugs in through `live`; without it only the recorded demo runs. */
export function MissionApp({ lang, messages, head }: { lang: Locale; messages: MissionMessages; head?: ReactNode }) {
  return (
    <MissionTextProvider locale={lang} messages={messages}>
      <Suspense fallback={<div className="min-h-[50vh]" aria-busy="true" />}>
        <Frame lang={lang} head={head} />
      </Suspense>
    </MissionTextProvider>
  );
}

function Frame({ lang, head }: { lang: Locale; head?: ReactNode }) {
  const params = useSearchParams();
  const jobId = params.get("job") || undefined;
  const demo = params.get("demo") === "1";
  const speed = Math.min(20, Math.max(1, Number(params.get("speed")) || 1));
  const adapter = useMemo(() => (demo ? createDemoAdapter(speed) : liveAdapter), [demo, speed]);
  const roomCode = params.get("room")?.slice(0, 12) || undefined;

  // The language layout already mounts the one StdbProvider the live adapter reads.
  return (
    <MissionDataProvider adapter={adapter}>
      <Container className="pb-[clamp(72px,10vw,160px)]">
        {jobId ? <JobView lang={lang} jobId={jobId} /> : <Home lang={lang} roomCode={roomCode} head={head} />}
      </Container>
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

function OfflineNote({ lang }: { lang: Locale }) {
  const { t } = useMissionText();
  return (
    <div className="mb-8">
      <Note
        title={t("state.offline.title")}
        action={
          <ActionLink kind="primary" size="sm" href={`/${lang}/mission?demo=1`}>
            {t("state.offline.demo")}
          </ActionLink>
        }
      >
        {t("state.offline.body")}
      </Note>
    </div>
  );
}

function Home({ lang, roomCode, head }: { lang: Locale; roomCode?: string; head?: ReactNode }) {
  const router = useRouter();
  const search = useSearchParams();
  const start = useStartMission();
  const missions = useMyMissions();
  const online = useMissionOnline();
  const { t } = useMissionText();
  const query = demoQuery(search);

  async function onStart(input: { kind: JobKind; goal: string; roomCode?: string }) {
    const id = await start(input);
    router.push(`/${lang}/mission?job=${encodeURIComponent(id)}${query ? `&${query.slice(1)}` : ""}`);
  }

  return (
    <Grid className="gap-y-10">
      <Cell span={5}>
        {head}
        {missions.length ? (
        <section aria-labelledby="recent-title" className="mt-10 lg:mt-14">
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
      </Cell>
      <Cell span={7} className="lg:pt-[clamp(40px,6vw,96px)]">
        {online ? null : <OfflineNote lang={lang} />}
        <Composer roomCode={roomCode} disabled={!online} onStart={onStart} />
      </Cell>
    </Grid>
  );
}

function JobView({ lang, jobId }: { lang: Locale; jobId: string }) {
  const { t } = useMissionText();
  const search = useSearchParams();
  const mission = useMission(jobId);
  const mode = useMissionMode();
  const { job, steps, proposals, watchers } = mission;
  const home = `/${lang}/mission${demoQuery(search, ["demo", "room"])}`;

  const rail = "lg:sticky lg:top-[4.75rem] lg:max-h-[calc(100svh-5.5rem)] lg:self-start lg:overflow-y-auto lg:pb-2";
  const loaded = mission.state === "ready" && job;
  const done = job?.status === "done";

  return (
    <div className="pt-[clamp(24px,4vw,56px)]">
      <Grid className="gap-y-8">
        <Cell span={3} className={rail}>
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
          ) : !loaded ? (
            <Note title={t(mission.state === "offline" ? "state.offline.title" : "state.error.title")}>
              {t(mission.state === "offline" ? "state.offline.body" : "state.error.body")}
            </Note>
          ) : (
            <div className="mt-3 flex flex-col gap-6">
              <JobHeader job={job} steps={steps} watchers={watchers} onCancel={mission.cancel} demo={mode === "demo"} />
              <Announcer status={job.status} steps={steps} />
              {job.status === "cancelled" ? (
                <Note title={t("state.cancelled.title")}>{t("state.cancelled.body")}</Note>
              ) : job.status === "failed" ? (
                <Note title={t("state.failed.title")}>{job.error ?? t("state.failed.body")}</Note>
              ) : null}
            </div>
          )}
        </Cell>

        {loaded ? (
          <>
            <Cell span={5}>
              <Trace job={job} steps={steps} />
            </Cell>
            <Cell span={4} className={rail}>
              {done ? (
                <div className="flex flex-col gap-12">
                  <ResultPanel result={job.result} lang={lang} planBudget={planBudget(steps)} />
                  <Proposals proposals={proposals} onResolve={mission.resolve} />
                </div>
              ) : (
                <p className="hidden border-s-2 border-line ps-4 text-sm text-muted lg:block">{t("result.pending")}</p>
              )}
            </Cell>
          </>
        ) : null}
      </Grid>
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
