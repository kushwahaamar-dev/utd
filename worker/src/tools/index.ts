import { z } from "zod";
import type { ToolSpec } from "@/lib/server/ai/provider";
import { benchCheck } from "./bench";
import { catalogGet, catalogSearch } from "./catalog";
import { droneCalc, droneOptimize } from "./drone";
import { datasheetSearch, partsPrice } from "./parts";
import { askPeer, highlightPart, proposeChange } from "./proposals";
import { simRun } from "./sim";
import { toolMessage } from "./clip";
import type { AgentTool, ToolRunContext } from "./types";

export const TOOLS: readonly AgentTool[] = [
  catalogSearch,
  catalogGet,
  droneCalc,
  droneOptimize,
  partsPrice,
  simRun,
  benchCheck,
  datasheetSearch,
  proposeChange,
  askPeer,
  highlightPart,
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

export const toolNamed = (name: string): AgentTool | undefined => byName.get(name);

export function toolSpecs(tools: readonly AgentTool[] = TOOLS): ToolSpec[] {
  return tools.map((tool) => {
    const { $schema, ...parameters } = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
    void $schema;
    return { name: tool.name, description: tool.description, parameters };
  });
}

export type ToolResult = { ok: boolean; message: string; value: unknown };

/** Parses the model's argument string, validates it, runs the tool, and answers in a form the model can read and recover from. */
export async function callTool(name: string, rawArgs: string, ctx: ToolRunContext): Promise<ToolResult> {
  const tool = toolNamed(name);
  if (!tool) {
    const value = { error: "unknown_tool", message: `There is no tool called ${name}. Available: ${TOOLS.map((t) => t.name).join(", ")}.` };
    return { ok: false, message: toolMessage(value), value };
  }
  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    const value = { error: "invalid_args", message: "The arguments are not valid JSON. Send a JSON object." };
    return { ok: false, message: toolMessage(value), value };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`);
    const value = { error: "invalid_args", message: `Fix these and call ${name} again.`, issues };
    return { ok: false, message: toolMessage(value), value };
  }
  try {
    const value = await tool.run(parsed.data, ctx);
    // A tool reports its own failure as { error: "<code>", message }; sim_run's `error` object is a program error, not a failure.
    const failed = typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string";
    return { ok: !failed, message: toolMessage(value), value };
  } catch (error) {
    const value = { error: "tool_failed", message: error instanceof Error ? error.message.slice(0, 300) : "The tool crashed." };
    return { ok: false, message: toolMessage(value), value };
  }
}
