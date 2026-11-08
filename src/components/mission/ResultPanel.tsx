"use client";

import { Section } from "@/components/editorial";
import { Action, ActionLink } from "@/components/editorial/Editorial";
import { cx } from "@/components/ui/cx";
import { useMissionText } from "./text";
import type { Proposal } from "./types";
import { bomTotal, formatMoney, readProposal, readResult, type MissionResult } from "./view";

function labPath(result: MissionResult): { open: string; fly?: string } | undefined {
  const lab = result.lab;
  if (!lab) return undefined;
  if (lab.kind === "drone") return { open: `/drones/${lab.id}`, fly: `/drones/${lab.id}/fly` };
  if (lab.kind === "board") return { open: `/boards/${lab.id}` };
  return { open: `/robotics/${lab.id}` };
}

export function ResultPanel({ result: raw, lang, planBudget }: { result: unknown; lang: string; planBudget?: number }) {
  const { t, locale } = useMissionText();
  const result = readResult(raw);
  if (!result) {
    return (
      <Section id="result-title" n="02" motif="chip" tone="green" tilt={3} title={t("result.title")}>
        <p className="text-muted">{t("result.none")}</p>
      </Section>
    );
  }

  const money = (n: number) => formatMoney(n, locale);
  const total = result.total ?? bomTotal(result.bom);
  const paths = labPath(result);

  return (
    <Section id="result-title" n="02" motif="chip" tone="green" tilt={3} title={t("result.title")} className="motion-safe:animate-ink-rise">
      {result.summary ? <p className="max-w-[62ch] text-[17px] leading-[1.55] text-balance">{result.summary}</p> : null}

      {result.verification.length ? (
        <div className="mt-6">
          <p className="sr-only">{t("result.verified")}</p>
          <ul className="flex list-none flex-wrap gap-2 p-0">
            {result.verification.map((v) => (
              <li
                key={v.label}
                title={v.evidence}
                className={cx("inline-flex items-start gap-2 rounded-2xl px-3.5 py-1.5 text-sm font-medium leading-snug text-on-color", v.ok ? "bg-good-bg" : "bg-bad-bg")}
              >
                <svg aria-hidden="true" className="mt-[3px] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d={v.ok ? "M5 12.5l4.2 4.2L19 7" : "M6 6l12 12M18 6L6 18"} />
                </svg>
                {v.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.bom.length ? (
        <div className="mt-9">
          <h3 className="text-xs font-medium text-muted">{t("result.bom")}</h3>
          <table className="mt-3 w-full border-collapse text-[15px]">
            <thead className="max-sm:sr-only">
              <tr className="border-b border-rule text-start text-xs text-muted">
                <th scope="col" className="py-2 pe-3 text-start font-medium">{t("result.part")}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t("result.store")}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t("result.qty")}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t("result.price")}</th>
                <th scope="col" className="py-2 ps-3 text-end font-medium"><span className="sr-only">{t("result.link")}</span></th>
              </tr>
            </thead>
            <tbody>
              {result.bom.map((line) => (
                <tr key={`${line.part}-${line.store ?? ""}`} className="border-b border-rule/70 align-top max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:py-3">
                  <td className="py-3 pe-3 max-sm:col-span-2 max-sm:p-0 max-sm:font-medium">{line.part}</td>
                  <td className="px-3 py-3 text-muted max-sm:p-0">{line.store ?? ""}</td>
                  <td className="tabular px-3 py-3 text-end text-muted max-sm:hidden">{line.qty}</td>
                  <td className="tabular px-3 py-3 text-end font-ui max-sm:p-0">
                    {line.qty > 1 ? <span className="text-muted sm:hidden">{`${line.qty} × `}</span> : null}
                    {line.price === undefined ? "–" : money(line.price * line.qty)}
                  </td>
                  <td className="py-3 ps-3 text-end max-sm:col-span-2 max-sm:p-0 max-sm:pt-1 max-sm:text-start">
                    {line.url ? (
                      <a href={line.url} target="_blank" rel="noopener noreferrer" aria-label={`${t("result.buy")}: ${line.part}`} className="text-muted underline decoration-muted/50 underline-offset-4 hover:text-ink">
                        <span aria-hidden="true" className="max-sm:hidden">↗</span>
                        <span aria-hidden="true" className="sm:hidden">{`${t("result.buy")} ↗`}</span>
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Budget total={total} budget={result.budget ?? planBudget} money={money} />
        </div>
      ) : null}

      {paths ? (
        <div className="mt-9 border-t border-rule pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <ActionLink kind="primary" href={`/${lang}${paths.open}`}>
              {t("result.loadLab")}
            </ActionLink>
            {paths.fly ? (
              <ActionLink href={`/${lang}${paths.fly}`}>{t("result.race")}</ActionLink>
            ) : null}
            <ActionLink href={`/${lang}/passport`}>{t("result.credential")}</ActionLink>
          </div>
          <p className="mt-3 text-sm text-muted">{t("result.labNote")}</p>
        </div>
      ) : (
        <div className="mt-9 border-t border-rule pt-6">
          <ActionLink href={`/${lang}/passport`}>{t("result.credential")}</ActionLink>
        </div>
      )}
    </Section>
  );
}

function Budget({ total, budget, money }: { total: number; budget?: number; money: (n: number) => string }) {
  const { t } = useMissionText();
  const over = budget !== undefined && total > budget;
  const pct = budget ? Math.min(100, (total / budget) * 100) : 0;
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted">{t("result.total")}</span>
        <span className="tabular font-ui text-2xl font-medium">{money(total)}</span>
      </div>
      {budget !== undefined ? (
        <>
          <div
            role="meter"
            aria-label={t("result.budget", { amount: money(budget) })}
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={Math.min(total, budget)}
            aria-valuetext={money(total)}
            className="mt-3 h-2 overflow-hidden rounded-full bg-sunken"
          >
            <div className={cx("h-full rounded-full", over ? "bg-bad" : "bg-good")} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm text-muted">
            <span>{over ? t("result.over", { amount: money(total - budget) }) : t("result.under", { amount: money(budget - total) })}</span>
            <span>{t("result.budget", { amount: money(budget) })}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}

export function Proposals({ proposals, onResolve }: { proposals: Proposal[]; onResolve: (id: string, accept: boolean) => void }) {
  const { t } = useMissionText();
  if (proposals.length === 0) return null;
  return (
    <Section id="proposals-title" n="03" motif="gear" tone="copper" tilt={-2} title={t("proposals.title")}>
      <p className="max-w-[52ch] text-muted">{t("proposals.lede")}</p>
      <ul className="mt-5 grid list-none gap-4 p-0 sm:grid-cols-2">
        {proposals.map((p) => {
          const view = readProposal(p.kind, p.payload);
          return (
            <li key={p.id} className="flex flex-col rounded-2xl border border-(--card-line) bg-surface p-5">
              <p className="text-[17px] font-medium leading-snug">{view.title}</p>
              {view.detail ? <p className="mt-2 text-[15px] leading-[1.5] text-muted">{view.detail}</p> : null}
              {view.delta ? <p className="tabular mt-3 font-ui text-sm">{view.delta}</p> : null}
              {view.code ? <pre tabIndex={0} className="mt-3 max-h-48 overflow-auto rounded-xl bg-sunken p-3 font-ui text-xs leading-[1.55]">{view.code}</pre> : null}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                {p.status === "pending" ? (
                  <>
                    <Action kind="primary" size="sm" onClick={() => onResolve(p.id, true)}>
                      {t("proposals.accept")}
                    </Action>
                    <Action size="sm" onClick={() => onResolve(p.id, false)}>
                      {t("proposals.reject")}
                    </Action>
                  </>
                ) : (
                  <span className={cx("rounded-full px-3 py-1 text-sm font-medium text-on-color", p.status === "accepted" ? "bg-good-bg" : "bg-bad-bg")}>
                    {t(`proposals.${p.status}`)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
