import type { Evidence, ModelClient, ModelReply, ModelRequest, Plan, Scope } from "./types";

type Obj = Record<string, unknown>;

const FAKE_MODEL = "scripted-nemotron";

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const lastOk = (evidence: readonly Evidence[], tool: string): Obj | null => {
  for (let i = evidence.length - 1; i >= 0; i--) if (evidence[i].tool === tool && evidence[i].ok) return obj(evidence[i].value);
  return null;
};

const DRONE_WORDS: [RegExp, string][] = [
  [/cine\s*whoop/i, "cinewhoop"],
  [/whoop/i, "whoop"],
  [/long[\s-]*range/i, "longrange"],
  [/rac(e|ing)/i, "racer"],
  [/agri|spray|hex/i, "agrihex"],
  [/vtol/i, "vtol"],
  [/wing|plane/i, "wing"],
  [/swarm|nano/i, "swarm"],
  [/tri(copter)?\b/i, "tricopter"],
  [/octo|heavy/i, "octo"],
  [/deliver/i, "delivery"],
  [/gps/i, "gpscam"],
];

export function parseBuildGoal(goal: string) {
  const drone = DRONE_WORDS.find(([re]) => re.test(goal))?.[1] ?? "quad5";
  const budget = Number(/\$\s?(\d+(?:\.\d+)?)/.exec(goal)?.[1] ?? /(\d+(?:\.\d+)?)\s*(?:usd|dollars)/i.exec(goal)?.[1]) || null;
  const minutes = Number(/(\d+(?:\.\d+)?)\s*(?:min|minutes)\b/i.exec(goal)?.[1]) || 0;
  const tw = Number(/(\d+(?:\.\d+)?)\s*:\s*1|thrust[- ]to[- ]weight\D{0,12}(\d+(?:\.\d+)?)/i.exec(goal)?.[1]) || 3;
  return { drone, budget, minutes, tw };
}

function planFor(scope: Scope, skipVerification: boolean): Plan {
  const { kind, goal, context } = scope;
  if (kind === "build") {
    const spec = parseBuildGoal(goal);
    const steps: Plan["steps"] = [
      { title: "Find the airframe", goal: `Find the catalogue drone that fits "${goal}" and read its options.`, tools: ["catalog_search", "catalog_get"] },
      { title: "Search the parts combinations", goal: `Find the battery, motor and prop combination that meets ${spec.minutes} minutes and thrust-to-weight ${spec.tw}${spec.budget ? ` under $${spec.budget}` : ""}.`, tools: ["drone_optimize"] },
      ...(skipVerification ? [] : [{ title: "Verify in the calculator", goal: "Run the drone calculator on the chosen combination and read its design checks.", tools: ["drone_calc"] }]),
      { title: "Price the parts", goal: "Get live prices for the chosen parts; fall back to catalogue estimates if search is not set up.", tools: ["parts_price"] },
    ];
    const success_criteria = [
      ...(spec.minutes ? [`drone_calc reports at least ${spec.minutes} minutes of flight`] : []),
      `drone_calc reports thrust-to-weight of at least ${spec.tw}`,
      "drone_calc raises no danger-level design check",
      ...(spec.budget ? [`the parts total is at most ${spec.budget} USD`] : []),
    ];
    return { steps, success_criteria, ...(spec.budget ? { budget: { usd: spec.budget } } : {}), target_item: { lab: "drone", id: spec.drone } };
  }
  if (kind === "diagnose") {
    const code = str(context.code);
    return {
      steps: [
        { title: "Read the bench", goal: "Read the bench's current draw and active faults, and rank the known faults against the symptom.", tools: ["bench_check"] },
        ...(code ? [{ title: "Run the firmware", goal: "Run the user's code in the simulator and read serial and pin activity.", tools: ["sim_run"] }] : []),
        { title: "Propose the fix", goal: "Propose the fix and point at the faulty part.", tools: ["propose_change", "highlight_part"] },
      ],
      success_criteria: ["bench_check identifies a fault that explains the symptom", "a concrete fix was proposed to the user"],
      target_item: { lab: "robotics", id: str(context.itemId, "led-resistor") },
    };
  }
  const first = str(obj(list(context.participants)[0]).wants) || str(list(context.interests)[0]) || goal;
  return {
    steps: [{ title: "Search the catalogue", goal: `Find catalogue items for "${first}".`, tools: ["catalog_search", "catalog_get"] }],
    success_criteria: ["the suggested item exists in the catalogue"],
  };
}

