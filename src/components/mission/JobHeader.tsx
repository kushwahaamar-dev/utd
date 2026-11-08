"use client";

import { useEffect, useState } from "react";
import { Action } from "@/components/editorial/Editorial";
import { cx } from "@/components/ui/cx";
import { Diamond, type DiamondTone } from "./glyphs";
import { useMissionText } from "./text";
import { isActive, type Job, type JobStatus, type Step, type Watcher } from "./types";
import { formatDuration, jobElapsed, modelsOf, prettyModel, revisionCount, toolCallCount } from "./view";

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

const STATUS_TONE: Record<JobStatus, DiamondTone> = {
  queued: "idle",
  planning: "idle",
  running: "idle",
  reviewing: "idle",
  done: "good",
  failed: "bad",
  cancelled: "warn",
};

export function JobHeader({ job, steps, watchers, onCancel, demo }: { job: Job; steps: Step[]; watchers: Watcher[]; onCancel: () => void; demo: boolean }) {
  const { t, locale } = useMissionText();
  const active = isActive(job.status);
  const now = useNow(active);
  const models = modelsOf(steps);

  const stats: Array<[string, string]> = [
    [t("job.elapsed"), formatDuration(jobElapsed(job, now), locale)],
    [t("job.toolCalls"), String(toolCallCount(steps))],
    [t("job.revisions"), String(revisionCount(steps))],
  ];

  return (
    <section aria-label={job.goal} className="rounded-2xl border border-rule bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-muted/50 px-3 py-1 text-sm font-medium">
          <Diamond tone={STATUS_TONE[job.status]} live={active} />
          {t(`status.${job.status}`)}
        </span>
        {job.roomCode ? <span className="text-sm text-muted">{t("job.room", { code: job.roomCode })}</span> : null}
        {watchers.length ? <Watchers watchers={watchers} /> : null}
        {active ? (
          <Action size="sm" className="ms-auto" onClick={onCancel}>
            {t("job.cancel")}
          </Action>
        ) : null}
      </div>

      <p className="mt-4 text-xl font-medium leading-snug text-balance sm:text-2xl">{job.goal}</p>

      <dl className="mt-6 grid grid-cols-3 gap-x-4 gap-y-4 border-t border-rule pt-5 sm:grid-cols-[repeat(3,auto)_1fr] sm:gap-x-10">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="tabular mt-1 font-ui text-2xl font-medium leading-none">{value}</dd>
          </div>
        ))}
        <div className="col-span-3 min-w-0 sm:col-span-1">
          <dt className="text-xs text-muted">{t("job.models")}</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1.5">
            {models.length ? (
              models.map((m) => (
                <span key={m} className="rounded-full border border-muted/50 px-2.5 py-0.5 text-xs">
                  {prettyModel(m)}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted">–</span>
            )}
          </dd>
        </div>
      </dl>

      {demo ? <p className={cx("mt-5 border-t border-rule pt-4 text-sm text-muted")}>{t("job.demo")}</p> : null}
    </section>
  );
}

function Watchers({ watchers }: { watchers: Watcher[] }) {
  const { t } = useMissionText();
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="flex -space-x-1.5" aria-hidden="true">
        {watchers.slice(0, 4).map((w) => (
          <span key={w.id} title={w.name} className="grid size-6 place-items-center rounded-full border-2 border-surface text-[10px] font-semibold text-on-color" style={{ backgroundColor: w.color }}>
            {[...w.name][0]?.toUpperCase()}
          </span>
        ))}
      </span>
      <span>{t("job.watching", { count: watchers.length })}</span>
      <span className="sr-only">{watchers.map((w) => w.name).join(", ")}</span>
    </span>
  );
}
