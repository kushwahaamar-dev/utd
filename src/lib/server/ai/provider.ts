import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/server/env";
import { withTimeout } from "@/lib/server/http";
import { parseSse } from "./sse";
import type { AiProvider } from "./types";

/**
 * The Nemotron gateway. Chat goes to an OpenAI-compatible /chat/completions:
 * first a self-hosted vLLM when NEMOTRON_BASE_URL is set, then NVIDIA's hosted
 * API when NVIDIA_API_KEY is set. Three model roles (fast, planner, vision)
 * map to env-configured model ids. Every call has a timeout and backs off on
 * 429/5xx/network errors. Errors are AiError codes; upstream detail stays in
 * the server log and never reaches the client.
 */

export const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

export type AiErrorCode =
  | "not_configured"
  | "upstream_failed"
  | "upstream_timeout"
  | "upstream_busy"
  | "bad_output"
  | "aborted";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AiError";
  }

  /** The HTTP status a route answers with for this error. */
  get status(): number {
    switch (this.code) {
      case "not_configured":
        return 503;
      case "upstream_timeout":
        return 504;
      case "aborted":
        return 499;
      default:
        return 502;
    }
  }
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type WireToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type Reasoning = "minimal" | "low" | "medium" | "high";

/** fast: lightning 30B; planner: super 120B; vision: the VL model. */
export type ModelRole = "fast" | "planner" | "vision";

export type ChatOptions = {
  messages: ProviderMessage[];
  tools?: readonly ToolSpec[];
  /** Constrains the reply to this JSON Schema (response_format json_schema). */
  json?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /** Which model answers; defaults to fast. */
  model?: ModelRole;
  /**
   * minimal or unset turns thinking off. low turns it on with the planner's
   * low_effort option, medium and high are full thinking.
   */
  reasoning?: Reasoning;
  temperature?: number;
  /** The caller's request signal, so a closed tab stops the upstream call. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** A hashed, stable end-user id; see safetyId(). */
  user?: string;
};

export type Usage = { provider: AiProvider; inTokens: number; outTokens: number; cachedTokens: number };

export type ToolCallOut = { id: string; name: string; arguments: string };

export type ChatResult = {
  text: string;
  /** The model's chain of thought (message.reasoning_content), when it sent one. */
  reasoning: string;
  toolCalls: ToolCallOut[];
  finishReason: string;
  usage: Usage;
};

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCallOut }
  | { type: "done"; finishReason: string; usage: Usage };

type Target = { provider: AiProvider; base: string; key: string; model: string; selfHosted: boolean };

function modelFor(role: ModelRole | undefined): string {
  if (role === "planner") return env.NEMOTRON_PLANNER_MODEL;
  if (role === "vision") return env.NEMOTRON_VISION_MODEL;
  return env.NEMOTRON_FAST_MODEL;
}

function chatTargets(role: ModelRole | undefined): Target[] {
  const out: Target[] = [];
  const model = modelFor(role);
  if (env.NEMOTRON_BASE_URL) {
    out.push({ provider: "nemotron", base: env.NEMOTRON_BASE_URL, key: env.NVIDIA_API_KEY ?? "EMPTY", model, selfHosted: true });
  }
  if (env.NVIDIA_API_KEY) out.push({ provider: "nemotron", base: NVIDIA_BASE, key: env.NVIDIA_API_KEY, model, selfHosted: false });
  return out;
}

/** A privacy-preserving end-user id for the upstream `user` field: a salted hash, never the raw value. */
export function safetyId(value: string): string {
  return createHash("sha256").update(`iynk:${value}`).digest("hex").slice(0, 32);
}

function log(provider: string, what: string) {
  console.warn(`[ai] ${provider}: ${what}`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AiError("aborted"));
      },
      { once: true },
    );
  });
}

const MAX_RETRIES = 2;

function retryDelay(attempt: number, res?: Response): number {
  const after = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(after) && after > 0 && after <= 20) return after * 1000;
  return Math.min(250 * 2 ** attempt, 4000) + Math.random() * 250;
}

/** Reads a short, safe description of an upstream error body for the server log. */
async function upstreamDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { type?: unknown; code?: unknown; param?: unknown } };
    const e = body.error ?? {};
    return [res.status, e.type, e.code, e.param && `param=${String(e.param)}`].filter(Boolean).join(" ");
  } catch {
    return String(res.status);
  }
}

function toAiError(error: unknown, signal?: AbortSignal): AiError {
  if (error instanceof AiError) return error;
  if (signal?.aborted) return new AiError("aborted");
  if (error instanceof Error && error.name === "TimeoutError") return new AiError("upstream_timeout");
  return new AiError("upstream_failed", error instanceof Error ? error.name : "unknown");
}

