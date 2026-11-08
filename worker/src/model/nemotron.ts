import { chat } from "@/lib/server/ai/provider";
import { env } from "@/lib/server/env";
import type { ModelClient, ModelReply, ModelRequest } from "./types";

const modelName = (role: ModelRequest["role"]) => (role === "planner" ? env.NEMOTRON_PLANNER_MODEL : env.NEMOTRON_FAST_MODEL);

/** The Nemotron models through the app's provider: self-hosted vLLM first when configured, NVIDIA's hosted API after. */
export class NemotronModel implements ModelClient {
  async complete(req: ModelRequest): Promise<ModelReply> {
    const ask = (maxTokens: number) =>
      chat({
        messages: req.messages,
        tools: req.tools,
        model: req.role,
        reasoning: req.reasoning,
        maxTokens,
        signal: req.signal,
        timeoutMs: req.role === "planner" ? 180_000 : 90_000,
      });
    let result = await ask(req.maxTokens);
    // With thinking on, a small max_tokens can be spent entirely on reasoning and leave content empty.
    if (!result.text.trim() && !result.toolCalls.length && result.finishReason === "length") result = await ask(req.maxTokens * 2);
    return { text: result.text, reasoning: result.reasoning, toolCalls: result.toolCalls, model: modelName(req.role) };
  }
}