/** What a revision step calls: the tools its fixes name, in the order they are named. */
function revisionTools(scope: Scope): string[] {
  const text = (scope.fixes ?? []).join(" ");
  const named = ["drone_optimize", "drone_calc", "bench_check", "parts_price"].filter((tool) => text.includes(tool));
  if (named.length) return named.sort((a, b) => text.indexOf(a) - text.indexOf(b));
  return scope.kind === "diagnose" ? ["bench_check"] : ["drone_calc"];
}

function argsFor(tool: string, index: number, scope: Scope): Obj {
  const { kind, goal, context, evidence } = scope;
  const optimize = lastOk(evidence, "drone_optimize");
  const best = obj(optimize?.best);
  const pick = obj(best.pick);
  const spec = parseBuildGoal(goal);
  switch (tool) {
    case "catalog_search": {
      if (kind === "build") return { query: `${spec.drone.replace(/\d/g, "")} drone ${goal}`.slice(0, 120), lab: "drone", limit: 4 };
      const first = str(obj(list(context.participants)[0]).wants) || str(list(context.interests)[0]) || goal;
      return { query: first.slice(0, 120), limit: 4 };
    }
    case "catalog_get": {
      if (kind === "build") return { lab: "drone", id: spec.drone };
      const hit = obj(list(lastOk(evidence, "catalog_search")?.results)[0]);
      return { lab: str(hit.lab, "board"), id: str(hit.id, "uno-r3") };
    }
    case "drone_optimize": {
      const nearest = num(obj(optimize?.cheapestThatWorks).costUsd);
      const raised = scope.fixes && nearest !== null ? Math.ceil(nearest) : null;
      return { drone: spec.drone, budget_usd: raised ?? spec.budget ?? 400, min_thrust_to_weight: spec.tw, min_flight_minutes: spec.minutes };
    }
    case "drone_calc":
      return { drone: spec.drone, ...(pick.battery ? { battery: pick.battery, motor: pick.motor, prop: pick.prop } : {}) };
    case "parts_price":
      return { lab: "drone", id: spec.drone, ...(pick.battery ? { battery: pick.battery, motor: pick.motor, prop: pick.prop } : {}) };
    case "bench_check":
      return {
        id: str(context.itemId, "led-resistor"),
        ...(list(context.faults).length ? { faults: list(context.faults) } : {}),
        ...(str(context.symptom) ? { symptom: str(context.symptom) } : {}),
      };
    case "sim_run":
      return { code: str(context.code), board: str(context.board, "uno-r3"), language: str(context.language, "arduino-cpp"), run_ms: 3000 };
    case "propose_change": {
      const culprit = culpritOf(evidence);
      return { target: "wiring", title: culprit.title.slice(0, 110) || "Fix the fault", detail: culprit.fix || "Follow the bench_check cause and fix." };
    }
    case "highlight_part":
      return { part: culpritOf(evidence).part, reason: culpritOf(evidence).cause.slice(0, 280) || "This part is behind the symptom." };
    default:
      return { index };
  }
}

/** The fault the bench analysis points at: an active one if there is one, else the best-scored candidate. */
function culpritOf(evidence: readonly Evidence[]) {
  const bench = lastOk(evidence, "bench_check");
  const fault = obj(list(bench?.activeFaults)[0] ?? list(bench?.candidates)[0]);
  const damages = list(obj(fault.effect).damages);
  const trigger = str(fault.trigger).split(" ");
  return {
    id: str(fault.id),
    title: str(fault.title),
    cause: str(fault.cause),
    fix: str(fault.fix),
    symptom: str(fault.symptom),
    part: str(damages[0]) || trigger.at(-1) || "D1",
  };
}

function summaryFor(tool: string, evidence: readonly Evidence[]): string {
  const last = evidence.at(-1);
  if (!last || last.tool !== tool) return `Ran ${tool}.`;
  const v = obj(last.value);
  if (!last.ok) return `${tool} failed (${str(v.error)}); falling back.`;
  switch (tool) {
    case "catalog_search":
      return `Found ${num(v.total) ?? 0} matches; the first is ${str(obj(list(v.results)[0]).id)}.`;
    case "drone_optimize": {
      const best = obj(v.best);
      if (!best.pick) return `No combination meets the constraints (${str(v.reason)}).`;
      return `Best pick ${JSON.stringify(best.pick)}: ${num(best.flightMinutes)} min flight, T:W ${num(best.thrustToWeight)}, $${num(best.costUsd)} (${str(v.priceSource)}).`;
    }
    case "drone_calc": {
      const r = obj(v.result);
      return `Calculator: ${num(r.flightMinutes)} min flight, T:W ${num(r.thrustToWeight)}, ${list(v.checks).length} design checks.`;
    }
    case "bench_check":
      return `Supply draw ${num(v.totalMa)} mA; top explanation: ${culpritOf(evidence).title || "none"}.`;
    default:
      return `Ran ${tool}.`;
  }
}

