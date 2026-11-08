import type { ProviderMessage, Reasoning, ToolCallOut, ToolSpec } from "@/lib/server/ai/provider";
import type { JobKind } from "../types";

export type { ProviderMessage, ToolCallOut, ToolSpec };

export type Phase = "plan" | "execute" | "critic" | "final";

export type PlanStep = { title: string; goal: string; tools?: string[] };

export type Plan = {
  steps: PlanStep[];
  success_criteria: string[];
  budget?: { usd: number };
  target_item?: { lab: "board" | "robotics" | "drone"; id: string };
};

export type Evidence = { tool: string; args: unknown; value: unknown; ok: boolean };

/** What the agent loop knows when it asks for a completion. Real models read only the messages; the scripted one reads this too. */
export type Scope = {
  kind: JobKind;
  goal: string;
  context: Record<string, unknown>;
  plan?: Plan;
  stepIndex?: number;
  evidence: Evidence[];
  /** Fixes the critic asked for, during a revision. */
  fixes?: string[];
  /** How many times the critic has already asked for a revision. */
  revisions: number;
};

export type ModelRequest = {
  phase: Phase;
  /** fast = lightning executor, planner = super planner and critic. */
  role: "fast" | "planner";
  reasoning: Reasoning;
  messages: ProviderMessage[];
  tools?: readonly ToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
  scope: Scope;
};

export type ModelReply = {
  text: string;
  reasoning: string;
  toolCalls: ToolCallOut[];
  model: string;
};

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelReply>;
  /** The model id a role talks to, for the trace. */
  modelName(role: ModelRequest["role"]): string;
}
