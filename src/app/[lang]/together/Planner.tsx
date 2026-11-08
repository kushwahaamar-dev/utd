"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { LabKind } from "@/components/dock/types";
import type { TogetherT } from "@/components/realtime/messages";
import { Action, Section, eyebrow, sectionTitle, area, field } from "@/components/editorial/Editorial";
import { Callout, IconButton } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { useLocale } from "@/i18n/client";
import { LOCALES, type Locale } from "@/i18n/config";
import { createRoom, useIdentity } from "@/lib/realtime";
import { track } from "@/lib/telemetry";
import { StdbGate, roomPath } from "./api";
import { useAgentRun } from "./useAgentRun";

type Level = "new" | "some" | "lots";
type Person = { key: number; name: string; lang: Locale; level: Level; wants: string };
type Plan = { title: string; item: { lab: LabKind; id: string }; why: string; roles: { name: string; role: string; firstTask: string }[]; steps: string[]; parts?: string[] };

const LEVELS: Level[] = ["new", "some", "lots"];
const MAX_PEOPLE = 8;
const label = cx(eyebrow, "flex min-w-0 flex-col gap-2");

type State = { kind: "idle" } | { kind: "missing" };

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** The worker's plan result: summary + a free-form design object + roles + bom + load_into_lab. */
function readPlan(result: unknown, titles: Map<string, string>): Plan | null {
  const r = result as { summary?: unknown; design?: Record<string, unknown>; roles?: Plan["roles"]; bom?: { name?: unknown }[]; load_into_lab?: { lab?: unknown; itemId?: unknown } | null } | null;
  if (!r) return null;
  const design = r.design ?? {};
  const item = (design.item ?? {}) as { lab?: unknown; id?: unknown };
  const lab = r.load_into_lab?.lab ?? item.lab;
  const id = r.load_into_lab?.itemId ?? item.id ?? (typeof design.item === "string" ? design.item : undefined);
  const key = typeof id === "string" && titles.has(`${lab}:${id}`) ? `${lab}:${id}` : [...titles.keys()].find((k) => k.endsWith(`:${id}`));
  if (!key) return null;
  const steps = (Array.isArray(design.steps) ? design.steps : []).map((x) => (typeof x === "string" ? x : text((x as { title?: unknown; goal?: unknown }).title) || text((x as { goal?: unknown }).goal))).filter(Boolean);
  const parts = (r.bom ?? []).map((b) => text(b.name)).filter(Boolean);
  const [itemLab, itemId] = key.split(":");
  return {
    title: text(design.title) || titles.get(key) || "",
    item: { lab: itemLab as LabKind, id: itemId! },
    why: text(r.summary),
    roles: Array.isArray(r.roles) ? r.roles : [],
    steps,
    parts,
  };
}

