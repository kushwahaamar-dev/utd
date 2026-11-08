import type { StepRole } from "./types";

// Recorded runs for the offline demo. Shapes match what the worker writes: plan items with ids, critic verdicts,
// revision changes, and a result with verification, BOM and the lab to open.

export type ScriptedStep = {
  role: StepRole;
  title: string;
  tool?: string;
  model: string;
  /** How long the step shows as running, in ms. */
  ms: number;
  input: unknown;
  output: unknown;
};

export type ScriptedProposal = { kind: string; payload: unknown };

export type Script = {
  steps: ScriptedStep[];
  result: unknown;
  proposals: ScriptedProposal[];
};

const ULTRA = "Nemotron Ultra";
const LIGHT = "Nemotron Lightning";
const NANO = "Nemotron Nano";

const droneBom = [
  { part: "5-inch freestyle frame, 220 mm", store: "RaceDayQuads", price: 21.99, qty: 1, url: "https://www.racedayquads.com/" },
  { part: "2306 1900KV motor", store: "GetFPV", price: 13.49, qty: 4, url: "https://www.getfpv.com/" },
  { part: "45A 4-in-1 ESC + F4 flight controller stack", store: "GetFPV", price: 44.5, qty: 1, url: "https://www.getfpv.com/" },
  { part: "4S 1550 mAh 100C LiPo", store: "Amazon", price: 24.99, qty: 1, url: "https://www.amazon.com/" },
  { part: "5x4x3 tri-blade props (8 pack)", store: "RaceDayQuads", price: 5.99, qty: 1, url: "https://www.racedayquads.com/" },
  { part: "ELRS 2.4 GHz receiver", store: "Happymodel", price: 12.99, qty: 1, url: "https://www.happymodel.cn/" },
];

export const droneBuild: Script = {
  steps: [
    {
      role: "planner",
      title: "Plan the build",
      model: ULTRA,
      ms: 3200,
      input: { goal: "5-inch drone that flies 8 minutes, under $180" },
      output: {
        plan: [
          { id: "p1", text: "Pick a 5-inch frame and motor class" },
          { id: "p2", text: "Size the battery and props with the drone calculator" },
          { id: "p3", text: "Fly the build in the simulator" },
          { id: "p4", text: "Price every part live and check the budget" },
          { id: "p5", text: "Check the wiring on the bench" },
        ],
        criteria: ["Estimated flight time of at least 8 min", "Thrust-to-weight above 4", "Parts total at most $180", "No bench faults"],
      },
    },
    {
      role: "executor",
      title: "Look up the motor class",
      tool: "datasheet_search",
      model: LIGHT,
      ms: 1900,
      input: { query: "2306 1900KV motor datasheet max current", limit: 3 },
      output: { summary: "2306 1900KV: 31 A max, 33 g, 4S rated", planItem: "p1" },
    },
    {
      role: "executor",
      title: "Choose the frame and stack",
      model: LIGHT,
      ms: 2100,
      input: { constraints: { size: "5in", budget: 180 } },
      output: { summary: "220 mm freestyle frame, 45 A 4-in-1 ESC, 4S 1300 mAh to start", planItem: "p1" },
    },
    {
      role: "executor",
      title: "Run the drone calculator",
      tool: "drone_calc",
      model: LIGHT,
      ms: 1500,
      input: { motor: "2306 1900KV", prop: "5143x3", battery: "4S 1300mAh", frame_g: 118 },
      output: { summary: "T:W 5.1, hover 11.8 A, flight time 6.1 min", thrust_to_weight: 5.1, flight_min: 6.1 },
    },
    {
      role: "executor",
      title: "Fly it in the simulator",
      tool: "sim_run",
      model: LIGHT,
      ms: 3600,
      input: { craft: "quad5", course: "figure-eight", battery: "4S 1300mAh" },
      output: { summary: "Completed, battery empty at 6.0 min, no crashes", flight_min: 6.0, crashes: 0, planItem: "p3" },
    },
    {
      role: "critic",
      title: "Review against the criteria",
      model: ULTRA,
      ms: 2600,
      input: { criteria: "flight >= 8 min" },
      output: {
        verdict: "revise",
        revision: 1,
        reasons: ["Flight time is 6.0 min, the goal asks for 8", "Hover current is high for this prop pitch; a lower pitch cuts it"],
      },
    },
    {
      role: "executor",
      title: "Revision 1: lower-pitch props",
      tool: "drone_calc",
      model: LIGHT,
      ms: 1600,
      input: { motor: "2306 1900KV", prop: "5040x3", battery: "4S 1300mAh" },
      output: {
        summary: "T:W 4.6, hover 9.9 A, flight time 7.2 min",
        revision: 1,
        change: { what: "5143 props to 5040", metric: "Flight time", from: "6.1 min", to: "7.2 min" },
      },
    },
    {
      role: "critic",
      title: "Review revision 1",
      model: ULTRA,
      ms: 2200,
      input: { criteria: "flight >= 8 min" },
      output: {
        verdict: "revise",
        revision: 2,
        reasons: ["7.2 min is still short of 8", "Thrust margin allows a heavier pack: 4.6 is well above the 4.0 floor"],
      },
    },
    {
      role: "executor",
      title: "Revision 2: bigger battery",
      tool: "drone_calc",
      model: LIGHT,
      ms: 1700,
      input: { motor: "2306 1900KV", prop: "5040x3", battery: "4S 1550mAh" },
      output: {
        summary: "T:W 4.2, hover 10.2 A, flight time 8.4 min",
        revision: 2,
        change: { what: "1300 mAh to 1550 mAh", metric: "Flight time", from: "6.1 min", to: "8.4 min" },
      },
    },
    {
      role: "executor",
      title: "Fly the revised build",
      tool: "sim_run",
      model: LIGHT,
      ms: 3800,
      input: { craft: "quad5", course: "figure-eight", battery: "4S 1550mAh", prop: "5040x3" },
      output: { summary: "Completed, battery empty at 8.4 min, no crashes", flight_min: 8.4, crashes: 0, planItem: "p2" },
    },
    {
      role: "executor",
      title: "Price the parts live",
      tool: "parts_price",
      model: NANO,
      ms: 4200,
      input: { parts: ["frame 5in 220mm", "motor 2306 1900KV x4", "ESC FC stack 45A", "LiPo 4S 1550", "prop 5040 x8", "ELRS receiver"], currency: "USD" },
      output: { summary: "6 parts found across 4 stores, $164.42 total", total: 164.42, planItem: "p4" },
    },
    {
      role: "executor",
      title: "Check the wiring",
      tool: "bench_check",
      model: NANO,
      ms: 2400,
      input: { bench: "quad-power", load_a: 10.2 },
      output: { summary: "Power path holds at 10.2 A, 0 faults", faults: 0, planItem: "p5" },
    },
    {
      role: "critic",
      title: "Final review",
      model: ULTRA,
      ms: 2600,
      input: { criteria: ["flight >= 8 min", "T:W > 4", "total <= $180", "no faults"] },
      output: { verdict: "approve", reasons: ["Flight time 8.4 min, thrust-to-weight 4.2", "$164.42 is $15.58 under budget", "Simulator and bench both clean"] },
    },
    {
      role: "executor",
      title: "Write up the build sheet",
      model: LIGHT,
      ms: 2200,
      input: { sections: ["summary", "bom", "verification"] },
      output: { summary: "Build sheet ready: 6 parts, 8.4 min estimated flight" },
    },
  ],
  result: {
    summary:
      "A 5-inch freestyle quad on a 4S 1550 mAh pack: 8.4 minutes of estimated flight at a thrust-to-weight of 4.2, for $164.42. Two revisions got it there: lower-pitch props, then a bigger pack.",
    verification: [
      { label: "Sim passed", ok: true },
      { label: "T:W 4.2", ok: true },
      { label: "Flight 8.4 min", ok: true },
      { label: "No faults", ok: true },
    ],
    bom: droneBom,
    budget: 180,
    lab: { kind: "drone", id: "quad5" },
  },
  proposals: [
    {
      kind: "swap_part",
      payload: {
        title: "Swap in a 1800 mAh pack",
        detail: "Adds about 70 s of flight for $6 more and stays inside the budget. Thrust-to-weight drops to 4.0.",
        delta: "+1.2 min flight, +$6.00",
      },
    },
    {
      kind: "save_build",
      payload: { title: "Save this build to your lab bench", detail: "Keeps the parts list and settings with your account so you can fly it later." },
    },
  ],
};

