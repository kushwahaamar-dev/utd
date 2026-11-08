// Run-log fixtures shared by the module tests.
const BUILT = { FRAME: 0, MOTORS: 0, ESC: 0, WIRES: 0, FC: 0, XT60: 0, CAM: 0, RX: 0, VTX: 0, TOP: 0, BATT: 0, PROPS: 0 };

export const GOOD_EVENTS = [
  { type: "init", placed: { ...BUILT }, plugged: false, fault: null, smokeOk: true, motorOk: true, accOk: true },
  { type: "remove", id: "PROPS" },
  { type: "test", test: "smoke" },
  { type: "test-end", test: "smoke" },
  { type: "test", test: "motors" },
  { type: "test-end", test: "motors" },
  { type: "unplug" },
  { type: "test", test: "calibrate" },
  { type: "test-end", test: "calibrate" },
  { type: "add", id: "PROPS", orient: 0 },
];

export const runText = (events: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    kind: "drone-safety",
    itemId: "quad5",
    seed: 7,
    inputs: events.map((action, i) => ({ t: i * 500, action })),
    result: { pass: true, score: 100 },
    client: { appVersion: "test" },
    ...over,
  });


/** The inputs a real lap carries: the header the range writes plus a short log that arms the craft. */
export function lapInputsFor(timeMs: number, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    craft: "quad5",
    course: "race",
    mode: null,
    time: timeMs / 1000,
    steps: Math.round(timeMs / 10) + 300,
    log: [
      { step: 0, action: { type: "arm" } },
      { step: 40, action: { type: "sticks", sticks: { roll: 0, pitch: 0.4, yaw: 0, throttle: 0.6 } } },
    ],
    ...over,
  });
}