function criticFor(scope: Scope): { verdict: "approve" | "revise"; issues: string[]; fixes: string[] } {
  const { kind, evidence, goal } = scope;
  if (kind === "build") {
    const spec = parseBuildGoal(goal);
    const best = obj(obj(lastOk(evidence, "drone_optimize")).best);
    const calc = lastOk(evidence, "drone_calc");
    const pick = obj(best.pick);
    if (!best.pick && scope.revisions === 0) {
      const nearest = num(obj(obj(lastOk(evidence, "drone_optimize")).cheapestThatWorks).costUsd);
      return {
        verdict: "revise",
        issues: [`No combination meets the constraints within the ${spec.budget ?? "stated"} USD budget, so there is nothing to build or verify yet.`],
        fixes: [nearest !== null ? `Re-run drone_optimize with the budget raised to ${Math.ceil(nearest)} USD to find the nearest feasible build, then confirm it with drone_calc.` : "Relax the constraints and search again."],
      };
    }
    const confirmed = calc && obj(calc.pick).battery === pick.battery && obj(calc.pick).motor === pick.motor && obj(calc.pick).prop === pick.prop;
    if (best.pick && !confirmed) {
      return {
        verdict: "revise",
        issues: ["The chosen combination was never run through the drone calculator, so the flight time and design checks are unverified."],
        fixes: [`Run drone_calc for ${spec.drone} with battery ${str(pick.battery)}, motor ${str(pick.motor)}, prop ${str(pick.prop)} and confirm the checks.`],
      };
    }
  }
  if (kind === "diagnose" && !lastOk(evidence, "bench_check")) {
    return { verdict: "revise", issues: ["No bench analysis backs the diagnosis."], fixes: ["Run bench_check with the symptom."] };
  }
  return { verdict: "approve", issues: [], fixes: [] };
}

