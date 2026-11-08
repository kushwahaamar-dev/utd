export const JOB_KINDS = ["build", "diagnose", "partner", "plan", "match"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export type JobStatus = "queued" | "planning" | "running" | "reviewing" | "done" | "failed" | "cancelled";
export type StepRole = "planner" | "executor" | "critic" | "tool" | "system";

export type AgentJob = {
  id: string;
  kind: JobKind;
  goal: string;
  /** Parsed from the agent_job.context JSON column. */
  context: Record<string, unknown>;
  owner?: string;
  roomCode?: string;
};

export type StepStart = { role: StepRole; title: string; tool?: string; input: unknown; model?: string };
export type StepEnd = { output: unknown; status: "ok" | "error"; ms: number };

/** Where a job's trace goes: SpacetimeDB rows in production, memory or the console otherwise. */
export interface JobSink {
  setStatus(status: JobStatus, patch?: { result?: unknown; error?: string }): Promise<void>;
  startStep(step: StepStart): Promise<string>;
  finishStep(id: string, end: StepEnd): Promise<void>;
  addProposal(kind: string, payload: unknown): Promise<void>;
  /** True once a human cancelled the job; the loop checks between rounds. */
  cancelled(): boolean;
}
