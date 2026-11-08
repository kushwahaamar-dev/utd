"use client";

import { useCallback, useMemo, useState } from "react";
import { useAgentJob, useAgentSteps, useStdb, useStdbActions } from "@/lib/stdb";

export type AgentRun =
  | { phase: "idle" }
  | { phase: "working"; status: string; steps: number }
  | { phase: "done"; result: unknown }
  | { phase: "failed"; error: string };

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Runs one match or plan job on the worker: start it, follow the row, hand back the parsed result. */
export function useAgentRun(kind: "match" | "plan") {
  const stdb = useStdbActions();
  const { connection, identity } = useStdb();
  const [jobId, setJobId] = useState<bigint | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const { job } = useAgentJob(jobId);
  const { steps } = useAgentSteps(jobId);

  const start = useCallback(
    async (goal: string, context: unknown) => {
      setStartError(null);
      setStarting(true);
      setJobId(null);
      try {
        const mine = () => [...(connection?.db.agentJob.iter() ?? [])].filter((j) => identity && j.owner.isEqual(identity));
        const before = mine().reduce((max, j) => (j.id > max ? j.id : max), 0n);
        await stdb.startAgentJob({ kind, goal, context });
        // The reducer returns nothing: the new row arrives through the subscription a moment later.
        for (let i = 0; i < 60; i++) {
          const fresh = mine().find((j) => j.id > before && j.goal === goal.trim());
          if (fresh) return setJobId(fresh.id);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("The job did not appear.");
      } catch (e) {
        setStartError(e instanceof Error ? e.message : "could not start");
      } finally {
        setStarting(false);
      }
    },
    [connection, identity, kind, stdb],
  );

  const reset = useCallback(() => {
    setJobId(null);
    setStartError(null);
  }, []);

  const run = useMemo<AgentRun>(() => {
    if (startError) return { phase: "failed", error: startError };
    if (starting) return { phase: "working", status: "queued", steps: 0 };
    if (!job) return { phase: "idle" };
    if (job.status === "done") {
      const result = job.result ? parse(job.result) : undefined;
      return result === undefined ? { phase: "failed", error: "empty result" } : { phase: "done", result };
    }
    if (job.status === "failed" || job.status === "cancelled") return { phase: "failed", error: job.error ?? job.status };
    return { phase: "working", status: job.status, steps: steps.length };
  }, [job, steps.length, starting, startError]);

  return { run, start, reset };
}
