"use client";

import { useMemo } from "react";
import type { Identity } from "spacetimedb";
import type { DbConnection } from "./bindings";
import type { ApiResult } from "./bindings/types";
import { useStdb } from "./provider";

export class StdbOfflineError extends Error {
  constructor() {
    super("not connected to the realtime server");
    this.name = "StdbOfflineError";
  }
}

export type LabKind = "board" | "robotics" | "drone";
export type ChatKind = "text" | "voice" | "ai";
export type AgentKind = "build" | "diagnose" | "partner" | "plan" | "match";
export type OfferSource = "google_shopping" | "amazon" | "ebay" | "walmart";
export type PresenceUpdate = {
  role?: "builder" | "spectator";
  labRole?: "wirer" | "coder" | "pilot" | "watcher";
  status?: string;
  name?: string;
  done?: string[];
};

/** A procedure's answer: data on success, a readable reason (including "not configured") otherwise. */
export type ProcedureOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

const big = (n: number | bigint) => BigInt(n);

function outcome<T>(result: ApiResult, parse: (text: string) => T): ProcedureOutcome<T> {
  if (!result.ok) return { ok: false, error: result.error };
  try {
    return { ok: true, data: parse(result.text) };
  } catch {
    return { ok: false, error: "bad reply from the server" };
  }
}

function makeActions(conn: DbConnection | null) {
  const need = (): DbConnection => {
    if (!conn) throw new StdbOfflineError();
    return conn;
  };
  /** Cursor and pose frames are best-effort: offline or throttled, they are just dropped. */
  const quiet = (run: (c: DbConnection) => Promise<void>) => {
    if (!conn) return;
    run(conn).catch(() => {});
  };

  return {
    setProfile: (p: { name: string; color: string; lang: string }) => need().reducers.setProfile(p),
    linkWallet: (wallet: string) => need().reducers.linkWallet({ wallet }),

    createRoom: (lab: LabKind, itemId: string) => need().reducers.createRoom({ lab, itemId }),
    joinRoom: (code: string, bind?: { lab: LabKind; itemId: string }) =>
      need().reducers.joinRoom({ code, lab: bind?.lab, itemId: bind?.itemId }),
    leaveRoom: (code: string) => need().reducers.leaveRoom({ code }),
    /** Rejects with "no_baton" or "not_shared" when the module refuses the action. */
    submitAction: (code: string, action: { type: string; [key: string]: unknown }) =>
      need().reducers.submitAction({ code, action: JSON.stringify(action) }),
    postSnapshot: (code: string, seq: number | bigint, state: unknown) =>
      need().reducers.postSnapshot({ code, seq: big(seq), state: JSON.stringify(state) }),
    sendChat: (code: string, text: string, lang: string, kind: ChatKind = "text") =>
      need().reducers.sendChat({ code, text, lang, kind }),
    setPresence: (code: string, update: PresenceUpdate) =>
      need().reducers.setPresence({
        code,
        role: update.role,
        labRole: update.labRole,
        status: update.status,
        name: update.name,
        done: update.done ? JSON.stringify(update.done) : undefined,
      }),
    /** `to: null` hands the keyboard back to the host. */
    passBaton: (code: string, to: Identity | null) => need().reducers.passBaton({ code, to: to ?? undefined }),
    kick: (code: string, target: Identity) => need().reducers.kick({ code, target }),
    sendCursor: (code: string, x: number, y: number) => quiet((c) => c.reducers.sendCursor({ code, x, y })),
    sendPose: (code: string, pose: { p: number[]; q: number[]; v?: unknown; gate?: unknown }) =>
      quiet((c) =>
        c.reducers.sendPose({
          code,
          p: JSON.stringify(pose.p),
          q: JSON.stringify(pose.q),
          v: pose.v === undefined ? undefined : JSON.stringify(pose.v),
          gate: pose.gate === undefined ? undefined : JSON.stringify(pose.gate),
        }),
      ),

    recordProgress: (key: string) => need().reducers.recordProgress({ key }),
    trackActivity: (kind: string, count = 1) => need().reducers.trackActivity({ kind, count }),
    submitLap: (lap: { course: string; timeMs: number; inputs: unknown; name?: string }) =>
      need().reducers.submitLap({ course: lap.course, timeMs: lap.timeMs, inputs: JSON.stringify(lap.inputs), name: lap.name }),

    upsertBuddy: (b: { name: string; lang: string; interests: string[]; built: string[]; wants: string }) =>
      need().reducers.upsertBuddy({
        name: b.name,
        lang: b.lang,
        interests: JSON.stringify(b.interests),
        built: JSON.stringify(b.built),
        wants: b.wants,
      }),
    deleteBuddy: () => need().reducers.deleteBuddy({}),

    startAgentJob: (job: { kind: AgentKind; goal: string; context?: unknown; roomCode?: string }) =>
      need().reducers.startAgentJob({
        kind: job.kind,
        goal: job.goal,
        context: JSON.stringify(job.context ?? {}),
        roomCode: job.roomCode,
      }),
    cancelAgentJob: (jobId: number | bigint) => need().reducers.cancelAgentJob({ jobId: big(jobId) }),
    resolveProposal: (proposalId: number | bigint, accept: boolean) =>
      need().reducers.resolveProposal({ proposalId: big(proposalId), accept }),

    /** `enterSig` is the signature of the on-chain entry transaction the wallet just sent. */
    enterRace: (raceId: number | bigint, enterSig: string) => need().reducers.enterRace({ raceId: big(raceId), enterSig }),
    /** `run` is the RunLog object; the module replays it and queues the credential if it passes. */
    submitRun: (r: { kind: string; itemId: string; sub?: string; run: unknown }) =>
      need().reducers.submitRun({ kind: r.kind, itemId: r.itemId, sub: r.sub, run: JSON.stringify(r.run) }),

    translateMessage: async (messageId: number | bigint, lang: string): Promise<ProcedureOutcome<string>> =>
      outcome(await need().procedures.translateMessage({ messageId: big(messageId), lang }), (text) => text),
    searchOffers: async (query: string, source?: OfferSource): Promise<ProcedureOutcome<unknown[]>> =>
      outcome(await need().procedures.searchOffers({ query, source }), (text) => JSON.parse(text) as unknown[]),
    searchWeb: async (query: string): Promise<ProcedureOutcome<{ title: string; url: string; snippet: string }[]>> =>
      outcome(await need().procedures.searchWeb({ query }), (text) => JSON.parse(text)),
  };
}

export type StdbActions = ReturnType<typeof makeActions>;

/** Typed wrappers for every client reducer and procedure. Calls reject with StdbOfflineError while disconnected. */
export function useStdbActions(): StdbActions {
  const { connection } = useStdb();
  return useMemo(() => makeActions(connection), [connection]);
}