export function Planner({ t, titles, index }: { t: TogetherT; titles: Map<string, string>; index?: string }) {
  const id = useId();
  const router = useRouter();
  const locale = useLocale();
  const identity = useIdentity();
  const { run, start, reset } = useAgentRun("plan");
  const [people, setPeople] = useState<Person[]>([
    { key: 1, name: "", lang: locale, level: "some", wants: "" },
    { key: 2, name: "", lang: locale, level: "new", wants: "" },
  ]);
  const [next, setNext] = useState(3);
  const [state, setState] = useState<State>({ kind: "idle" });
  // The first row is you, once you've picked a name for rooms.
  const rows = people.map((p, i) => (i === 0 && !p.name && identity ? { ...p, name: identity.name } : p));

  const update = (key: number, patch: Partial<Person>) =>
    setPeople((list) => list.map((p, i) => (p.key === key ? { ...(i === 0 && !p.name && identity ? { ...p, name: identity.name } : p), ...patch } : p)));

  const plan = useMemo(() => (run.phase === "done" ? readPlan(run.result, titles) : null), [run, titles]);
  const busy = run.phase === "working";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const participants = rows.filter((p) => p.name.trim() || p.wants.trim());
    if (participants.length === 0 || participants.some((p) => !p.name.trim() || !p.wants.trim())) return setState({ kind: "missing" });
    setState({ kind: "idle" });
    track("ai.call", { kind: "plan" });
    const people = participants.map(({ name, lang, level, wants }) => ({ name: name.trim().slice(0, 24), lang, level, wants: wants.trim().slice(0, 300) }));
    await start(`Plan a build night for ${people.map((p) => p.name).join(", ")}`, { locale, participants: people });
  };

  return (
    <Section id={`${id}-title`} index={index} title={t("lobby.plan.title")} lede={t("lobby.plan.lede")}>
      <StdbGate t={t} notSetUp={t("lobby.plan.notSetUp")}>
        {plan ? (
          <PlanCard
            plan={plan}
            item={titles.get(`${plan.item.lab}:${plan.item.id}`) ?? ""}
            t={t}
            onStart={() => router.push(roomPath(createRoom(plan.item.lab, plan.item.id, locale)))}
            onAgain={reset}
          />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
            <fieldset className="flex flex-col">
              <legend className={cx(eyebrow, "mb-4")}>{t("lobby.plan.people")}</legend>
              {rows.map((person, index) => {
                const name = person.name.trim() || t("lobby.plan.person", { n: index + 1 });
                return (
                  <div
                    key={person.key}
                    role="group"
                    aria-label={name}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-4 gap-y-4 border-t border-rule py-5 last:border-b sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto_auto]"
                  >
                    <p className={cx(eyebrow, "tabular hidden pt-[1.875rem] sm:block")} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <label className={cx(label, "col-span-2 sm:col-span-1")}>
                      {t("lobby.plan.name")}
                      <input value={person.name} maxLength={24} onChange={(e) => update(person.key, { name: e.target.value })} className={field} />
                    </label>
                    <label className={label}>
                      {t("lobby.plan.lang")}
                      <select value={person.lang} onChange={(e) => update(person.key, { lang: e.target.value as Locale })} className={field}>
                        {LOCALES.map((code) => (
                          <option key={code} value={code}>
                            {t(`languages.${code}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={cx(label, "col-span-2 sm:col-span-1")}>
                      {t("lobby.plan.level")}
                      <select value={person.level} onChange={(e) => update(person.key, { level: e.target.value as Level })} className={field}>
                        {LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {t(`lobby.plan.levels.${level}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="col-start-3 row-start-1 flex items-end justify-end sm:col-start-auto sm:row-start-auto">
                      <IconButton
                        icon="close"
                        label={t("lobby.plan.remove", { name })}
                        disabled={people.length <= 1}
                        onClick={() => setPeople((list) => list.filter((p) => p.key !== person.key))}
                      />
                    </div>
                    <label className={cx(label, "col-span-3 sm:col-span-4 sm:col-start-2")}>
                      {t("lobby.plan.wants")}
                      <textarea value={person.wants} maxLength={300} rows={2} onChange={(e) => update(person.key, { wants: e.target.value })} className={area} />
                    </label>
                  </div>
                );
              })}
            </fieldset>
            <div className="flex flex-wrap gap-3">
              <Action
                size="lg"
                disabled={people.length >= MAX_PEOPLE}
                onClick={() => {
                  setPeople((list) => [...list, { key: next, name: "", lang: locale, level: "new", wants: "" }]);
                  setNext((n) => n + 1);
                }}
              >
                {t("lobby.plan.add")}
              </Action>
              <Action type="submit" kind="primary" size="lg" disabled={busy}>
                {busy ? t("lobby.plan.planning") : t("lobby.plan.submit")}
              </Action>
            </div>
            <div aria-live="polite" className="empty:hidden">
              {state.kind === "missing" ? <Callout tone="warn">{t("lobby.plan.missing")}</Callout> : null}
              {run.phase === "failed" ? <Callout tone="danger">{t("lobby.plan.failed")}</Callout> : null}
              {run.phase === "done" && !plan ? <Callout tone="warn">{t("lobby.plan.unknownItem")}</Callout> : null}
            </div>
          </form>
        )}
      </StdbGate>
    </Section>
  );
}

function PlanCard({ plan, item, t, onStart, onAgain }: { plan: Plan; item: string; t: TogetherT; onStart: () => void; onAgain: () => void }) {
  const id = useId();
  return (
    <article aria-labelledby={`${id}-plan`} className="flex flex-col gap-10 border-t-2 border-line pt-6">
      <header className="max-w-[62ch]">
        <p className={eyebrow}>{item}</p>
        <h3 id={`${id}-plan`} className={cx(sectionTitle, "mt-4")}>
          {plan.title}
        </h3>
        <p className="mt-4 text-[17px] leading-[1.55] text-muted">{plan.why}</p>
      </header>
      <section aria-labelledby={`${id}-roles`}>
        <h4 id={`${id}-roles`} className={eyebrow}>
          {t("lobby.plan.roles")}
        </h4>
        <ul className="mt-3 grid grid-cols-1 border-t border-rule sm:grid-cols-2 sm:gap-x-8">
          {plan.roles.map((role) => (
            <li key={role.name} className="border-b border-rule py-4">
              <p className="font-semibold">
                {role.name} <span className="font-normal text-muted">· {role.role}</span>
              </p>
              <p className="mt-1 text-sm">
                <span className="text-muted">{t("lobby.plan.firstTask")}: </span>
                {role.firstTask}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby={`${id}-steps`}>
        <h4 id={`${id}-steps`} className={eyebrow}>
          {t("lobby.plan.steps")}
        </h4>
        <ol className="mt-3 border-t border-rule">
          {plan.steps.map((step, index) => (
            <li key={index} className="grid grid-cols-[2.5rem_minmax(0,1fr)] border-b border-rule py-3">
              <span className="font-ui text-sm tabular text-muted" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="max-w-[62ch]">{step}</span>
            </li>
          ))}
        </ol>
      </section>
      {plan.parts && plan.parts.length > 0 ? (
        <section aria-labelledby={`${id}-parts`}>
          <h4 id={`${id}-parts`} className={eyebrow}>
            {t("lobby.plan.parts")}
          </h4>
          <ul className="mt-3 flex flex-wrap gap-2">
            {plan.parts.map((part, index) => (
              <li key={index} className="rounded-full border border-rule px-3 py-1 font-ui text-xs">
                {part}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Action kind="primary" size="lg" onClick={onStart}>
          {t("lobby.plan.start")}
        </Action>
        <Action size="lg" onClick={onAgain}>
          {t("lobby.plan.again")}
        </Action>
      </div>
    </article>
  );
}