function resultFor(scope: Scope): Obj {
  const { kind, goal, context, evidence } = scope;
  if (kind === "build") {
    const spec = parseBuildGoal(goal);
    const optimize = lastOk(evidence, "drone_optimize");
    const best = obj(optimize?.best);
    const pick = obj(best.pick);
    const calc = lastOk(evidence, "drone_calc");
    const r = obj(calc?.result);
    const bom = list(optimize?.bom).map((l) => ({ name: str(obj(l).part), qty: num(obj(l).qty) ?? 1, unit_usd: round((num(obj(l).lineUsd) ?? 0) / (num(obj(l).qty) ?? 1)), source: str(obj(l).source) }));
    const total = bom.length ? round(bom.reduce((sum, l) => sum + (l.unit_usd ?? 0) * l.qty, 0)) : null;
    const dangers = list(calc?.checks).filter((c) => obj(c).level === "danger").map((c) => str(obj(c).code));
    const flight = num(r.flightMinutes);
    const tw = num(r.thrustToWeight);
    const verification = [
      ...(spec.minutes ? [{ check: `flight time of at least ${spec.minutes} minutes`, tool: "drone_calc", passed: (flight ?? 0) >= spec.minutes, evidence: `${flight} minutes` }] : []),
      { check: `thrust-to-weight of at least ${spec.tw}`, tool: "drone_calc", passed: (tw ?? 0) >= spec.tw, evidence: `${tw}` },
      { check: "no danger-level design check", tool: "drone_calc", passed: dangers.length === 0, evidence: dangers.length ? dangers.join(", ") : "none raised" },
      ...(spec.budget ? [{ check: `parts total at most ${spec.budget} USD`, tool: "drone_optimize", passed: total !== null && total <= spec.budget, evidence: `${total} USD (${str(optimize?.priceSource)})` }] : []),
    ];
    if (!best.pick) {
      return {
        summary: `No battery, motor and prop combination for the ${spec.drone} meets those constraints (${str(optimize?.reason, "constraints")}). The closest option is in the design notes.`,
        design: { item: spec.drone, reason: str(optimize?.reason), cheapestThatWorks: optimize?.cheapestThatWorks ?? null, upgrade: optimize?.upgradeOverBudget ?? null },
        verification,
        bom: [],
        total_usd: null,
        within_budget: false,
        load_into_lab: null,
      };
    }
    const over = spec.budget !== null && total !== null && total > spec.budget;
    return {
      summary: `${over ? `Nothing in the catalogue meets those constraints for $${spec.budget}; the nearest feasible build costs about $${total}. ` : ""}Build the ${spec.drone} with battery ${str(pick.battery)}, motor ${str(pick.motor)} and prop ${str(pick.prop)}: the calculator gives ${flight} minutes of flight at a thrust-to-weight of ${tw}${total !== null && !over ? `, for about $${total} in parts (${str(optimize?.priceSource)})` : ""}.`,
      design: {
        item: spec.drone,
        battery: pick.battery,
        motor: pick.motor,
        prop: pick.prop,
        thrust_to_weight: tw,
        flight_minutes: flight,
        hover_minutes: num(r.hoverMinutes),
        all_up_weight_g: num(r.allUpWeightG),
        hover_throttle: num(r.hoverThrottle),
        swaps_from_default: optimize?.swaps ?? [],
      },
      verification,
      bom,
      total_usd: total,
      within_budget: spec.budget && total !== null ? total <= spec.budget : null,
      load_into_lab: { lab: "drone", itemId: spec.drone, config: { battery: pick.battery, motor: pick.motor, prop: pick.prop } },
    };
  }
  if (kind === "diagnose") {
    const culprit = culpritOf(evidence);
    const sim = lastOk(evidence, "sim_run");
    return {
      summary: `${culprit.title || "No single fault"}: ${culprit.cause} ${culprit.fix}`.trim(),
      design: { root_cause: culprit.id, cause: culprit.cause, fix: culprit.fix, part: culprit.part, firmware: sim ? { passed: sim.passed, total: sim.total, error: sim.error } : null },
      verification: [
        { check: "bench_check explains the symptom", tool: "bench_check", passed: Boolean(culprit.id), evidence: culprit.symptom || culprit.title },
        { check: "a fix was proposed", tool: "propose_change", passed: lastOk(evidence, "propose_change") !== null, evidence: "queued for the user" },
      ],
      bom: [],
      total_usd: null,
      within_budget: null,
      load_into_lab: context.itemId ? { lab: "robotics", itemId: str(context.itemId), config: {} } : null,
    };
  }
  const hit = obj(list(lastOk(evidence, "catalog_search")?.results)[0]);
  const people = list(context.participants).map((p) => obj(p));
  return {
    summary: `Start with ${str(hit.title, str(hit.id))}.`,
    design: { item: `${str(hit.lab)}:${str(hit.id)}`, title: str(hit.title) },
    verification: [{ check: "the suggested item exists in the catalogue", tool: "catalog_search", passed: Boolean(hit.id), evidence: str(hit.id) }],
    bom: [],
    total_usd: null,
    within_budget: null,
    load_into_lab: hit.id ? { lab: str(hit.lab), itemId: str(hit.id), config: {} } : null,
    ...(kind === "plan"
      ? { roles: people.map((p, i) => ({ name: str(p.name, `Builder ${i + 1}`), role: ["Lead builder", "Tester", "Navigator", "Parts runner"][i % 4], firstTask: "Open the item and read the first lesson." })) }
      : { matches: list(context.pool).map((p) => ({ id: str(obj(p).id), why: "Complementary skills and a shared interest.", suggestedProject: str(hit.id) })) }),
  };
}

export type FakeOptions = {
  /** Leave the calculator check out of the first build plan, so the critic has to ask for it. */
  skipVerification?: boolean;
  /** Milliseconds each call takes, so a demo streams at a readable pace. */
  delayMs?: number;
};

/** A deterministic stand-in for Nemotron: plans, tool calls, critique and result come from scripts, not a model. */
export class FakeModel implements ModelClient {
  constructor(private readonly options: FakeOptions = {}) {}

  async complete(req: ModelRequest): Promise<ModelReply> {
    if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    const { scope } = req;
    const reply = (text: string, toolCalls: ModelReply["toolCalls"] = []): ModelReply => ({
      text,
      reasoning: "",
      toolCalls,
      model: req.role === "planner" ? "scripted-planner" : FAKE_MODEL,
    });

    switch (req.phase) {
      case "plan":
        return reply(JSON.stringify(planFor(scope, this.options.skipVerification ?? true)));
      case "critic":
        return reply(JSON.stringify(criticFor(scope)));
      case "final":
        return reply(JSON.stringify(resultFor(scope)));
      case "execute": {
        const step = scope.stepIndex !== undefined ? scope.plan?.steps[scope.stepIndex] : undefined;
        const hints = step?.tools ?? revisionTools(scope);
        const made = req.messages.filter((m) => m.role === "tool").length;
        const next = hints[made];
        if (!next || !req.tools) return reply(made ? summaryFor(hints[made - 1] ?? "", scope.evidence) : "Nothing to do.");
        return reply("", [{ id: `call_${scope.evidence.length + 1}`, name: next, arguments: JSON.stringify(argsFor(next, made, scope)) }]);
      }
    }
  }
}
