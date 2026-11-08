import { z } from "zod";
import { findEntry } from "@/lib/server/mcp/content";
import type { Plan } from "../model/types";

const lab = z.enum(["board", "robotics", "drone"]);

export const PlanSchema = z.object({
  steps: z
    .array(z.object({ title: z.string().min(3).max(120), goal: z.string().min(3).max(600), tools: z.array(z.string()).nullish() }))
    .min(1)
    .max(8),
  success_criteria: z.array(z.string().min(3).max(300)).min(1).max(10),
  budget: z.union([z.number().transform((usd) => ({ usd })), z.object({ usd: z.number() })]).nullish(),
  target_item: z.object({ lab, id: z.string() }).nullish(),
});

export function toPlan(data: z.output<typeof PlanSchema>): Plan {
  return {
    steps: data.steps.map((s) => ({ title: s.title, goal: s.goal, ...(s.tools?.length ? { tools: s.tools } : {}) })),
    success_criteria: data.success_criteria,
    ...(data.budget ? { budget: data.budget } : {}),
    ...(data.target_item ? { target_item: data.target_item } : {}),
  };
}

export const CriticSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  issues: z.array(z.string()).default([]),
  fixes: z.array(z.string()).default([]),
});

export type Critique = z.output<typeof CriticSchema>;

const money = z.number().nullish().transform((n) => n ?? null);

export const ResultSchema = z.object({
  summary: z.string().min(3).max(1500),
  design: z.record(z.string(), z.unknown()),
  verification: z
    .array(
      z.union([
        z.string().transform((evidence) => ({ check: evidence, passed: true, evidence })),
        z.object({
          check: z.string(),
          tool: z.string().nullish(),
          passed: z.boolean(),
          evidence: z.string().nullish().transform((e) => e ?? ""),
        }),
      ]),
    )
    .default([]),
  bom: z
    .array(z.object({ name: z.string(), qty: z.number().default(1), unit_usd: money, source: z.string().nullish() }))
    .default([]),
  total_usd: money,
  within_budget: z.boolean().nullish().transform((b) => b ?? null),
  load_into_lab: z
    .object({ lab, itemId: z.string(), config: z.record(z.string(), z.unknown()).default({}) })
    .nullish()
    .transform((l) => l ?? null),
  roles: z.array(z.object({ name: z.string(), role: z.string(), firstTask: z.string() })).optional(),
  matches: z.array(z.object({ id: z.string(), why: z.string(), suggestedProject: z.string().nullish() })).optional(),
});

export type JobResult = z.output<typeof ResultSchema>;

/** Semantic checks a schema cannot express; a problem is sent back to the model to fix. */
export function checkResult(result: JobResult): string | null {
  const target = result.load_into_lab;
  if (target && !findEntry(target.lab, target.itemId)) return `load_into_lab: iynk has no ${target.lab} called "${target.itemId}"; use an id from catalog_search or null.`;
  return null;
}
