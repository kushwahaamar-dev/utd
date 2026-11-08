// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiError, completion, delta, fakeFetch, sse, sseOf, usageChunk } from "./__test__/upstream";

async function load(vars: Record<string, string> = { NVIDIA_API_KEY: "nv-key" }) {
  vi.resetModules();
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return import("./provider");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function drain<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of events) out.push(e);
  return out;
}

const messages = [{ role: "user" as const, content: "Why won't my LED light?" }];

describe("chat streaming", () => {
  it("streams text deltas and reports usage from the final chunk", async () => {
    const { calls } = fakeFetch(sseOf([delta({ role: "assistant", content: "Check " }), delta({ content: "the polarity." }, "stop"), usageChunk(42, 7)]));
    const { chat } = await load();
    const events = await drain(chat({ messages, stream: true, maxTokens: 500, user: "u" }));
    expect(events).toEqual([
      { type: "text", delta: "Check " },
      { type: "text", delta: "the polarity." },
      { type: "done", finishReason: "stop", usage: { provider: "nemotron", inTokens: 42, outTokens: 7, cachedTokens: 0 } },
    ]);
    expect(calls[0].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer nv-key");
    expect(calls[0].body).toMatchObject({
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 500,
      user: "u",
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("assembles parallel tool calls whose fragments interleave across chunks", async () => {
    fakeFetch(
      sse([
        `data: ${JSON.stringify(delta({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "highlight_part", arguments: "" } }] }))}\n\n`,
        `data: ${JSON.stringify(delta({ tool_calls: [{ index: 0, function: { arguments: '{"partId":' } }] }))}\n\n`,
        `data: ${JSON.stringify(delta({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "search_datasheet", arguments: '{"que' } }] }))}\n`,
        `\ndata: ${JSON.stringify(delta({ tool_calls: [{ index: 0, function: { arguments: '"led1"}' } }] }))}\n\n`,
        `data: ${JSON.stringify(delta({ tool_calls: [{ index: 1, function: { arguments: 'ry":"LED forward voltage"}' } }] }, "tool_calls"))}\n\n`,
        "data: [DONE]\n\n",
      ]),
    );
    const { chat } = await load();
    const events = await drain(chat({ messages, stream: true }));
    expect(events.filter((e) => e.type === "tool_call")).toEqual([
      { type: "tool_call", call: { id: "call_a", name: "highlight_part", arguments: '{"partId":"led1"}' } },
      { type: "tool_call", call: { id: "call_b", name: "search_datasheet", arguments: '{"query":"LED forward voltage"}' } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "tool_calls" });
  });

  it("accepts whole tool calls without an index, as some compatible APIs send them", async () => {
    fakeFetch(
      sseOf([
        delta({ tool_calls: [{ id: "x1", function: { name: "open_panel", arguments: { tab: "real" } } }] }),
        delta({ tool_calls: [{ id: "x2", function: { name: "open_panel", arguments: '{"tab":"together"}' } }] }, "tool_calls"),
      ]),
    );
    const { chat } = await load();
    const calls = (await drain(chat({ messages, stream: true }))).filter((e) => e.type === "tool_call");
    expect(calls.map((e) => e.type === "tool_call" && e.call)).toEqual([
      { id: "x1", name: "open_panel", arguments: '{"tab":"real"}' },
      { id: "x2", name: "open_panel", arguments: '{"tab":"together"}' },
    ]);
  });

  it("turns an error chunk mid-stream into an AiError", async () => {
    fakeFetch(sse([`data: ${JSON.stringify(delta({ content: "Hi" }))}\n\n`, 'data: {"error":{"type":"server_error","code":"server_shutting_down"}}\n\n']));
    const { chat, AiError } = await load();
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const e of chat({ messages, stream: true })) seen.push(e);
      })(),
    ).rejects.toBeInstanceOf(AiError);
    expect(seen).toEqual([{ type: "text", delta: "Hi" }]);
  });

  it("retries on a 5xx, then succeeds", async () => {
    const { calls } = fakeFetch(apiError(503), sseOf([delta({ content: "ok" }, "stop")]));
    const { chat } = await load();
    const events = await drain(chat({ messages, stream: true }));
    expect(calls).toHaveLength(2);
    expect(events[0]).toEqual({ type: "text", delta: "ok" });
  });

  it("does not retry a 400 and never leaks the upstream message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = fakeFetch(apiError(400, "invalid_request_error"));
    const { chat, AiError } = await load();
    const error = await drain(chat({ messages, stream: true })).catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(AiError);
    expect((error as InstanceType<typeof AiError>).code).toBe("upstream_failed");
    expect((error as Error).message).not.toContain("nope");
  });

  it("reports a 429 that persists through the retries as upstream_busy", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = fakeFetch(apiError(429, "rate_limit_error"), apiError(429, "rate_limit_error"), apiError(429, "rate_limit_error"));
    const { chat } = await load();
    const error = await drain(chat({ messages, stream: true })).catch((e: { code: string }) => e);
    expect(error).toMatchObject({ code: "upstream_busy", status: 502 });
    expect(calls).toHaveLength(3);
  }, 10_000);

  it("tries the self-hosted vLLM first and falls back to the hosted API when it fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = fakeFetch(apiError(400), sseOf([delta({ content: "hola" }, "stop"), usageChunk(3, 1)]));
    const { chat } = await load({ NVIDIA_API_KEY: "nv", NEMOTRON_BASE_URL: "http://gpu.example:8000/v1/" });
    const events = await drain(chat({ messages, stream: true, model: "planner" }));
    expect(calls[0].url).toBe("http://gpu.example:8000/v1/chat/completions");
    expect(calls[1].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(calls[1].body).toMatchObject({ model: "nvidia/nemotron-3-super-120b-a12b" });
    expect(events.at(-1)).toMatchObject({ type: "done", usage: { provider: "nemotron", inTokens: 3, outTokens: 1 } });
  });

  it("uses only the self-hosted endpoint when no hosted key is set", async () => {
    const { calls } = fakeFetch(completion("ok"));
    const { chat } = await load({ NEMOTRON_BASE_URL: "http://gpu.example:8000/v1" });
    await chat({ messages });
    expect(calls[0].url).toBe("http://gpu.example:8000/v1/chat/completions");
  });

  it("refuses with not_configured when no key is set", async () => {
    const { mock } = fakeFetch();
    const { chat } = await load({});
    await expect(chat({ messages })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    await expect(drain(chat({ messages, stream: true }))).rejects.toMatchObject({ code: "not_configured" });
    expect(mock).not.toHaveBeenCalled();
  });

  it("times out a call that never answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      ),
    );
    const { chat } = await load();
    await expect(chat({ messages, timeoutMs: 20 })).rejects.toMatchObject({ code: "upstream_timeout", status: 504 });
  });

  it("stops when the caller goes away, without retrying", async () => {
    const controller = new AbortController();
    const mock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    vi.stubGlobal("fetch", mock);
    const { chat } = await load();
    const pending = chat({ messages, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("chat (non-streaming) and chatJson", () => {
  it("returns text, tool calls and usage", async () => {
    fakeFetch(
      Response.json({
        choices: [
          {
            message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "find_parts", arguments: '{"parts":["SG90"]}' } }] },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 8 } },
      }),
    );
    const { chat } = await load();
    expect(await chat({ messages })).toEqual({
      text: "",
      reasoning: "",
      toolCalls: [{ id: "c1", name: "find_parts", arguments: '{"parts":["SG90"]}' }],
      finishReason: "tool_calls",
      usage: { provider: "nemotron", inTokens: 9, outTokens: 4, cachedTokens: 8 },
    });
  });

  it("turns thinking on for the planner and reads reasoning_content", async () => {
    const { calls } = fakeFetch(
      Response.json({
        choices: [{ message: { role: "assistant", content: "", reasoning_content: "thinking it through" }, finish_reason: "length" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    const { chat } = await load();
    const result = await chat({ messages, model: "planner", reasoning: "low" });
    expect(result).toMatchObject({ text: "", reasoning: "thinking it through" });
    expect(calls[0].body).toMatchObject({
      model: "nvidia/nemotron-3-super-120b-a12b",
      chat_template_kwargs: { enable_thinking: true },
      low_effort: true,
    });
  });

  it("asks for a JSON schema and validates the reply", async () => {
    const { calls } = fakeFetch(completion('{"answer":"42"}'));
    const { chatJson } = await load();
    const { data } = await chatJson(z.object({ answer: z.string() }), "probe", { messages, reasoning: "low" });
    expect(data).toEqual({ answer: "42" });
    expect(calls[0].body).toMatchObject({
      response_format: { type: "json_schema", json_schema: { name: "probe", schema: { type: "object" } } },
    });
    expect(JSON.stringify(calls[0].body)).not.toContain("$schema");
  });

  it("puts the schema in the prompt when the API refuses response_format", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls } = fakeFetch(apiError(400, "invalid_request_error"), completion('Here it is: {"answer":"42"}'));
    const { chatJson } = await load();
    const { data } = await chatJson(z.object({ answer: z.string() }), "probe", { messages });
    expect(data).toEqual({ answer: "42" });
    expect(calls[0].body).toHaveProperty("response_format");
    expect(calls[1].body).not.toHaveProperty("response_format");
    expect(JSON.stringify(calls[1].body)).toContain("JSON Schema");
  });

  it("rejects a reply that is not the asked-for JSON", async () => {
    fakeFetch(completion("Sure! Here you go."), completion('{"answer":3}'));
    const { chatJson } = await load();
    const schema = z.object({ answer: z.string() });
    await expect(chatJson(schema, "probe", { messages })).rejects.toMatchObject({ code: "bad_output" });
    await expect(chatJson(schema, "probe", { messages })).rejects.toMatchObject({ code: "bad_output" });
  });
});
