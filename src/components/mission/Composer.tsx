"use client";

import { useId, useState, type FormEvent } from "react";
import { Action, area, eyebrow } from "@/components/editorial/Editorial";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cx } from "@/components/ui/cx";
import { useMissionT } from "./text";
import type { JobKind } from "./types";

const PRESETS = [
  { id: "drone", kind: "build" },
  { id: "parking", kind: "build" },
  { id: "robot", kind: "build" },
  { id: "led", kind: "diagnose" },
] as const satisfies readonly { id: "drone" | "parking" | "robot" | "led"; kind: JobKind }[];

type Props = {
  roomCode?: string;
  /** The backend cannot run missions: the form stays visible but cannot be sent. */
  disabled?: boolean;
  onStart: (input: { kind: JobKind; goal: string; roomCode?: string }) => Promise<void>;
};

export function Composer({ roomCode, disabled, onStart }: Props) {
  const t = useMissionT();
  const goalId = useId();
  const hintId = useId();
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<JobKind>("build");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"short" | "failed" | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = goal.trim();
    if (text.length < 6) return setProblem("short");
    setProblem(null);
    setBusy(true);
    try {
      await onStart({ kind, goal: text, roomCode });
    } catch {
      setProblem("failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-(--card-line) bg-surface p-4 sm:p-6" aria-busy={busy}>
      <label htmlFor={goalId} className={cx(eyebrow, "block")}>
        {t("composer.label")}
      </label>
      <textarea
        id={goalId}
        value={goal}
        onChange={(e) => {
          setGoal(e.target.value);
          if (problem === "short") setProblem(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
        rows={2}
        maxLength={500}
        placeholder={t("composer.placeholder")}
        disabled={disabled || busy}
        aria-describedby={problem ? hintId : undefined}
        aria-invalid={problem === "short"}
        className={cx(area, "mt-3 resize-none text-[17px] sm:text-lg")}
      />
      {problem ? (
        <p id={hintId} role="alert" className="mt-2 text-sm text-bad">
          {problem === "short" ? t("composer.tooShort") : t("composer.failed")}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label={t("composer.presets")}>
        <span className="text-sm text-muted">{t("composer.presets")}</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              setGoal(t(`presets.${p.id}.goal`));
              setKind(p.kind);
              setProblem(null);
            }}
            className="min-h-9 rounded-full border border-muted/50 px-3.5 text-sm text-ink transition-[border-color,background-color] duration-150 hover:border-ink hover:bg-sunken/60 disabled:opacity-45 [@media(pointer:coarse)]:min-h-11"
          >
            {t(`presets.${p.id}.label`)}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-5">
        <SegmentedControl
          label={t("composer.kind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "build", label: t("composer.kinds.build") },
            { value: "diagnose", label: t("composer.kinds.diagnose") },
            { value: "plan", label: t("composer.kinds.plan") },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          {roomCode ? <span className="text-sm text-muted">{t("composer.room", { code: roomCode })}</span> : null}
          <Action kind="primary" type="submit" disabled={disabled || busy}>
            {busy ? t("composer.starting") : t("composer.start")}
          </Action>
        </div>
      </div>
    </form>
  );
}
