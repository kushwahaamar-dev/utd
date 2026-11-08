import { describe, expect, test } from "vitest";
import { snapshotAt, scriptLength } from "./mock";
import { droneBuild } from "./scripts";
import type { Step } from "./types";
import { donePlanItems, formatDuration, readCritic, readPlan, readProposal, readResult, readRevision, revisionCount } from "./view";

const step = (over: Partial<Step>): Step => ({ id: "1", jobId: "1", idx: 0, role: "executor", title: "t", input: {}, output: {}, status: "ok", ms: 10, at: 0, ...over });

describe("worker shapes", () => {
  test("a plan with steps and success_criteria", () => {
    const plan = readPlan(step({ role: "planner", output: { steps: [{ title: "Size the pack", goal: "x" }], success_criteria: ["8 min"], budget: { usd: 180 } } }));
    expect(plan.items).toEqual([{ id: "Size the pack", text: "Size the pack" }]);
    expect(plan.criteria).toEqual(["8 min"]);
    expect(plan.budget).toBe(180);
  });

  test("critic issues and the revision number from the title", () => {
    const critic = readCritic(step({ role: "critic", title: "Review (revision 2)", output: { verdict: "revise", issues: ["too short"], fixes: ["bigger pack"] } }));
    expect(critic).toMatchObject({ verdict: "revise", reasons: ["too short"], fixes: ["bigger pack"], revision: 2 });
  });

  test("executor revisions and plan completion by title", () => {
    const rev = step({ title: "Revision 1", output: { summary: "s" } });
    expect(readRevision(rev)?.revision).toBe(1);
    expect(donePlanItems([step({ title: "Size the pack" })]).has("Size the pack")).toBe(true);
  });

  test("result with bom, verification and load_into_lab", () => {
    const result = readResult(
      JSON.stringify({
        summary: "ok",
        verification: [{ check: "sim", passed: true, evidence: "8.4 min" }],
        bom: [{ name: "Motor", qty: 4, unit_usd: 13.5, source: "https://www.getfpv.com/x" }, { name: "Mystery", qty: 1, unit_usd: null }],
        total_usd: 54,
        load_into_lab: { lab: "drone", itemId: "quad5", config: {} },
      }),
    );
    expect(result?.bom[0]).toMatchObject({ part: "Motor", price: 13.5, qty: 4, store: "getfpv.com" });
    expect(result?.bom[1].price).toBeUndefined();
    expect(result?.lab).toEqual({ kind: "drone", id: "quad5" });
    expect(result?.verification[0]).toMatchObject({ label: "sim", ok: true });
  });

  test("garbage never throws", () => {
    expect(readResult("not json")).toBeUndefined();
    expect(readResult({ bom: [1, null, "x"], lab: 5 })?.bom).toEqual([]);
    expect(readProposal("ask_peer", { question: "Ask Maya?" }).title).toBe("Ask Maya?");
  });

  test("durations", () => {
    expect(formatDuration(420, "en")).toBe("420 ms");
    expect(formatDuration(3200, "en")).toBe("3.2 s");
    expect(formatDuration(65_000, "en")).toBe("1:05");
  });
});

describe("recorded run", () => {
  const run = (elapsed: number) =>
    snapshotAt({ id: "demo-1", goal: "g", kind: "build", script: droneBuild, startedAt: 0, speed: 1, decisions: new Map() }, elapsed);

  test("starts planning, ends done with two revisions and a result", () => {
    expect(run(100).job?.status).toBe("planning");
    const end = run(scriptLength(droneBuild) + 1);
    expect(end.job?.status).toBe("done");
    expect(end.steps).toHaveLength(14);
    expect(revisionCount(end.steps)).toBe(2);
    expect(readResult(end.job?.result)?.bom.length).toBe(10);
  });
});
