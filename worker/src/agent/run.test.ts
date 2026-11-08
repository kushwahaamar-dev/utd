import { describe, expect, it } from "vitest";
import { FakeModel } from "../model/fake";
import type { ModelClient, ModelReply, ModelRequest } from "../model/types";
import { MemorySink } from "../sinks/memory";
import type { AgentJob } from "../types";
import { JobCancelled, MAX_REVISIONS, runJob } from "./run";

const job = (over: Partial<AgentJob>): AgentJob => ({ id: "j1", kind: "build", goal: "", context: {}, ...over });

describe("build job with the scripted model", () => {
  it("plans, runs tools, gets pushed back by the critic, and returns a verified result", async () => {
    const goal = "5-inch drone, 8 minutes flight, under $500";
    const sink = new MemorySink();
    const { result, revisions } = await runJob(job({ goal }), { model: new FakeModel(), sink });

    expect(sink.statuses).toEqual(["planning", "running", "reviewing", "running", "reviewing", "done"]);
    expect(revisions).toBe(1);
    expect(sink.steps.every((s) => s.end)).toBe(true);

    const roles = sink.steps.map((s) => s.role);
    expect(roles[0]).toBe("planner");
    expect(roles.filter((r) => r === "critic")).toHaveLength(2);
    const tools = sink.steps.filter((s) => s.role === "tool").map((s) => s.tool);
    expect(tools).toEqual(expect.arrayContaining(["catalog_search", "drone_optimize", "drone_calc", "parts_price"]));
    expect(sink.steps.find((s) => s.tool === "parts_price")?.end?.status).toBe("error");

    expect(result.within_budget).toBe(true);
    expect(result.total_usd).toBeLessThanOrEqual(500);
    expect(result.verification.every((v) => v.passed)).toBe(true);
    expect(result.load_into_lab).toMatchObject({ lab: "drone", itemId: "quad5" });
    expect(sink.status).toBe("done");
    expect(sink.result).toMatchObject({ summary: result.summary, critique: "approve", revisions: 1 });
  });

  it("reports an impossible budget honestly and finds the nearest feasible build", async () => {
    const sink = new MemorySink();
    const { result } = await runJob(job({ goal: "5-inch drone, 8 minutes flight, under $180" }), { model: new FakeModel(), sink });
    expect(result.within_budget).toBe(false);
    expect(result.total_usd).toBeGreaterThan(180);
    expect(result.summary).toContain("nearest feasible");
    expect(result.verification.find((v) => v.check.includes("180"))?.passed).toBe(false);
  });

  it("skips the critic's complaint when the plan already verified the pick", async () => {
    const sink = new MemorySink();
    const { revisions } = await runJob(job({ goal: "5-inch drone, 7 minutes flight, under $500" }), { model: new FakeModel({ skipVerification: false }), sink });
    expect(revisions).toBe(0);
    expect(sink.statuses).toEqual(["planning", "running", "reviewing", "done"]);
  });
});

describe("diagnose job", () => {
  it("finds the active fault, proposes the fix and points at the part", async () => {
    const sink = new MemorySink();
    const { result } = await runJob(
      job({
        kind: "diagnose",
        goal: "My LED trainer is dark, find out why",
        context: { lab: "robotics", itemId: "led-resistor", faults: ["led-backwards"], symptom: "LED stays dark" },
      }),
      { model: new FakeModel(), sink },
    );
    expect(result.design.root_cause).toBe("led-backwards");
    expect(sink.proposals.map((p) => p.kind)).toEqual(["propose_change", "highlight_part"]);
    expect(result.verification.every((v) => v.passed)).toBe(true);
  });

  it("runs the user's code in the simulator when it is given", async () => {
    const sink = new MemorySink();
    await runJob(
      job({
        kind: "diagnose",
        goal: "LED never blinks",
        context: { itemId: "led-resistor", faults: [], symptom: "LED never blinks", board: "uno-r3", language: "arduino-cpp", code: "void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); }" },
      }),
      { model: new FakeModel(), sink },
    );
    expect(sink.steps.some((s) => s.tool === "sim_run" && s.end?.status === "ok")).toBe(true);
  });
});

describe("plan and match jobs", () => {
  it("plan names a role for each person", async () => {
    const sink = new MemorySink();
    const { result } = await runJob(
      job({ kind: "plan", goal: "plan a drone night", context: { participants: [{ name: "Ana", wants: "fly a drone" }, { name: "Raj", wants: "learn to solder" }] } }),
      { model: new FakeModel(), sink },
    );
    expect(result.roles?.map((r) => r.name)).toEqual(["Ana", "Raj"]);
    expect(result.load_into_lab?.itemId).toBeTruthy();
  });

  it("match lists each candidate with a reason", async () => {
    const { result } = await runJob(job({ kind: "match", goal: "find me a build buddy", context: { interests: ["drones"], pool: [{ id: "u1" }, { id: "u2" }] } }), {
      model: new FakeModel(),
      sink: new MemorySink(),
    });
    expect(result.matches?.map((m) => m.id)).toEqual(["u1", "u2"]);
  });
});

/** A model whose replies come from a script, for the paths the scripted Nemotron stand-in does not take. */
class ScriptedModel implements ModelClient {
  readonly seen: ModelRequest[] = [];
  constructor(private readonly respond: (req: ModelRequest, n: number) => Partial<ModelReply> | string) {}
  async complete(req: ModelRequest): Promise<ModelReply> {
    this.seen.push(req);
    const r = this.respond(req, this.seen.length);
    const base = { text: "", reasoning: "", toolCalls: [], model: "scripted" };
    return typeof r === "string" ? { ...base, text: r } : { ...base, ...r };
  }
}

