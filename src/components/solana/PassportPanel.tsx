"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { Suspense, use, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { LabDockProps } from "@/components/dock/types";
import type { FigureHandle } from "@/components/figure/protocol";
import { Button, Callout, Chip, Icon, Stat, Stepper, type StepItem } from "@/components/ui";
import { isDroneId, type DroneId } from "@/content/ids";
import { useLocale } from "@/i18n/client";
import { reloadFeatures, useFeatures } from "@/lib/features";
import { explorerUrl } from "@/lib/solana/config";
import { SolanaProvider } from "@/lib/solana/provider";
import { useCredentials, useStdb, useStdbActions, type Credential } from "@/lib/stdb";
import { droneTestsFor } from "@/lib/verify";
import { droneRecorder, type DroneRecording } from "@/lib/verify/drone-recorder";
import { DRONE_TESTS, replayDroneSafety, type DroneTestSet } from "@/lib/verify/drone-safety";
import { skillIdFor } from "@/lib/verify/skill";
import { Confetti } from "./Confetti";
import { SkillBounties } from "./SkillBounties";
import { SolanaText, useSolanaT } from "./SolanaText";
import { WalletBar, bumpBalances } from "./WalletBar";
import { useCredentialJob, useLinkedWallet, type CredentialJob } from "./useModule";

type Flow = { phase: "idle" } | { phase: "submitting" } | { phase: "error"; message: string };

const testsCache = new Map<DroneId, Promise<DroneTestSet>>();

function testsOf(id: DroneId): Promise<DroneTestSet> {
  let pending = testsCache.get(id);
  if (!pending) {
    pending = droneTestsFor(id);
    testsCache.set(id, pending);
  }
  return pending;
}

const NOT_STARTED: DroneRecording = { started: false, inputs: [] };
const noop = () => () => {};

function useRecording(figure: FigureHandle | null) {
  const recorder = useMemo(() => (figure ? droneRecorder(figure) : null), [figure]);
  const recording = useSyncExternalStore(
    recorder ? recorder.subscribe : noop,
    () => (recorder ? recorder.get() : NOT_STARTED),
    () => NOT_STARTED,
  );
  return { recorder, recording };
}

function MintProgress({ at }: { at: number }) {
  const t = useSolanaT();
  const steps: StepItem[] = (["check", "server", "chain"] as const).map((id, i) => ({
    id,
    label: t(`panel.phases.${id}`),
    status: i < at ? "done" : i === at ? "current" : "todo",
  }));
  return <Stepper label={t("panel.progressLabel")} steps={steps} statusText={{ done: t("panel.phaseStatus.done"), current: t("panel.phaseStatus.current") }} />;
}

function jobDetails(job: CredentialJob["job"]): { score?: number; replayHash?: string } {
  try {
    return JSON.parse(job.payload) as { score?: number; replayHash?: string };
  } catch {
    return {};
  }
}

