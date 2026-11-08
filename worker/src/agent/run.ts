import type { z } from "zod";
import { AiError } from "@/lib/server/ai/provider";
import { parseReply } from "../model/json";
import type { Evidence, ModelClient, ModelReply, ModelRequest, Plan, ProviderMessage, Scope } from "../model/types";
import { callTool, toolSpecs } from "../tools";
import { clip } from "../tools/clip";
import type { AgentJob, JobSink } from "../types";
import { CriticSchema, PlanSchema, ResultSchema, checkResult, toPlan, type Critique, type JobResult } from "./schemas";
import { criticPrompt, digest, executorPrompt, finalPrompt, planText, plannerPrompt } from "./prompts";

export const MAX_REVISIONS = 3;
export const MAX_TOOL_ROUNDS = 6;
const JSON_TRIES = 3;

export class JobCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

export type RunDeps = { model: ModelClient; sink: JobSink; signal?: AbortSignal };

export type JobOutcome = { plan: Plan; result: JobResult; revisions: number; critique: Critique };

const now = () => Date.now();

/** Everything one job needs while it runs. */
class Run {
  readonly evidence: Evidence[] = [];
  readonly summaries: string[] = [];
  revisions = 0;
  plan: Plan = { steps: [], success_criteria: [] };

  constructor(
    readonly job: AgentJob,
    readonly deps: RunDeps,
  ) {}

  get scope(): Scope {
    return {
      kind: this.job.kind,
      goal: this.job.goal,
      context: this.job.context,
      plan: this.plan,
      evidence: this.evidence,
      revisions: this.revisions,
    };
  }

  checkAlive() {
    if (this.deps.sink.cancelled() || this.deps.signal?.aborted) throw new JobCancelled();
  }

  ask(req: Omit<ModelRequest, "signal" | "scope"> & { scope?: Partial<Scope> }): Promise<ModelReply> {
    this.checkAlive();
    const { scope, ...rest } = req;
    return this.deps.model.complete({ ...rest, signal: this.deps.signal, scope: { ...this.scope, ...scope } });
  }

  /** One recorded step around `work`: a running row first, the output (or the error) when it settles. */
  async step<T>(start: Parameters<JobSink["startStep"]>[0], work: () => Promise<T>, output: (value: T) => unknown): Promise<T> {
    const id = await this.deps.sink.startStep(start);
    const began = now();
    try {
      const value = await work();
      await this.deps.sink.finishStep(id, { output: output(value), status: "ok", ms: now() - began });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.sink.finishStep(id, { output: { error: message }, status: "error", ms: now() - began });
      throw error;
    }
  }

  /** A JSON reply validated by `schema`; a bad one is sent back to the model with what was wrong. */
  async askJson<S extends z.ZodType>(
    req: Omit<ModelRequest, "signal" | "scope">,
    schema: S,
    check?: (data: z.output<S>) => string | null,
    scope?: Partial<Scope>,
  ): Promise<{ data: z.output<S>; reply: ModelReply }> {
    const messages: ProviderMessage[] = [...req.messages];
    let problem = "";
    for (let attempt = 0; attempt < JSON_TRIES; attempt++) {
      const reply = await this.ask({ ...req, messages, scope });
      const parsed = parseReply(schema, reply.text, check);
      if (parsed.ok) return { data: parsed.data, reply };
      problem = parsed.problem;
      messages.push(
        { role: "assistant", content: reply.text || "(empty)" },
        { role: "user", content: `That reply was not usable: ${problem}. Reply again with only the corrected JSON object.` },
      );
    }
    throw new AiError("bad_output", `${req.phase}: ${problem}`);
  }
}

function contextText(job: AgentJob): string {
  const text = JSON.stringify(clip(job.context));
  return text === "{}" ? "(none)" : text.slice(0, 3000);
}

async function planPhase(run: Run): Promise<void> {
  const { job, deps } = run;
  await deps.sink.setStatus("planning");
  const messages: ProviderMessage[] = [
    { role: "system", content: plannerPrompt(job.kind) },
    { role: "user", content: `Goal: ${job.goal}\n\nContext: ${contextText(job)}` },
  ];
  let thinking = "";
  const plan = await run.step(
    { role: "planner", title: "Plan the work", input: { goal: job.goal, context: clip(job.context) } },
    async () => {
      const { data, reply } = await run.askJson({ phase: "plan", role: "planner", reasoning: "high", messages, maxTokens: 8000 }, PlanSchema);
      thinking = reply.reasoning;
      return toPlan(data);
    },
    (value) => ({ ...value, ...(thinking ? { thinking: thinking.slice(0, 1500) } : {}) }),
  );
  run.plan = plan;
}

