import type { z } from "zod";
import type { JobSink } from "../types";

export type ToolRunContext = { sink: JobSink; signal?: AbortSignal };

export type AgentTool<I extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  /** A flat object schema: models handle shallow tool schemas best. */
  input: I;
  run(args: z.output<I>, ctx: ToolRunContext): Promise<unknown>;
};

export const defineAgentTool = <I extends z.ZodType>(tool: AgentTool<I>): AgentTool<I> => tool;