/**
 * POSTs to an upstream endpoint with a timeout, retrying with backoff on 429, 5xx and
 * network errors (the free tier is rate limited). Resolves with the OK response, whose body the caller reads
 * under the same timeout.
 */
export async function upstream(
  provider: string,
  url: string,
  init: { key: string; body: BodyInit; contentType?: string; accept?: string; signal?: AbortSignal; timeoutMs: number },
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const signal = withTimeout(init.timeoutMs, init.signal);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${init.key}`,
          ...(init.contentType ? { "content-type": init.contentType } : {}),
          accept: init.accept ?? "application/json",
        },
        body: init.body,
        signal,
      });
    } catch (error) {
      const e = toAiError(error, init.signal);
      if (e.code === "upstream_failed" && attempt < MAX_RETRIES) {
        log(provider, `network error (${e.detail}), retrying`);
        await sleep(retryDelay(attempt), init.signal);
        continue;
      }
      throw e;
    }
    if (res.ok) return res;
    const detail = await upstreamDetail(res);
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      log(provider, `${detail}, retrying`);
      await sleep(retryDelay(attempt, res), init.signal);
      continue;
    }
    log(provider, detail);
    throw new AiError(res.status === 429 ? "upstream_busy" : "upstream_failed", detail);
  }
}

function requestBody(target: Target, opts: ChatOptions, stream: boolean): Record<string, unknown> {
  const thinking = opts.reasoning === "low" || opts.reasoning === "medium" || opts.reasoning === "high";
  const body: Record<string, unknown> = {
    model: target.model,
    messages: opts.messages,
    temperature: opts.temperature ?? (opts.model === "vision" ? 0.6 : 1),
    top_p: opts.model === "vision" ? 0.6 : 0.95,
    chat_template_kwargs: { enable_thinking: thinking },
  };
  if (thinking && opts.reasoning === "low" && opts.model === "planner") body.low_effort = true;
  if (opts.tools?.length) {
    body.tools = opts.tools.map((tool) => ({ type: "function", function: tool }));
    body.parallel_tool_calls = false;
  }
  if (opts.json) body.response_format = { type: "json_schema", json_schema: opts.json };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.user) body.user = opts.user;
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

type WireUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
};

function usageOf(provider: AiProvider, usage: WireUsage | null | undefined): Usage {
  return {
    provider,
    inTokens: usage?.prompt_tokens ?? 0,
    outTokens: usage?.completion_tokens ?? 0,
    cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

type WireToolCallChunk = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: unknown };
};

/**
 * Assembles streamed tool calls. Fragments of one call share its `index`;
 * parallel calls arrive under different indexes, in any interleaving.
 */
export class ToolCallAssembler {
  private calls = new Map<number, { id: string; name: string; arguments: string }>();

  add(chunks: WireToolCallChunk[]): void {
    chunks.forEach((chunk, position) => {
      // Some compatible APIs omit `index` and send each call whole.
      let index = typeof chunk.index === "number" ? chunk.index : position;
      if (typeof chunk.index !== "number" && chunk.id) {
        const existing = [...this.calls.entries()].find(([, call]) => call.id === chunk.id);
        index = existing ? existing[0] : this.calls.size;
      }
      const call = this.calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (chunk.id) call.id = chunk.id;
      if (chunk.function?.name) call.name = chunk.function.name;
      const args = chunk.function?.arguments;
      if (typeof args === "string") call.arguments += args;
      else if (args && typeof args === "object") call.arguments = JSON.stringify(args);
      this.calls.set(index, call);
    });
  }

  done(): ToolCallOut[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
      .filter((call) => call.name);
  }
}

type WireChoice = {
  delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: WireToolCallChunk[] };
  message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: WireToolCallChunk[] };
  finish_reason?: string | null;
};

type WireChunk = { choices?: WireChoice[]; usage?: WireUsage | null; error?: { type?: string; code?: string } };

async function* streamOnce(target: Target, opts: ChatOptions): AsyncGenerator<StreamEvent> {
  const res = await upstream(target.provider, `${target.base}/chat/completions`, {
    key: target.key,
    body: JSON.stringify(requestBody(target, opts, true)),
    contentType: "application/json",
    accept: "text/event-stream",
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? 90_000,
  });
  if (!res.body) throw new AiError("upstream_failed", "empty body");
  const calls = new ToolCallAssembler();
  let usage: WireUsage | null | undefined;
  let finishReason = "stop";
  try {
    for await (const { data } of parseSse(res.body)) {
      if (data === "[DONE]") break;
      let chunk: WireChunk;
      try {
        chunk = JSON.parse(data) as WireChunk;
      } catch {
        log(target.provider, "skipped a malformed stream chunk");
        continue;
      }
      if (chunk.error) {
        throw new AiError("upstream_failed", `stream error ${chunk.error.type ?? ""} ${chunk.error.code ?? ""}`.trim());
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? choice.message;
      if (delta?.content) yield { type: "text", delta: delta.content };
      if (delta?.tool_calls?.length) calls.add(delta.tool_calls);
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  } catch (error) {
    throw toAiError(error, opts.signal);
  }
  for (const call of calls.done()) yield { type: "tool_call", call };
  yield { type: "done", finishReason, usage: usageOf(target.provider, usage) };
}

async function completeOnce(target: Target, opts: ChatOptions): Promise<ChatResult> {
  const res = await upstream(target.provider, `${target.base}/chat/completions`, {
    key: target.key,
    body: JSON.stringify(requestBody(target, opts, false)),
    contentType: "application/json",
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? 60_000,
  });
  let body: { choices?: WireChoice[]; usage?: WireUsage };
  try {
    body = await res.json();
  } catch (error) {
    throw toAiError(error, opts.signal);
  }
  const choice = body.choices?.[0];
  if (!choice?.message) throw new AiError("upstream_failed", "no choices");
  const calls = new ToolCallAssembler();
  if (choice.message.tool_calls) calls.add(choice.message.tool_calls);
  return {
    text: choice.message.content ?? "",
    reasoning: choice.message.reasoning_content ?? "",
    toolCalls: calls.done(),
    finishReason: choice.finish_reason ?? "stop",
    usage: usageOf(target.provider, body.usage),
  };
}

/** Streams a chat completion; falls back to the next target only before anything was sent on. */
async function* streamChat(opts: ChatOptions): AsyncGenerator<StreamEvent> {
  const targets = chatTargets(opts.model);
  if (!targets.length) throw new AiError("not_configured");
  for (const [i, target] of targets.entries()) {
    let started = false;
    try {
      for await (const event of streamOnce(target, opts)) {
        started = true;
        yield event;
      }
      return;
    } catch (error) {
      const e = toAiError(error, opts.signal);
      if (started || e.code === "aborted" || i === targets.length - 1) throw e;
      log(target.provider, `${target.selfHosted ? "self-hosted" : "hosted"} failed (${e.code}), falling back to the hosted API`);
    }
  }
}

async function completeChat(opts: ChatOptions): Promise<ChatResult> {
  const targets = chatTargets(opts.model);
  if (!targets.length) throw new AiError("not_configured");
  for (const [i, target] of targets.entries()) {
    try {
      return await completeOnce(target, opts);
    } catch (error) {
      const e = toAiError(error, opts.signal);
      if (e.code === "aborted" || i === targets.length - 1) throw e;
      log(target.provider, `${target.selfHosted ? "self-hosted" : "hosted"} failed (${e.code}), falling back to the hosted API`);
    }
  }
  throw new AiError("not_configured");
}

export function chat(opts: ChatOptions & { stream: true }): AsyncGenerator<StreamEvent>;
export function chat(opts: ChatOptions & { stream?: false }): Promise<ChatResult>;
export function chat(opts: ChatOptions & { stream?: boolean }): AsyncGenerator<StreamEvent> | Promise<ChatResult> {
  return opts.stream ? streamChat(opts) : completeChat(opts);
}

/** JSON Schema for response_format, from a zod schema. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void $schema;
  return rest;
}

/** The JSON object inside a reply that may carry a code fence or a sentence around it. */
function jsonText(text: string): string {
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  return first >= 0 && last > first ? body.slice(first, last + 1) : body;
}

/**
 * A chat whose reply must be JSON matching `schema`. The API constrains
 * decoding to the schema when it takes response_format; if it refuses that,
 * the schema goes in the prompt instead. The reply is validated either way.
 */
export async function chatJson<S extends z.ZodType>(
  schema: S,
  name: string,
  opts: Omit<ChatOptions, "json" | "tools">,
): Promise<{ data: z.output<S>; usage: Usage }> {
  const jsonSpec = jsonSchemaOf(schema);
  let result: ChatResult;
  try {
    result = await completeChat({ ...opts, json: { name, schema: jsonSpec } });
  } catch (error) {
    if (!(error instanceof AiError) || error.code !== "upstream_failed") throw error;
    log("nemotron", `${name}: response_format refused, putting the schema in the prompt`);
    const ask = `Reply with only a JSON object that matches this JSON Schema, with no other text:\n${JSON.stringify(jsonSpec)}`;
    result = await completeChat({ ...opts, messages: [...opts.messages, { role: "user", content: ask }] });
  }
  let value: unknown;
  try {
    value = JSON.parse(jsonText(result.text));
  } catch {
    throw new AiError("bad_output", `${name}: reply is not JSON`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AiError("bad_output", `${name}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return { data: parsed.data, usage: result.usage };
}
