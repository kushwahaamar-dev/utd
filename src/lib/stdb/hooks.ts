"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Identity } from "spacetimedb";
import { useTable } from "spacetimedb/react";
import { tables } from "./bindings";
import type {
  ActivityMinute,
  AgentJob,
  AgentProposal,
  AgentStep,
  BuddyProfile,
  ChatMessage,
  ChatTranslation,
  CursorEvt,
  Leaderboard,
  PoseEvt,
  Race,
  RaceEntry,
  Room,
  RoomAction,
  RoomMember,
  RoomSnapshot,
} from "./bindings/types";
import { useStdb } from "./provider";

type Result<T> = { rows: readonly T[]; ready: boolean };

const asResult = <T,>([rows, ready]: [readonly T[], boolean]): Result<T> => ({ rows, ready });
const NONE = "\u0000none";

/** Wall-clock time that re-renders every `everyMs`, so render stays pure. */
function useNow(everyMs: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function useMe() {
  const { identity } = useStdb();
  const [rows, ready] = useTable(tables.player.where((p) => p.identity.eq(identity ?? (NONE as never))), { enabled: !!identity });
  return { player: rows[0], ready };
}

export function usePlayers() {
  return asResult(useTable(tables.player));
}

export function useRoom(code: string | null | undefined) {
  const [rows, ready] = useTable(tables.room.where((r) => r.code.eq(code ?? NONE)), { enabled: !!code });
  return { room: rows[0] as Room | undefined, ready };
}

export function useRoomMembers(code: string | null | undefined) {
  const [rows, ready] = useTable(tables.roomMember.where((m) => m.roomCode.eq(code ?? NONE)), { enabled: !!code });
  const members = useMemo(() => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1)) as RoomMember[], [rows]);
  return { members, ready };
}

/** The room's shared actions after `sinceSeq`, in the total order the module assigned. */
export function useRoomActions(code: string | null | undefined, sinceSeq: number | bigint = 0n) {
  const since = BigInt(sinceSeq);
  const [rows, ready] = useTable(tables.roomAction.where((a) => a.roomCode.eq(code ?? NONE)), { enabled: !!code });
  const actions = useMemo(
    () => rows.filter((a) => a.seq > since).sort((a, b) => (a.seq < b.seq ? -1 : 1)) as RoomAction[],
    [rows, since],
  );
  return { actions, ready };
}

/** The newest host snapshot, for a late joiner to start from before replaying actions after `snapshot.seq`. */
export function useRoomSnapshot(code: string | null | undefined) {
  const [rows, ready] = useTable(tables.roomSnapshot.where((s) => s.roomCode.eq(code ?? NONE)), { enabled: !!code });
  return { snapshot: rows[0] as RoomSnapshot | undefined, ready };
}

export function useChat(code: string | null | undefined) {
  const [rows, ready] = useTable(tables.chatMessage.where((m) => m.roomCode.eq(code ?? NONE)), { enabled: !!code });
  const messages = useMemo(() => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1)) as ChatMessage[], [rows]);
  return { messages, ready };
}

/** Translations of one room's chat, as messageId -> lang -> text. */
export function useTranslations(code: string | null | undefined) {
  const [rows, ready] = useTable(tables.chatTranslation.where((t) => t.roomCode.eq(code ?? NONE)), { enabled: !!code });
  const byMessage = useMemo(() => {
    const out = new Map<bigint, Record<string, string>>();
    for (const row of rows as readonly ChatTranslation[]) {
      out.set(row.messageId, { ...out.get(row.messageId), [row.lang]: row.text });
    }
    return out;
  }, [rows]);
  return { byMessage, ready };
}

export function useLeaderboard(course: string | null | undefined, limit = 20) {
  const [rows, ready] = useTable(tables.leaderboard.where((l) => l.course.eq(course ?? NONE)), { enabled: !!course });
  const entries = useMemo(
    () => ([...rows].sort((a, b) => a.bestMs - b.bestMs || (a.id < b.id ? -1 : 1)).slice(0, limit)) as Leaderboard[],
    [rows, limit],
  );
  return { entries, ready };
}

/** Counts per kind over the last `windowMinutes`, and the raw per-minute rows. */
export function useLiveActivity(windowMinutes = 60) {
  const [rows, ready] = useTable(tables.activityMinute);
  const now = useNow(30_000);
  return useMemo(() => {
    const since = now - windowMinutes * 60_000;
    const totals: Record<string, number> = {};
    const recent: ActivityMinute[] = [];
    for (const row of rows as readonly ActivityMinute[]) {
      if (Number(row.minute.microsSinceUnixEpoch / 1000n) < since) continue;
      recent.push(row);
      totals[row.kind] = (totals[row.kind] ?? 0) + row.count;
    }
    return { totals, minutes: recent, ready };
  }, [rows, ready, windowMinutes, now]);
}

