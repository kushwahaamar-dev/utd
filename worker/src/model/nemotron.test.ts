import { afterEach, describe, expect, it, vi } from "vitest";

type Body = { model: string; messages: { role: string; content: string | null }[]; tools?: { function: { name: string } }[]; chat_template_kwargs: { enable_thinking: boolean }; low_effort?: boolean };

const choice = (message: Record<string, unknown>, finish = "stop") =>
  Response.json({ choices: [{ message: { role: "assistant", ...message }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

const PLAN = { steps: [{ title: "Size it", goal: "Run the calculator", tools: ["drone_calc"] }], success_criteria: ["flight time is reported"] };
const RESULT = { summary: "Done.", design: { item: "quad5" }, verification: [], bom: [], total_usd: null, within_budget: null, load_into_lab: null };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the loop over the Nemotron provider", () => {
  it("sends each role to its model, with thinking where it belongs, and carries tool calls and reasoning through", async () => {
    vi.resetModules();
    vi.stubEnv("NVIDIA_API_KEY", "nv-test");
    const bodies: Body[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Body;
        bodies.push(body);
        const system = body.messages[0].content ?? "";
        if (system.startsWith("You are the planner")) return choice({ content: JSON.stringify(PLAN), reasoning_content: "The goal needs one calculator run." });
        if (system.startsWith("You are the executor")) {
          const toolMessages = body.messages.filter((m) => m.role === "tool");
          if (toolMessages.length === 0) {
            return choice(
              { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "drone_calc", arguments: '{"drone":"quad5"}' } }] },
              "tool_calls",
            );
          }
          return choice({ content: "The quad5 flies a few minutes." });
        }
        if (system.startsWith("You are the critic")) return choice({ content: '{"verdict":"approve"}' });
        return choice({ content: JSON.stringify(RESULT) });
      }),
    );

    const { runJob } = await import("../agent/run");
    const { NemotronModel } = await import("./nemotron");
    const { MemorySink } = await import("../sinks/memory");
    const sink = new MemorySink();
    const { result } = await runJob({ id: "1", kind: "build", goal: "size a 5 inch quad", context: {} }, { model: new NemotronModel(), sink });

    expect(result.summary).toBe("Done.");
    const [plan, exec1, exec2, critic, final] = bodies;
    expect(plan.model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(plan.chat_template_kwargs.enable_thinking).toBe(true);
    expect(plan.low_effort).toBeUndefined();
    expect(exec1.model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(exec1.chat_template_kwargs.enable_thinking).toBe(false);
    expect(exec1.tools?.map((t) => t.function.name)).toContain("drone_calc");
    expect(exec2.messages.at(-1)).toMatchObject({ role: "tool" });
    expect(critic.model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(critic.low_effort).toBe(true);
    expect(final.model).toBe("nvidia/nemotron-3-super-120b-a12b");

    expect(sink.steps[0].end?.output).toMatchObject({ thinking: "The goal needs one calculator run." });
    expect(sink.steps.find((s) => s.tool === "drone_calc")).toMatchObject({ model: "nvidia/nemotron-3.5-lightning-30b-a3b" });
  });

  it("falls back from a failing self-hosted vLLM to the hosted API mid-job", async () => {
    vi.resetModules();
    vi.stubEnv("NVIDIA_API_KEY", "nv-test");
    vi.stubEnv("NEMOTRON_BASE_URL", "http://gpu.local:8000/v1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.startsWith("http://gpu.local") ? Response.json({ error: { type: "bad_request" } }, { status: 400 }) : choice({ content: "hello" });
      }),
    );
    const { NemotronModel } = await import("./nemotron");
    const reply = await new NemotronModel().complete({
      phase: "execute",
      role: "fast",
      reasoning: "minimal",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
      scope: { kind: "build", goal: "", context: {}, evidence: [], revisions: 0 },
    });
    expect(reply.text).toBe("hello");
    expect(urls).toEqual(["http://gpu.local:8000/v1/chat/completions", "https://integrate.api.nvidia.com/v1/chat/completions"]);
  });

  it("asks again with more room when thinking used up max_tokens and left no answer", async () => {
    vi.resetModules();
    vi.stubEnv("NVIDIA_API_KEY", "nv-test");
    const limits: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { max_tokens: number };
        limits.push(body.max_tokens);
        return limits.length === 1 ? choice({ content: "", reasoning_content: "hmm" }, "length") : choice({ content: "answer" });
      }),
    );
    const { NemotronModel } = await import("./nemotron");
    const reply = await new NemotronModel().complete({
      phase: "plan",
      role: "planner",
      reasoning: "high",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 500,
      scope: { kind: "build", goal: "", context: {}, evidence: [], revisions: 0 },
    });
    expect(reply.text).toBe("answer");
    expect(limits).toEqual([500, 1000]);
  });
});
