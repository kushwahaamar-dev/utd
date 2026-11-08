"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { LabKind } from "@/components/dock/types";
import { InviteDialog } from "@/components/realtime/InviteDialog";
import type { TogetherT } from "@/components/realtime/messages";
import { Action, Note, Section, eyebrow, area, field } from "@/components/editorial/Editorial";
import { Callout } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { useLocale } from "@/i18n/client";
import { useSaved } from "@/lib/progress";
import { createRoom, useIdentity } from "@/lib/realtime";
import { track } from "@/lib/telemetry";
import { useBuddies, useStdbActions } from "@/lib/stdb";
import { StdbGate, roomPath } from "./api";
import { useAgentRun } from "./useAgentRun";

type Profile = { id: string; name: string; lang: string; interests: string[]; built: string[]; wants: string };
type Match = { id: string; why: string; sharedInterest: string; project?: { lab: LabKind; id: string } };

const label = cx(eyebrow, "flex flex-col gap-2");

const splitList = (text: string) =>
  text
    .split(/[,，、;]/)
    .map((part) => part.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);

function jsonList(text: string): string[] {
  try {
    const list: unknown = JSON.parse(text);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The worker names a project as a string; the catalogue knows it as "lab:id" (or just the id). */
function findProject(raw: unknown, titles: Map<string, string>): Match["project"] {
  if (typeof raw !== "string") return undefined;
  const key = titles.has(raw) ? raw : [...titles.keys()].find((k) => k.endsWith(`:${raw}`));
  if (!key) return undefined;
  const [lab, id] = key.split(":");
  return { lab: lab as LabKind, id: id! };
}

function readMatches(result: unknown, pool: Profile[], me: Profile, titles: Map<string, string>): Match[] {
  const list = (result as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(list)) return [];
  const out: Match[] = [];
  for (const m of list as { id?: unknown; why?: unknown; suggestedProject?: unknown }[]) {
    const buddy = pool.find((p) => p.id === m.id);
    if (!buddy || typeof m.why !== "string") continue;
    const shared = buddy.interests.find((i) => me.interests.some((mine) => mine.toLowerCase() === i.toLowerCase())) ?? "";
    out.push({ id: buddy.id, why: m.why, sharedInterest: shared, project: findProject(m.suggestedProject, titles) });
  }
  return out;
}

type State = { kind: "idle" } | { kind: "missing" } | { kind: "saving" } | { kind: "error" } | { kind: "searching"; me: Profile; pool: Profile[] };

export function Buddies({ t, titles, index }: { t: TogetherT; titles: Map<string, string>; index?: string }) {
  const id = useId();
  const router = useRouter();
  const locale = useLocale();
  const identity = useIdentity();
  const saved = useSaved();
  const stdb = useStdbActions();
  const { buddies } = useBuddies();
  const { run, start, reset } = useAgentRun("match");
  const [name, setName] = useState<string | null>(null);
  const [interests, setInterests] = useState("");
  const [wants, setWants] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [inviting, setInviting] = useState<{ match: Match; name: string; link: string } | null>(null);
  const built = useMemo(() => Object.keys(saved.done).slice(0, 64), [saved]);
  const shownName = name ?? identity?.name ?? "";

  const pool = useMemo<Profile[]>(
    () =>
      buddies.slice(0, 50).map((b) => ({
        id: b.identity.toHexString(),
        name: b.name,
        lang: b.lang,
        interests: jsonList(b.interests),
        built: jsonList(b.built),
        wants: b.wants,
      })),
    [buddies],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!shownName.trim() || !wants.trim()) return setState({ kind: "missing" });
    setState({ kind: "saving" });
    reset();
    const me: Profile = { id: "me", name: shownName.trim().slice(0, 24), lang: locale, interests: splitList(interests), built, wants: wants.trim().slice(0, 280) };
    try {
      await stdb.upsertBuddy(me);
    } catch {
      return setState({ kind: "error" });
    }
    setState({ kind: "searching", me, pool });
    if (pool.length === 0) return;
    track("ai.call", { kind: "match" });
    await start(`Find build buddies for ${me.name}: ${me.wants}`, { me, pool });
  };

  const searching = state.kind === "searching" ? state : null;
  const matches = useMemo(
    () => (searching && run.phase === "done" ? readMatches(run.result, searching.pool, searching.me, titles) : []),
    [searching, run, titles],
  );
  const busy = state.kind === "saving" || run.phase === "working";

  return (
    <Section id={`${id}-title`} index={index} title={t("lobby.buddies.title")} lede={t("lobby.buddies.lede")}>
      <div className="flex flex-col gap-8">
      <StdbGate t={t} notSetUp={t("lobby.buddies.notSetUp")}>
        <form onSubmit={submit} className="grid gap-x-5 gap-y-6 sm:grid-cols-2" noValidate>
          <label className={label} htmlFor={`${id}-name`}>
            {t("lobby.buddies.name")}
            <input
              id={`${id}-name`}
              value={shownName}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              autoComplete="nickname"
              className={field}
            />
          </label>
          <label className={label} htmlFor={`${id}-interests`}>
            {t("lobby.buddies.interests")}
            <input
              id={`${id}-interests`}
              value={interests}
              onChange={(event) => setInterests(event.target.value)}
              aria-describedby={`${id}-interests-hint`}
              className={field}
            />
            <span id={`${id}-interests-hint`} className="font-body text-xs font-normal tracking-normal normal-case text-muted">
              {t("lobby.buddies.interestsHint")}
            </span>
          </label>
          <label className={cx(label, "sm:col-span-2")} htmlFor={`${id}-wants`}>
            {t("lobby.buddies.wants")}
            <textarea
              id={`${id}-wants`}
              value={wants}
              onChange={(event) => setWants(event.target.value)}
              maxLength={280}
              rows={3}
              className={area}
            />
          </label>
          <p className="max-w-[62ch] text-sm text-muted sm:col-span-2">
            {t("lobby.buddies.privacy")}
            {built.length > 0 ? ` ${t("lobby.buddies.builtNote", { count: built.length })}` : ""}
          </p>
          <div className="sm:col-span-2">
            <Action type="submit" kind="primary" size="lg" disabled={busy}>
              {busy ? t("lobby.buddies.finding") : t("lobby.buddies.submit")}
            </Action>
          </div>
        </form>
        <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">
          {state.kind === "missing" ? <Callout tone="warn">{t("lobby.buddies.missing")}</Callout> : null}
          {state.kind === "error" || run.phase === "failed" ? <Callout tone="danger">{t("lobby.buddies.failed")}</Callout> : null}
          {searching && pool.length === 0 ? <Note>{t("lobby.buddies.alone")}</Note> : null}
          {searching && run.phase === "done" && matches.length === 0 ? <Note>{t("lobby.buddies.none")}</Note> : null}
          {matches.length > 0 ? (
            <>
              <h3 className={eyebrow}>{t("lobby.buddies.matches")}</h3>
              <ul className="grid grid-cols-1 border-t border-rule md:grid-cols-2 md:gap-x-10">
                {matches.map((match) => {
                  const buddy = searching?.pool.find((p) => p.id === match.id);
                  const project = match.project ? titles.get(`${match.project.lab}:${match.project.id}`) : undefined;
                  if (!buddy) return null;
                  return (
                    <li key={match.id} className="flex flex-col gap-2 border-b border-rule py-6">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="text-2xl font-medium tracking-[-0.02em]">{buddy.name}</span>
                      </p>
                      <p className="max-w-[56ch]">{match.why}</p>
                      {match.sharedInterest ? <p className="text-sm text-muted">{t("lobby.buddies.shared", { interest: match.sharedInterest })}</p> : null}
                      {project && match.project ? (
                        <>
                          <p className="mt-2 text-sm font-semibold">{t("lobby.buddies.project", { item: project })}</p>
                          <Action
                            size="sm"
                            className="mt-1 self-start"
                            onClick={() =>
                              setInviting({ match, name: buddy.name, link: createRoom(match.project!.lab, match.project!.id, locale) })
                            }
                          >
                            {t("lobby.buddies.invite")}
                          </Action>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      </StdbGate>
      </div>
      {inviting ? (
        <InviteDialog
          open
          onClose={() => setInviting(null)}
          link={inviting.link}
          code={new URL(inviting.link).searchParams.get("room") ?? ""}
          title={t("lobby.buddies.inviteTitle", {
            item: titles.get(`${inviting.match.project?.lab}:${inviting.match.project?.id}`) ?? "",
            name: inviting.name,
          })}
          hint={t("lobby.buddies.inviteHint", {
            name: inviting.name,
            item: titles.get(`${inviting.match.project?.lab}:${inviting.match.project?.id}`) ?? "",
          })}
          action={{ label: t("lobby.create.go"), run: () => router.push(roomPath(inviting.link)) }}
          t={t}
        />
      ) : null}
    </Section>
  );
}
