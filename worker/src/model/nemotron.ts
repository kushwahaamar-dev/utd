import { AiError, chat } from "@/lib/server/ai/provider";
import { env } from "@/lib/server/env";
import { RateGate } from "./gate";
import type { ModelClient, ModelReply, ModelRequest } from "./types";

const modelName = (role: ModelRequest["role"]) => (role === "planner" ? env.NEMOTRON_PLANNER_MODEL : env.NEMOTRON_FAST_MODEL);

const BUSY_WAITS_MS = [5_000, 10_000, 20_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The Nemotron models through the app's provider: self-hosted vLLM first when configured, NVIDIA's hosted API after.
 * Calls are spaced to NEMOTRON_RPM (default 30) when only the hosted API is in play, and a "busy" answer is waited out.
 */
export class NemotronModel implements ModelClient {
  private readonly gate = new RateGate(env.NEMOTRON_BASE_URL ? 0 : Number(process.env.NEMOTRON_RPM ?? 30));

  async complete(req: ModelRequest): Promise<ModelReply> {
    const ask = async (maxTokens: number) => {
      for (let attempt = 0; ; attempt++) {
        await this.gate.wait();
        try {
          return await send(maxTokens);
        } catch (error) {
          if (!(error instanceof AiError) || error.code !== "upstream_busy" || attempt >= BUSY_WAITS_MS.length) throw error;
          await sleep(BUSY_WAITS_MS[attempt]);
        }
      }
    };
    const send = (maxTokens: number) =>
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