export function useBuddies() {
  const [rows, ready] = useTable(tables.buddyProfile);
  const { identity } = useStdb();
  const now = useNow(60_000);
  return useMemo(() => {
    const live = (rows as readonly BuddyProfile[]).filter((b) => Number(b.expiresAt.microsSinceUnixEpoch / 1000n) > now);
    return {
      buddies: live.filter((b) => !identity || !b.identity.isEqual(identity)),
      mine: live.find((b) => identity && b.identity.isEqual(identity)),
      ready,
    };
  }, [rows, ready, identity, now]);
}

export function useMyProgress() {
  const [rows, ready] = useTable(tables.myProgress);
  const keys = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  return { keys, rows, ready };
}

export function useMyJobs() {
  const { identity } = useStdb();
  const [rows, ready] = useTable(tables.agentJob.where((j) => j.owner.eq(identity ?? (NONE as never))), { enabled: !!identity });
  const jobs = useMemo(() => [...rows].sort((a, b) => (a.id < b.id ? 1 : -1)) as AgentJob[], [rows]);
  return { jobs, ready };
}

export function useAgentJob(id: bigint | number | null | undefined) {
  const [rows, ready] = useTable(tables.agentJob.where((j) => j.id.eq(BigInt(id ?? 0))), { enabled: id != null });
  return { job: rows[0] as AgentJob | undefined, ready };
}

export function useAgentSteps(jobId: bigint | number | null | undefined) {
  const [rows, ready] = useTable(tables.agentStep.where((s) => s.jobId.eq(BigInt(jobId ?? 0))), { enabled: jobId != null });
  const steps = useMemo(() => [...rows].sort((a, b) => a.idx - b.idx) as AgentStep[], [rows]);
  return { steps, ready };
}

export function useAgentProposals(jobId: bigint | number | null | undefined) {
  const [rows, ready] = useTable(tables.agentProposal.where((p) => p.jobId.eq(BigInt(jobId ?? 0))), { enabled: jobId != null });
  const proposals = useMemo(() => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1)) as AgentProposal[], [rows]);
  return { proposals, ready };
}

export function useRaces() {
  const [rows, ready] = useTable(tables.race);
  const races = useMemo(() => [...rows].sort((a, b) => (a.id < b.id ? 1 : -1)) as Race[], [rows]);
  return { races, ready };
}

export function useRaceEntries(raceId: bigint | number | null | undefined) {
  const [rows, ready] = useTable(tables.raceEntry.where((e) => e.raceId.eq(BigInt(raceId ?? 0))), { enabled: raceId != null });
  const entries = useMemo(
    () => [...rows].sort((a, b) => (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity) || (a.id < b.id ? -1 : 1)) as RaceEntry[],
    [rows],
  );
  return { entries, ready };
}

/** Credentials for an identity or a wallet address (a string is taken as a wallet). */
export function useCredentials(who: Identity | string | null | undefined) {
  const wallet = typeof who === "string" ? who : null;
  const identity = who && typeof who !== "string" ? who : null;
  const [byWallet, readyW] = useTable(tables.credential.where((c) => c.wallet.eq(wallet ?? NONE)), { enabled: !!wallet });
  const [byIdentity, readyI] = useTable(tables.credential.where((c) => c.identity.eq(identity ?? (NONE as never))), { enabled: !!identity });
  const credentials = wallet ? byWallet : byIdentity;
  return { credentials, ready: wallet ? readyW : readyI };
}

/** Calls `onEvent` for every cursor update in the room (an event table: nothing is stored). */
export function useCursorEvents(code: string | null | undefined, onEvent: (event: CursorEvt) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const callbacks = useMemo(() => ({ onInsert: (row: CursorEvt) => handler.current(row), enabled: !!code }), [code]);
  useTable(tables.cursorEvt.where((c) => c.roomCode.eq(code ?? NONE)), callbacks);
}

export function usePoseEvents(code: string | null | undefined, onEvent: (event: PoseEvt) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const callbacks = useMemo(() => ({ onInsert: (row: PoseEvt) => handler.current(row), enabled: !!code }), [code]);
  useTable(tables.poseEvt.where((p) => p.roomCode.eq(code ?? NONE)), callbacks);
}

export type { Room };
