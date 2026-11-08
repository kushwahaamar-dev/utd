"use client";

import { useCallback, useMemo } from "react";
import {
  useAgentJob,
  useAgentProposals,
  useAgentSteps,
  useMyJobs,
  useRoomMembers,
  useStdb,
  useStdbActions,
  type AgentJob,
  type AgentProposal,
  type AgentStep,
} from "@/lib/stdb";
import type { MissionAdapter } from "./data";
import { JOB_STATUSES, PROPOSAL_STATUSES, STEP_ROLES, STEP_STATUSES, type Job, type Mission, type Proposal, type Step } from "./types";
import { parseJson } from "./view";

// The SpacetimeDB side of the page: rows in, the shapes the components read out. u64 ids become strings,
// timestamps milliseconds, JSON columns stay raw for view.ts to read defensively.

const ms = (ts: { microsSinceUnixEpoch: bigint }) => Number(ts.microsSinceUnixEpoch / 1000n);
const pick = <T extends string>(allowed: readonly T[], value: string, fallback: T): T => (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

function toJob(row: AgentJob): Job {
  return {
    id: String(row.id),
    owner: row.owner.toHexString(),
    roomCode: row.roomCode ?? undefined,
    kind: row.kind,
    goal: row.goal,
    status: pick(JOB_STATUSES, row.status, "queued"),
    result: row.result == null ? undefined : parseJson(row.result),
    error: row.error ?? undefined,
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

function toStep(row: AgentStep): Step {
  return {
    id: String(row.id),
    jobId: String(row.jobId),
    idx: row.idx,
    role: pick(STEP_ROLES, row.role, "system"),
    title: row.title,
    tool: row.tool ?? undefined,
    input: parseJson(row.input),
    output: parseJson(row.output),
    status: pick(STEP_STATUSES, row.status, "ok"),
    model: row.model ?? undefined,
    ms: row.ms,
    at: ms(row.at),
  };
}

function toProposal(row: AgentProposal): Proposal {
  return {
    id: String(row.id),
    jobId: String(row.jobId),
    kind: row.kind,
    payload: parseJson(row.payload),
    status: pick(PROPOSAL_STATUSES, row.status, "pending"),
    at: ms(row.at),
  };
}

const parseId = (value: string): bigint | null => (/^\d{1,18}$/.test(value) ? BigInt(value) : null);

const COLORS = ["#ef6a4c", "#76a0e2", "#93d3b0", "#f4b829", "#f3a6bb"];

export const liveAdapter: MissionAdapter = {
  mode: "live",

  useMission(jobId) {
    const id = parseId(jobId);
    const { status } = useStdb();
    const stdb = useStdbActions();
    const { job: row, ready } = useAgentJob(id);
    const { steps: stepRows } = useAgentSteps(id);
    const { proposals: proposalRows } = useAgentProposals(id);
    const { members } = useRoomMembers(row?.roomCode);

    const job = useMemo(() => (row ? toJob(row) : undefined), [row]);
    const steps = useMemo(() => stepRows.map(toStep), [stepRows]);
    const proposals = useMemo(() => proposalRows.map(toProposal), [proposalRows]);
    const watchers = useMemo(
      () => members.map((m, i) => ({ id: m.identity.toHexString(), name: m.name || "?", color: m.color || COLORS[i % COLORS.length] })),
      [members],
    );

    const cancel = useCallback(() => {
      if (id !== null) void stdb.cancelAgentJob(id).catch(() => {});
    }, [id, stdb]);
    const resolve = useCallback((proposalId: string, accept: boolean) => {
      const pid = parseId(proposalId);
      if (pid !== null) void stdb.resolveProposal(pid, accept).catch(() => {});
    }, [stdb]);

    return useMemo((): Mission => {
      const base = { steps, proposals, watchers, cancel, resolve };
      if (id === null) return { ...base, state: "missing" };
      if (job) return { ...base, job, state: "ready" };
      if (status === "offline") return { ...base, state: "offline" };
      return { ...base, state: ready && status === "online" ? "missing" : "loading" };
    }, [id, job, steps, proposals, watchers, cancel, resolve, status, ready]);
  },

  useMyMissions() {
    const { jobs } = useMyJobs();
    return useMemo(() => jobs.map(toJob), [jobs]);
  },

  useOnline() {
    return useStdb().status !== "offline";
  },

  useStartMission() {
    const { connection, identity } = useStdb();
    const stdb = useStdbActions();
    return useCallback(
      async ({ kind, goal, roomCode }) => {
        const mine = () => [...(connection?.db.agentJob.iter() ?? [])].filter((j) => identity && j.owner.isEqual(identity));
        const before = mine().reduce((max, j) => (j.id > max ? j.id : max), 0n);
        await stdb.startAgentJob({ kind, goal, roomCode });
        // The reducer returns nothing: the new row shows up through the subscription a moment later.
        for (let i = 0; i < 60; i++) {
          const fresh = mine().find((j) => j.id > before && j.goal === goal);
          if (fresh) return String(fresh.id);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("The job did not appear.");
      },
      [connection, identity, stdb],
    );
  },
};
