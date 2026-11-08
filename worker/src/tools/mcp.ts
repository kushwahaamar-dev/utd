import type { z } from "zod";
import { env } from "@/lib/server/env";
import { runTool, type Tool } from "@/lib/server/mcp/registry";

export const mcpContext = { siteUrl: env.NEXT_PUBLIC_SITE_URL };

/** Runs one of the app's MCP tools and turns a failure into data the model can act on. */
export async function callMcp<T extends Tool>(tool: T, args: z.input<T["input"]>): Promise<unknown> {
  const outcome = await runTool(tool, args, mcpContext);
  return outcome.ok ? outcome.data : { error: outcome.code, message: outcome.message };
}
