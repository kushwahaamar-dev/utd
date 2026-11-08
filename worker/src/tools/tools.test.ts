/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are asserted on loosely */
import { describe, expect, it } from "vitest";
import { MemorySink } from "../sinks/memory";
import { TOOLS, callTool, toolSpecs } from "./index";

const sink = () => new MemorySink({ id: "t" });

async function call(name: string, args: unknown, s = sink()) {
  const out = await callTool(name, JSON.stringify(args), { sink: s });
  return { ...out, data: out.value as Record<string, any> };
}

describe("tool specs", () => {
  it("are flat JSON schemas with a name and description each", () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.name)).toEqual(TOOLS.map((t) => t.name));
    for (const spec of specs) {
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.parameters).toMatchObject({ type: "object" });
      expect(spec.parameters).not.toHaveProperty("$schema");
    }
  });
});

describe("argument validation", () => {
  it("reports the problems so the model can fix its call", async () => {
    const out = await call("drone_calc", { drone: "spaceship" });
    expect(out.ok).toBe(false);
    expect(out.data.error).toBe("invalid_args");
    expect(out.data.issues[0]).toMatch(/drone/);
  });

  it("rejects arguments that are not JSON and tools that do not exist", async () => {
    const bad = await callTool("drone_calc", "{drone:", { sink: sink() });
    expect(JSON.parse(bad.message).error).toBe("invalid_args");
    const missing = await call("teleport", {});
    expect(missing.data.error).toBe("unknown_tool");
    expect(missing.data.message).toContain("drone_calc");
  });
});

describe("catalog tools", () => {
  it("catalog_search finds the 5-inch quad", async () => {
    const out = await call("catalog_search", { query: "5 inch freestyle", lab: "drone" });
    expect(out.ok).toBe(true);
    expect(out.data.results.map((r: { id: string }) => r.id)).toContain("quad5");
  });

  it("catalog_get returns a drone's option keys", async () => {
    const out = await call("catalog_get", { lab: "drone", id: "quad5" });
    expect(out.data.details.design.default).toMatchObject({ batt: "6s1100" });
    expect((await call("catalog_get", { lab: "drone", id: "nope" })).data.error).toBe("not_found");
  });
});

describe("drone tools", () => {
  it("drone_calc runs the real calculator", async () => {
    const out = await call("drone_calc", { drone: "quad5" });
    expect(out.data.result.thrustToWeight).toBeGreaterThan(1);
    expect(out.data.result.flightMinutes).toBeGreaterThan(0);
    expect(out.data.options.batteries).toContain("6s1100");
  });

  it("drone_optimize picks a build that meets the constraints and prices its parts list", async () => {
    const out = await call("drone_optimize", { drone: "quad5", budget_usd: 450, min_thrust_to_weight: 3, min_flight_minutes: 7 });
    expect(out.data.considered).toBe(27);
    expect(out.data.best.flightMinutes).toBeGreaterThanOrEqual(7);
    expect(out.data.best.costUsd).toBeLessThanOrEqual(450);
    expect(out.data.bom.length).toBeGreaterThan(3);
    expect(out.data.priceSource).toBe("catalogue estimates");
  });

  it("drone_optimize says why nothing fits", async () => {
    const out = await call("drone_optimize", { drone: "quad5", budget_usd: 100, min_flight_minutes: 8 });
    expect(out.data.best).toBeNull();
    expect(out.data.reason).toBe("budget");
    expect(out.data.cheapestThatWorks.costUsd).toBeGreaterThan(100);
  });
});

describe("tools that need SerpApi", () => {
  it("parts_price and datasheet_search say so when it is not set up", async () => {
    const prices = await call("parts_price", { lab: "drone", id: "quad5" });
    expect(prices.ok).toBe(false);
    expect(prices.data.error).toBe("not_configured");
    const sheet = await call("datasheet_search", { query: "TB6612FNG ratings" });
    expect(sheet.data.error).toBe("not_configured");
  });
});

const BLINK = `void setup() { Serial.begin(9600); pinMode(13, OUTPUT); Serial.println("ready"); }
void loop() { digitalWrite(13, HIGH); delay(100); digitalWrite(13, LOW); delay(100); }`;

describe("sim_run", () => {
  it("runs Arduino C++ on a board profile and reports serial and pins", async () => {
    const out = await call("sim_run", { code: BLINK, board: "uno-r3", language: "arduino-cpp", run_ms: 1000 });
    expect(out.data.error).toBeNull();
    expect(out.data.serial.join("\n")).toContain("ready");
    expect(Object.keys(out.data.pins).length).toBeGreaterThan(0);
  });

  it("shows interpreter errors", async () => {
    const out = await call("sim_run", { code: "void setup() { nope(; }", board: "uno-r3", language: "arduino-cpp" });
    expect(out.data.error).toMatchObject({ message: expect.any(String) });
  });

  it("runs a program against a lesson's checks", async () => {
    const { data } = await call("catalog_get", { lab: "board", id: "uno-r3" });
    const lesson = data.details.lessons[0].id as string;
    const out = await call("sim_run", { code: "void setup() {}\nvoid loop() {}", lab: "board", id: "uno-r3", lesson_id: lesson });
    expect(out.data.total).toBeGreaterThan(0);
    expect(out.data.passed).toBeLessThan(out.data.total);
    expect(out.data.checks[0]).toHaveProperty("ok");
  });

  it("asks for the pieces a run needs", async () => {
    expect((await call("sim_run", { code: "x" })).data.error).toBe("bad_input");
    expect((await call("sim_run", { code: "x", lab: "board", id: "uno-r3", lesson_id: "nope" })).data.error).toBe("not_found");
  });
});

describe("bench_check", () => {
  it("explains an active fault and sums the supply draw", async () => {
    const out = await call("bench_check", { id: "led-resistor", faults: ["led-backwards"] });
    expect(out.data.activeFaults[0]).toMatchObject({ id: "led-backwards", kind: "reversed-part" });
    expect(out.data.activeFaults[0].fix).toBeTruthy();
    expect(out.data.supplies.length).toBeGreaterThan(0);
  });

  it("ranks the known faults against a symptom", async () => {
    const out = await call("bench_check", { id: "led-resistor", symptom: "the LED is backwards and stays dark" });
    expect(out.data.candidates.length).toBeGreaterThan(0);
    expect(out.data.candidates[0].matchScore).toBeGreaterThan(0);
  });

  it("names the faults it knows when given an unknown id", async () => {
    const out = await call("bench_check", { id: "led-resistor", faults: ["gremlins"] });
    expect(out.data.unknownFaultIds).toEqual(["gremlins"]);
    expect(out.data.knownFaultIds).toContain("led-backwards");
  });
});

describe("proposal tools", () => {
  it("write proposals to the sink for the human to accept", async () => {
    const s = sink();
    await call("propose_change", { target: "wiring", title: "Flip the LED", detail: "Swap anode and cathode." }, s);
    await call("ask_peer", { question: "How did you wire the resistor?" }, s);
    await call("highlight_part", { part: "D1", reason: "Reversed." }, s);
    expect(s.proposals.map((p) => p.kind)).toEqual(["propose_change", "ask_peer", "highlight_part"]);
    expect(s.proposals[0].payload).toMatchObject({ title: "Flip the LED" });
  });
});