export const ledDiagnosis: Script = {
  steps: [
    {
      role: "planner",
      title: "Plan the diagnosis",
      model: ULTRA,
      ms: 2400,
      input: { goal: "Why does my LED burn out?" },
      output: {
        plan: [
          { id: "p1", text: "Read the LED's datasheet limits" },
          { id: "p2", text: "Check the circuit on the bench" },
          { id: "p3", text: "Find the fix and verify it" },
        ],
        criteria: ["The fault is reproduced on the bench", "The fix removes it"],
      },
    },
    {
      role: "executor",
      title: "Look up the LED limits",
      tool: "datasheet_search",
      model: LIGHT,
      ms: 1800,
      input: { query: "5 mm red LED forward current max" },
      output: { summary: "Red 5 mm LED: 20 mA continuous, 2.0 V forward", planItem: "p1" },
    },
    {
      role: "executor",
      title: "Check the circuit",
      tool: "bench_check",
      model: NANO,
      ms: 2600,
      input: { bench: "led-basic", supply_v: 5 },
      output: { summary: "No series resistor: 5 V across the LED, current unbounded, fault led_overcurrent", faults: 1, planItem: "p2" },
    },
    {
      role: "critic",
      title: "Review the finding",
      model: ULTRA,
      ms: 2000,
      input: {},
      output: { verdict: "revise", revision: 1, reasons: ["The cause is clear, but the fix is not yet checked on the bench"] },
    },
    {
      role: "executor",
      title: "Revision 1: add a 220 ohm resistor",
      tool: "bench_check",
      model: NANO,
      ms: 2400,
      input: { bench: "led-basic", supply_v: 5, series_ohm: 220 },
      output: {
        summary: "13.6 mA through the LED, 0 faults",
        revision: 1,
        change: { what: "added 220 ohm in series", metric: "LED current", from: "unbounded", to: "13.6 mA" },
        planItem: "p3",
      },
    },
    {
      role: "critic",
      title: "Final review",
      model: ULTRA,
      ms: 1900,
      input: {},
      output: { verdict: "approve", reasons: ["13.6 mA is under the 20 mA limit", "Bench reports no faults"] },
    },
  ],
  result: {
    summary: "The LED has no current-limiting resistor, so it sees 5 V directly and dies. A 220 ohm resistor in series holds it to 13.6 mA, well under its 20 mA limit.",
    verification: [
      { label: "Fault reproduced", ok: true },
      { label: "13.6 mA", ok: true },
      { label: "No faults", ok: true },
    ],
    bom: [{ part: "220 ohm resistor, 1/4 W (pack of 100)", store: "Amazon", price: 5.49, qty: 1, url: "https://www.amazon.com/" }],
    lab: { kind: "board", id: "uno-r3" },
  },
  proposals: [],
};