async function executeStep(run: Run, title: string, goal: string, index: number, fixes?: string[]): Promise<void> {
  const { job, deps } = run;
  const findings = run.summaries.length ? run.summaries.map((s) => `- ${s}`).join("\n") : "(nothing yet)";
  const messages: ProviderMessage[] = [
    { role: "system", content: executorPrompt(job.kind) },
    {
      role: "user",
      content: [
        `Goal: ${job.goal}`,
        `Context: ${contextText(job)}`,
        `Plan:\n${planText(run.plan, index)}`,
        `Success criteria:\n${run.plan.success_criteria.map((c) => `- ${c}`).join("\n")}`,
        `Findings so far:\n${findings}`,
        fixes ? `The critic asked for these fixes:\n${fixes.map((f) => `- ${f}`).join("\n")}\n` : "",
        `Now do this step: ${title}. ${goal}\nCall tools as needed, then reply with a short summary when the step is done.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  const specs = toolSpecs();
  const scope: Partial<Scope> = { stepIndex: index, ...(fixes ? { fixes } : {}) };

  await run.step(
    { role: "executor", title, input: { goal } },
    async () => {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const last = round === MAX_TOOL_ROUNDS - 1;
        const reply = await run.ask({ phase: "execute", role: "fast", reasoning: "minimal", messages, tools: last ? undefined : specs, maxTokens: 4000, scope });
        if (!reply.toolCalls.length) return reply.text.trim() || "(the executor gave no summary)";
        messages.push({
          role: "assistant",
          content: reply.text || null,
          tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
        });
        for (const call of reply.toolCalls) {
          const started = now();
          const stepId = await deps.sink.startStep({ role: "tool", title: call.name, tool: call.name, input: safeJson(call.arguments), model: reply.model });
          const outcome = await callTool(call.name, call.arguments, { sink: deps.sink, signal: deps.signal });
          run.evidence.push({ tool: call.name, args: safeJson(call.arguments), value: outcome.value, ok: outcome.ok });
          await deps.sink.finishStep(stepId, { output: clip(outcome.value), status: outcome.ok ? "ok" : "error", ms: now() - started });
          messages.push({ role: "tool", tool_call_id: call.id, content: outcome.message });
        }
        scope.evidence = run.evidence;
      }
      return "(the step hit its tool-call limit)";
    },
    (summary) => ({ summary }),
  ).then((summary) => {
    run.summaries.push(`${title}: ${summary}`);
  });
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
};

async function review(run: Run): Promise<Critique> {
  const { job, deps } = run;
  await deps.sink.setStatus("reviewing");
  const messages: ProviderMessage[] = [
    { role: "system", content: criticPrompt },
    {
      role: "user",
      content: [
        `Goal: ${job.goal}`,
        `Success criteria:\n${run.plan.success_criteria.map((c) => `- ${c}`).join("\n")}`,
        `Executor summaries:\n${run.summaries.map((s) => `- ${s}`).join("\n")}`,
        `Tool evidence:\n${digest(run.evidence)}`,
      ].join("\n\n"),
    },
  ];
  let thinking = "";
  return run.step(
    { role: "critic", title: run.revisions ? `Review (revision ${run.revisions})` : "Review the evidence", input: { criteria: run.plan.success_criteria, toolCalls: run.evidence.length } },
    async () => {
      const { data, reply } = await run.askJson({ phase: "critic", role: "planner", reasoning: "low", messages, maxTokens: 6000 }, CriticSchema);
      thinking = reply.reasoning;
      return data;
    },
    (critique) => ({ ...critique, ...(thinking ? { thinking: thinking.slice(0, 1200) } : {}) }),
  );
}

async function finalize(run: Run, critique: Critique): Promise<JobResult> {
  const { job } = run;
  const messages: ProviderMessage[] = [
    { role: "system", content: finalPrompt(job.kind) },
    {
      role: "user",
      content: [
        `Goal: ${job.goal}`,
        `Context: ${contextText(job)}`,
        `Success criteria:\n${run.plan.success_criteria.map((c) => `- ${c}`).join("\n")}`,
        `Executor summaries:\n${run.summaries.map((s) => `- ${s}`).join("\n")}`,
        `Tool evidence:\n${digest(run.evidence, 1800)}`,
        critique.verdict === "approve" ? "The critic approved." : `The critic still had concerns after ${MAX_REVISIONS} revisions: ${critique.issues.join("; ")}. State them under verification.`,
      ].join("\n\n"),
    },
  ];
  return run.step(
    { role: "planner", title: "Assemble the result", input: { evidence: run.evidence.length } },
    async () => (await run.askJson({ phase: "final", role: "planner", reasoning: "low", messages, maxTokens: 8000 }, ResultSchema, checkResult)).data,
    (result) => result,
  );
}

/** Plan, execute, review (revising up to MAX_REVISIONS times), then write the result. Every step goes to the sink. */
export async function runJob(job: AgentJob, deps: RunDeps): Promise<JobOutcome> {
  const run = new Run(job, deps);
  try {
    await planPhase(run);
    await deps.sink.setStatus("running");
    for (const [index, step] of run.plan.steps.entries()) await executeStep(run, step.title, step.goal, index);

    let critique = await review(run);
    while (critique.verdict === "revise" && run.revisions < MAX_REVISIONS) {
      run.revisions++;
      await deps.sink.setStatus("running");
      const fixes = critique.fixes.length ? critique.fixes : critique.issues;
      await executeStep(run, `Revision ${run.revisions}`, `Address the critic's findings: ${critique.issues.join("; ")}`, run.plan.steps.length, fixes);
      critique = await review(run);
    }

    const result = await finalize(run, critique);
    await deps.sink.setStatus("done", { result: { ...result, critique: critique.verdict, revisions: run.revisions } });
    return { plan: run.plan, result, revisions: run.revisions, critique };
  } catch (error) {
    if (error instanceof JobCancelled) {
      await deps.sink.setStatus("cancelled");
      throw error;
    }
    const message = error instanceof AiError ? error.message : error instanceof Error ? error.message : "The job failed.";
    await deps.sink.setStatus("failed", { error: message.slice(0, 500) });
    throw error;
  }
}

