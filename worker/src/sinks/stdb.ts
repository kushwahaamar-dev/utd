import { DbConnection } from "@/lib/stdb/bindings";
import { clip } from "../tools/clip";
import { redact } from "./redact";
import type { JobSink, JobStatus, StepEnd, StepStart } from "../types";

export type Conn = DbConnection;

const json = (value: unknown) => redact(JSON.stringify(value ?? null));

/** Writes one job's trace into SpacetimeDB through the worker-only reducers, which is what Mission Control reads live. */
export class StdbSink implements JobSink {
  private next = 0;
  private stop = false;

  constructor(
    private readonly conn: Conn,
    private readonly jobId: bigint,
  ) {}

  /** A slow or refused write should not kill a job that is otherwise fine. */
  private async send(what: string, write: Promise<void>) {
    try {
      await write;
    } catch (error) {
      console.warn(`[sink] job ${this.jobId} ${what}: ${error instanceof Error ? error.message : error}`);
    }
  }

  setStatus(status: JobStatus, patch: { result?: unknown; error?: string } = {}) {
    return this.send(
      `status ${status}`,
      this.conn.reducers.workerJobStatus({
        jobId: this.jobId,
        status,
        result: patch.result === undefined ? undefined : json(patch.result),
        error: patch.error === undefined ? undefined : redact(patch.error),
      }),
    );
  }

  async startStep(step: StepStart) {
    const idx = this.next++;
    await this.send(
      `step ${idx} start`,
      this.conn.reducers.workerStepStart({
        jobId: this.jobId,
        idx,
        role: step.role,
        title: step.title,
        tool: step.tool,
        input: json(clip(step.input)),
        model: step.model,
      }),
    );
    return String(idx);
  }

  finishStep(id: string, end: StepEnd) {
    return this.send(
      `step ${id} finish`,
      this.conn.reducers.workerStepFinish({ jobId: this.jobId, idx: Number(id), output: json(end.output), status: end.status, ms: Math.min(end.ms, 0xffffffff) }),
    );
  }

  addProposal(kind: string, payload: unknown) {
    return this.send(`proposal ${kind}`, this.conn.reducers.workerAddProposal({ jobId: this.jobId, kind, payload: json(payload) }));
  }

  cancel() {
    this.stop = true;
  }

  cancelled() {
    return this.stop;
  }
}