const PLAN = JSON.stringify({ steps: [{ title: "Look", goal: "Look around", tools: ["catalog_search"] }], success_criteria: ["something is found"] });
const RESULT = JSON.stringify({ summary: "Found it.", design: {}, verification: [], bom: [], total_usd: null, within_budget: null, load_into_lab: null });

describe("critic revise path", () => {
  it("stops asking for revisions after the cap and finishes with the critic's caveat", async () => {
    const model = new ScriptedModel((req) => {
      if (req.phase === "plan") return PLAN;
      if (req.phase === "critic") return JSON.stringify({ verdict: "revise", issues: ["still not convinced"], fixes: ["look again"] });
      if (req.phase === "final") return RESULT;
      return "looked";
    });
    const sink = new MemorySink();
    const outcome = await runJob(job({ goal: "anything" }), { model, sink });
    expect(outcome.revisions).toBe(MAX_REVISIONS);
    expect(sink.steps.filter((s) => s.role === "critic")).toHaveLength(MAX_REVISIONS + 1);
    const final = model.seen.find((r) => r.phase === "final");
    expect(final?.messages.at(-1)?.content).toContain("still had concerns");
    expect(sink.status).toBe("done");
  });

  it("hands the critic's fixes to the executor on revision", async () => {
    let reviewed = 0;
    const model = new ScriptedModel((req) => {
      if (req.phase === "plan") return PLAN;
      if (req.phase === "critic") return JSON.stringify(reviewed++ === 0 ? { verdict: "revise", issues: ["no proof"], fixes: ["call drone_calc for quad5"] } : { verdict: "approve" });
      if (req.phase === "final") return RESULT;
      return "done";
    });
    await runJob(job({ goal: "anything" }), { model, sink: new MemorySink() });
    const revision = model.seen.filter((r) => r.phase === "execute").at(-1);
    expect(revision?.messages[1].content).toContain("call drone_calc for quad5");
  });
});

describe("executor and parsing robustness", () => {
  it("lets the model fix a bad tool call and carries on", async () => {
    const model = new ScriptedModel((req) => {
      if (req.phase === "plan") return PLAN;
      if (req.phase === "critic") return JSON.stringify({ verdict: "approve" });
      if (req.phase === "final") return RESULT;
      const toolReplies = req.messages.filter((m) => m.role === "tool");
      if (toolReplies.length === 0) return { toolCalls: [{ id: "a", name: "drone_calc", arguments: '{"drone":"ufo"}' }] };
      if (toolReplies.length === 1) return { toolCalls: [{ id: "b", name: "drone_calc", arguments: '{"drone":"quad5"}' }] };
      return "calculated";
    });
    const sink = new MemorySink();
    await runJob(job({ goal: "x" }), { model, sink });
    const calls = sink.steps.filter((s) => s.tool === "drone_calc");
    expect(calls.map((c) => c.end?.status)).toEqual(["error", "ok"]);
    expect(JSON.stringify(calls[0].end?.output)).toContain("invalid_args");
  });

  it("asks again when the plan is not JSON, then accepts the corrected one", async () => {
    let tries = 0;
    const model = new ScriptedModel((req) => {
      if (req.phase === "plan") return tries++ === 0 ? "Sure! I will think about it." : `Here you go:\n\`\`\`json\n${PLAN}\n\`\`\``;
      if (req.phase === "critic") return JSON.stringify({ verdict: "approve" });
      if (req.phase === "final") return RESULT;
      return "ok";
    });
    await runJob(job({ goal: "x" }), { model, sink: new MemorySink() });
    expect(tries).toBe(2);
  });

  it("rejects a result that points at an item iynk does not have, and the model corrects it", async () => {
    const bad = JSON.stringify({ summary: "Open it.", design: {}, load_into_lab: { lab: "drone", itemId: "ufo", config: {} } });
    let finals = 0;
    const model = new ScriptedModel((req) => {
      if (req.phase === "plan") return PLAN;
      if (req.phase === "critic") return JSON.stringify({ verdict: "approve" });
      if (req.phase === "final") return finals++ === 0 ? bad : RESULT;
      return "ok";
    });
    const { result } = await runJob(job({ goal: "x" }), { model, sink: new MemorySink() });
    expect(finals).toBe(2);
    expect(result.load_into_lab).toBeNull();
  });

  it("fails the job with the error when the model gives up", async () => {
    const sink = new MemorySink();
    await expect(runJob(job({ goal: "x" }), { model: new ScriptedModel(() => "no json at all"), sink })).rejects.toThrow(/bad_output/);
    expect(sink.status).toBe("failed");
    expect(sink.error).toContain("plan");
  });
});

describe("cancellation", () => {
  it("stops between model calls once a human cancels", async () => {
    const sink = new MemorySink();
    const model = new ScriptedModel((req) => {
      if (req.phase === "plan") {
        sink.cancel();
        return PLAN;
      }
      return "x";
    });
    await expect(runJob(job({ goal: "x" }), { model, sink })).rejects.toBeInstanceOf(JobCancelled);
    expect(sink.status).toBe("cancelled");
    expect(model.seen.some((r) => r.phase === "execute")).toBe(false);
  });
});
