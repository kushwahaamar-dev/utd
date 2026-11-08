"use client";

import { useId, useState } from "react";
import { eyebrow } from "@/components/editorial/Editorial";
import { cx } from "@/components/ui/cx";
import { Chevron, Diamond, ToolStamp, type DiamondTone } from "./glyphs";
import { useMissionText } from "./text";
import { isActive, type Job, type Step } from "./types";
import { donePlanItems, formatDuration, prettyModel, rawJson, readCritic, readPlan, readRevision, summarize, type CriticReading } from "./view";

export function Trace({ job, steps }: { job: Job; steps: Step[] }) {
  const { t } = useMissionText();
  const active = isActive(job.status);
  const planDone = donePlanItems(steps);

  return (
    <section aria-labelledby="trace-title" className="min-w-0">
      <h2 id="trace-title" className={eyebrow}>
        {t("trace.title")}
      </h2>
      {steps.length === 0 ? (
        <p className="mt-6 flex items-center gap-3 text-muted">
          {active ? <Diamond tone="idle" live /> : null}
          {t("trace.waiting")}
        </p>
      ) : (
        <ol className="relative mt-6 list-none p-0">
          {steps.map((step, i) => (
            <li key={step.id} className="relative flex gap-3 pb-7 last:pb-0 sm:gap-5">
              <span aria-hidden="true" className={cx("absolute start-[7px] top-5 bottom-0 border-s border-dotted border-muted/60", i === steps.length - 1 && !active && "hidden")} />
              <Diamond tone={toneOf(step)} live={step.status === "running"} className="mt-[5px] shrink-0 bg-paper" />
              <StepCard step={step} planDone={planDone} finished={job.status === "done"} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function toneOf(step: Step): DiamondTone {
  if (step.status === "error") return "bad";
  if (step.role === "critic") {
    const verdict = readCritic(step)?.verdict;
    return verdict === "approve" ? "good" : verdict === "revise" ? "warn" : verdict === "reject" ? "bad" : "ink";
  }
  return step.role === "planner" ? "ink" : "idle";
}

function StepCard({ step, planDone, finished }: { step: Step; planDone: Set<string>; finished: boolean }) {
  const { t, locale } = useMissionText();
  const [raw, setRaw] = useState(false);
  const rawId = useId();
  const critic = readCritic(step);
  const revision = readRevision(step);
  const running = step.status === "running";
  const outputText = summarize(step.output);
  const inputText = summarize(step.input, 120);

  return (
    <article
      aria-label={step.title}
      className={cx(
        "min-w-0 flex-1 rounded-2xl border bg-surface p-4 sm:p-5",
        running ? "border-[var(--accent)]/60" : "border-rule",
        revision && "border-s-2 border-s-warn",
        "motion-safe:animate-ink-fade",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={cx(eyebrow, "text-muted")}>{t(`role.${step.role}`)}</span>
        {revision ? <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-xs font-medium text-on-color">{t("trace.revision", { n: revision.revision })}</span> : null}
        {critic ? <VerdictChip verdict={critic.verdict} /> : null}
        <span className="ms-auto flex flex-wrap items-center gap-2 text-xs text-muted">
          {step.model ? <span className="rounded-full border border-muted/50 px-2.5 py-0.5 text-ink">{prettyModel(step.model)}</span> : null}
          <span className="tabular font-ui">{running ? t("trace.running") : formatDuration(step.ms, locale)}</span>
        </span>
      </header>

      {step.role === "tool" ? null : <h3 className="mt-2 text-[17px] font-medium leading-snug text-balance">{step.title}</h3>}

      {step.role === "planner" ? <PlanBody step={step} planDone={planDone} finished={finished} /> : null}

      {step.tool ? (
        <div className="mt-3 flex items-start gap-3">
          <ToolStamp tool={step.tool} />
          <div className="min-w-0 flex-1 text-[15px] leading-[1.5]">
            <p className="font-ui text-sm font-semibold">{step.tool}</p>
            {inputText ? <p className="break-words text-muted">{inputText}</p> : null}
            {running ? null : outputText ? <p className="mt-1 break-words text-ink">{`→ ${outputText}`}</p> : null}
          </div>
        </div>
      ) : step.role !== "planner" && !critic && outputText ? (
        <p className="mt-2 break-words text-[15px] leading-[1.5] text-muted">{outputText}</p>
      ) : null}

      {revision?.from || revision?.to ? <Delta change={revision} /> : null}
      {critic && critic.reasons.length ? <Reasons title={t("trace.reasons")} items={critic.reasons} /> : null}
      {critic && critic.fixes.length ? <Reasons title={t("trace.fixes")} items={critic.fixes} /> : null}
      {step.status === "error" ? <p className="mt-2 text-sm text-bad">{t("trace.stepFailed")}</p> : null}

      <button
        type="button"
        aria-expanded={raw}
        aria-controls={rawId}
        onClick={() => setRaw((v) => !v)}
        className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded text-xs text-muted transition-colors hover:text-ink [@media(pointer:coarse)]:min-h-11"
      >
        <Chevron open={raw} />
        {raw ? t("trace.hideRaw") : t("trace.showRaw")}
      </button>
      {raw ? (
        <div id={rawId} className="mt-2 grid gap-3 md:grid-cols-2">
          <RawBlock label={t("trace.input")} value={step.input} />
          <RawBlock label={t("trace.output")} value={running ? undefined : step.output} empty={t("trace.noOutput")} />
        </div>
      ) : null}
    </article>
  );
}

function PlanBody({ step, planDone, finished }: { step: Step; planDone: Set<string>; finished: boolean }) {
  const { t } = useMissionText();
  const plan = readPlan(step);
  if (plan.items.length === 0 && plan.criteria.length === 0) return null;
  return (
    <div className="mt-4 grid gap-5 md:grid-cols-[1.3fr_1fr]">
      {plan.items.length ? (
        <div>
          <p className="text-xs font-medium text-muted">{t("trace.plan")}</p>
          <ul className="mt-2 list-none space-y-2 p-0">
            {plan.items.map((item) => {
              const done = finished || planDone.has(item.id);
              return (
                <li key={item.id} className="flex items-start gap-2.5 text-[15px] leading-[1.45]">
                  <Check done={done} />
                  <span className={cx(done ? "text-ink" : "text-muted")}>{item.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {plan.criteria.length ? (
        <div>
          <p className="text-xs font-medium text-muted">{t("trace.criteria")}</p>
          <ul className="mt-2 list-none space-y-2 p-0">
            {plan.criteria.map((c) => (
              <li key={c} className="flex items-start gap-2.5 text-[15px] leading-[1.45] text-muted">
                <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rotate-45 bg-muted/70" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Check({ done }: { done: boolean }) {
  return (
    <span aria-hidden="true" className={cx("mt-[3px] grid size-4 shrink-0 place-items-center rounded-[5px] border", done ? "border-good bg-good text-paper" : "border-muted/60")}>
      {done ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      ) : null}
    </span>
  );
}

function VerdictChip({ verdict }: { verdict: CriticReading["verdict"] }) {
  const { t } = useMissionText();
  const tone = verdict === "approve" ? "bg-good-bg" : verdict === "revise" ? "bg-warn-bg" : "bg-bad-bg";
  return <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium text-on-color", tone)}>{t(`trace.${verdict}`)}</span>;
}

function Reasons({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-muted">{title}</p>
      <ul className="mt-1.5 list-none space-y-1.5 p-0">
        {items.map((reason) => (
          <li key={reason} className="flex items-start gap-2.5 text-[15px] leading-[1.45]">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rotate-45 bg-muted" />
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Delta({ change }: { change: NonNullable<ReturnType<typeof readRevision>> }) {
  const { t } = useMissionText();
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-sunken/70 px-3 py-2 text-sm">
      {change.what ? <span className="text-muted">{change.what}</span> : null}
      {change.metric ? <span className="font-medium">{change.metric}</span> : null}
      <span className="tabular font-ui">
        {change.from} <span aria-hidden="true">→</span>
        <span className="sr-only"> {t("trace.to")} </span> <span className="font-semibold text-good">{change.to}</span>
      </span>
    </p>
  );
}

function RawBlock({ label, value, empty }: { label: string; value: unknown; empty?: string }) {
  const text = value === undefined ? undefined : rawJson(value);
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted">{label}</p>
      <pre tabIndex={0} className="mt-1 max-h-56 overflow-auto rounded-xl bg-sunken p-3 font-ui text-xs leading-[1.55] whitespace-pre-wrap break-words">
        {text ?? empty}
      </pre>
    </div>
  );
}