function Success({ credential, job }: { credential: Credential; job: CredentialJob | null }) {
  const t = useSolanaT();
  const locale = useLocale();
  const details = job ? jobDetails(job.job) : {};
  return (
    <div className="relative">
      <Confetti />
      <Callout tone="success" title={t("panel.successTitle")} live>
        <p>{t("panel.successBody", { skill: credential.skill })}</p>
        {details.score != null || details.replayHash ? (
          <dl className="mt-3 grid gap-1 font-ui text-xs">
            {details.score != null ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">{t("credential.score")}</dt>
                <dd className="tabular font-bold">{t("panel.scoreValue", { score: details.score })}</dd>
              </div>
            ) : null}
            {details.replayHash ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">{t("credential.replayHash")}</dt>
                <dd className="break-all" translate="no">
                  {details.replayHash}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-3 font-ui text-sm font-bold">
          {credential.sig ? (
            <a href={explorerUrl("tx", credential.sig)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1">
              {t("panel.viewTx")}
              <Icon name="external" size={16} />
            </a>
          ) : null}
          <Link href={`/${locale}/verify?credential=${credential.pda}`} className="inline-flex min-h-11 items-center gap-1">
            {t("panel.viewVerify")}
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>
      </Callout>
    </div>
  );
}

function DroneMint({ itemId, figure }: { itemId: DroneId; figure: FigureHandle | null }) {
  const t = useSolanaT();
  const locale = useLocale();
  const tests = use(testsOf(itemId));
  const { publicKey } = useWallet();
  const { status: link } = useStdb();
  const { submitRun } = useStdbActions();
  const { recorder, recording } = useRecording(figure);
  const report = useMemo(() => (recording.started ? replayDroneSafety(recording.inputs, tests) : null), [recording, tests]);
  const [flow, setFlow] = useState<Flow>({ phase: "idle" });
  const skillId = skillIdFor("drone-safety", itemId) as string;
  const wallet = publicKey?.toBase58() ?? null;
  const walletLinked = useLinkedWallet(wallet);
  const { credentials } = useCredentials(wallet);
  const credential = credentials.find((c) => c.skill === skillId);
  const job = useCredentialJob(skillId);
  const failed = job?.status === "failed";
  const inFlight = !credential && !failed && (flow.phase === "submitting" || job?.status === "queued" || job?.status === "sent" || job?.status === "confirmed");
  const progressAt = !job ? 0 : job.status === "queued" ? 1 : 2;

  const steps: StepItem[] = DRONE_TESTS.filter((test) => tests[test]).map((test) => {
    const done = report?.steps[test] === true;
    return {
      id: test,
      label: t(`panel.steps.${test}`),
      description: t(`panel.steps.${test}Hint`),
      status: done ? "done" : "todo",
    };
  });
  const firstTodo = steps.find((s) => s.status === "todo");
  if (firstTodo) firstTodo.status = "current";

  async function mint() {
    if (!recorder || !wallet || !report?.pass) return;
    setFlow({ phase: "submitting" });
    try {
      await submitRun({ kind: "drone-safety", itemId, run: recorder.runLog(itemId, { pass: report.pass, score: report.score }) });
      bumpBalances();
      setFlow({ phase: "idle" });
    } catch (error) {
      setFlow({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function restart() {
    recorder?.restart();
    setFlow({ phase: "idle" });
  }

  return (
    <div className="grid gap-4">
      <section aria-labelledby="passport-earn" className="grid gap-3">
        <h3 id="passport-earn" className="font-ui text-sm font-bold">
          {t("panel.earnTitle")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="mustard">{t("panel.droneSkill")}</Chip>
          <code className="font-ui text-xs" translate="no">
            {skillId}
          </code>
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {recording.started ? t("panel.recording") : t("panel.waitingFigure")}
        </p>
        <Stepper label={t("panel.stepsLabel")} steps={steps} statusText={{ done: t("panel.stepStatus.done"), current: t("panel.stepStatus.current") }} />
        {report ? (
          <div className="flex flex-wrap items-end gap-4">
            <Stat size="sm" label={t("panel.score")} value={t("panel.scoreValue", { score: report.score })} tone={report.score === 100 ? "good" : "warn"} />
            {report.pops ? <p className="text-sm">{t("panel.pops", { count: report.pops })}</p> : null}
          </div>
        ) : null}
        {report?.violations.length ? (
          <Callout tone="danger" live>
            {t("panel.violations", { rules: report.violations.map((rule) => t(`panel.rules.${rule}`)).join(", ") })}
          </Callout>
        ) : null}
        {report?.fault ? <Callout tone="warn">{t("panel.fault")}</Callout> : null}
        {recording.started ? (
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={restart} disabled={inFlight}>
            {t("panel.restart")}
          </Button>
        ) : null}
      </section>

      <SkillBounties skillId={skillId} refresh={credential ? 1 : 0} />

      <WalletBar />

      <section aria-label={t("panel.progressLabel")} className="grid gap-3">
        {credential ? (
          <Success credential={credential} job={job} />
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              onClick={mint}
              disabled={inFlight || !wallet || !walletLinked || link !== "online" || !report?.pass}
              aria-busy={inFlight}
            >
              {t("panel.mint")}
            </Button>
            {!inFlight && !report?.pass ? <p className="text-sm text-muted">{t("panel.needsPass")}</p> : null}
            {!inFlight && report?.pass && !wallet ? <p className="text-sm text-muted">{t("panel.needsWallet")}</p> : null}
            {report?.pass && wallet && link !== "online" ? <p className="text-sm text-muted">{t("panel.offline")}</p> : null}
          </>
        )}
        {inFlight ? <MintProgress at={progressAt} /> : null}
        {failed ? (
          <Callout tone="danger" live>
            {t("panel.failed", { reason: job?.job.error ?? "" })}
          </Callout>
        ) : null}
        {flow.phase === "error" ? (
          <Callout tone="danger" live>
            {/already issued/.test(flow.message) ? (
              <>
                {t("panel.already")}{" "}
                {wallet ? (
                  <Link href={`/${locale}/verify?learner=${wallet}`} className="font-bold">
                    {t("panel.seeIt")}
                  </Link>
                ) : null}
              </>
            ) : (
              flow.message
            )}
          </Callout>
        ) : null}
      </section>
    </div>
  );
}

function Panel({ lab, itemId, figure }: LabDockProps) {
  const t = useSolanaT();
  const locale = useLocale();
  const { status, features } = useFeatures();

  let body: ReactNode;
  if (status === "loading") {
    body = <div className="h-24 animate-pulse rounded-ink bg-sunken" aria-busy="true" />;
  } else if (status === "error") {
    body = (
      <Callout tone="warn">
        <p>{t("statusError")}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={reloadFeatures}>
          {t("retry")}
        </Button>
      </Callout>
    );
  } else if (!features.solana) {
    body = (
      <Callout tone="note" title={t("notSetUp.title")}>
        {t("notSetUp.body")}
      </Callout>
    );
  } else if (lab === "drone" && isDroneId(itemId)) {
    body = (
      <Suspense fallback={<div className="h-24 animate-pulse rounded-ink bg-sunken" aria-busy="true" />}>
        <DroneMint itemId={itemId} figure={figure} />
      </Suspense>
    );
  } else {
    body = (
      <div className="grid gap-3">
        <p className="text-sm">{t("panel.otherLab")}</p>
        <Link href={`/${locale}/passport`} className="inline-flex min-h-11 items-center gap-1 font-ui text-sm font-bold">
          {t("panel.openPassport")}
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl">{t("panel.title")}</h2>
          <Chip tone="ink">{t("devnet")}</Chip>
        </div>
        <p className="text-sm">{t("panel.lede")}</p>
      </header>
      {body}
    </div>
  );
}

/** The Passport tab of every lab's dock (H3): earn, mint and see Proof of Build for this item. */
export function PassportPanel(props: LabDockProps) {
  return (
    <SolanaProvider>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-ink bg-sunken" aria-busy="true" />}>
        <SolanaText>
          <Panel {...props} />
        </SolanaText>
      </Suspense>
    </SolanaProvider>
  );
}
