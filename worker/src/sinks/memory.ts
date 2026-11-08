import type { AgentJob, JobSink, JobStatus, StepEnd, StepStart } from "../types";

export type RecordedStep = StepStart & { id: string; idx: number; end?: StepEnd };
export type RecordedProposal = { kind: string; payload: unknown };

/** Keeps the whole trace in memory: for tests, the CLI, and anything that wants to read a job back. */
export class MemorySink implements JobSink {
  status: JobStatus = "queued";
  statuses: JobStatus[] = [];
  steps: RecordedStep[] = [];
  proposals: RecordedProposal[] = [];
  result?: unknown;
  error?: string;
  private stop = false;

  constructor(
    readonly job?: Pick<AgentJob, "id">,
    private readonly onEvent?: (event: SinkEvent) => void,
  ) {}

  async setStatus(status: JobStatus, patch: { result?: unknown; error?: string } = {}) {
    this.status = status;
    this.statuses.push(status);
    if (patch.result !== undefined) this.result = patch.result;
    if (patch.error !== undefined) this.error = patch.error;
    this.onEvent?.({ type: "status", status, ...patch });
  }

  async startStep(step: StepStart) {
    const idx = this.steps.length;
    this.steps.push({ ...step, id: String(idx), idx });
    this.onEvent?.({ type: "start", idx, step });
    return String(idx);
  }

  async finishStep(id: string, end: StepEnd) {
    const step = this.steps[Number(id)];
    step.end = end;
    this.onEvent?.({ type: "finish", idx: step.idx, step, end });
  }

  async addProposal(kind: string, payload: unknown) {
    this.proposals.push({ kind, payload });
    this.onEvent?.({ type: "proposal", kind, payload });
  }

  cancel() {
    this.stop = true;
  }

  cancelled() {
    return this.stop;
  }
}

export type SinkEvent =
  | { type: "status"; status: JobStatus; result?: unknown; error?: string }
  | { type: "start"; idx: number; step: StepStart }
  | { type: "finish"; idx: number; step: StepStart; end: StepEnd }
  | { type: "proposal"; kind: string; payload: unknown };
