export type JobKind = "build" | "diagnose" | "plan";
export type JobStatus = "queued" | "planning" | "running" | "reviewing" | "done" | "failed" | "cancelled";
export type StepRole = "planner" | "executor" | "critic" | "tool" | "system";
export type StepStatus = "running" | "ok" | "error";
export type ProposalStatus = "pending" | "accepted" | "rejected";

/** One agent_job row, with the JSON columns still raw: the parsers in view.ts read them defensively. */
export type Job = {
  id: string;
  owner: string;
  roomCode?: string;
  kind: string;
  goal: string;
  status: JobStatus;
  result: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type Step = {
  id: string;
  jobId: string;
  idx: number;
  role: StepRole;
  title: string;
  tool?: string;
  input: unknown;
  output: unknown;
  status: StepStatus;
  model?: string;
  ms: number;
  at: number;
};

export type Proposal = {
  id: string;
  jobId: string;
  kind: string;
  payload: unknown;
  status: ProposalStatus;
  at: number;
};

export type Watcher = { id: string; name: string; color: string };

export type MissionState = "loading" | "ready" | "missing" | "error" | "offline";

export type Mission = {
  state: MissionState;
  job?: Job;
  steps: Step[];
  proposals: Proposal[];
  watchers: Watcher[];
  cancel: () => void;
  resolve: (proposalId: string, accept: boolean) => void;
};

export const ACTIVE_STATUSES: readonly JobStatus[] = ["queued", "planning", "running", "reviewing"];
export const isActive = (status: JobStatus) => ACTIVE_STATUSES.includes(status);

export const JOB_STATUSES: readonly JobStatus[] = ["queued", "planning", "running", "reviewing", "done", "failed", "cancelled"];
export const STEP_ROLES: readonly StepRole[] = ["planner", "executor", "critic", "tool", "system"];
export const STEP_STATUSES: readonly StepStatus[] = ["running", "ok", "error"];
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ["pending", "accepted", "rejected"];
