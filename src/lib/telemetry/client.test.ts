import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("./client");

async function fresh(): Promise<{ t: Client; sent: [string, number][] }> {
  vi.resetModules();
  const t = await import("./client");
  const sent: [string, number][] = [];
  t.setTelemetrySink(async (kind, count) => void sent.push([kind, count]));
  return { t, sent };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("telemetry client", () => {
  it("adds up events of a kind and sends one count per kind on flush", async () => {
    const { t, sent } = await fresh();
    t.track("lesson.attempt", { lesson: "blink" });
    t.track("lesson.attempt");
    t.track("fault");
    t.tally("led.blink", 40);
    t.tally("led.blink", 2);
    expect(sent).toEqual([]);
    t.flush();
    expect(Object.fromEntries(sent)).toEqual({ "lesson.attempt": 2, fault: 1, "led.blink": 42 });
  });

  it("sends on its own after a few seconds", async () => {
    const { t, sent } = await fresh();
    t.track("ai.call");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toEqual([["ai.call", 1]]);
    t.flush();
    expect(sent).toHaveLength(1);
  });

  it("ignores kinds the module does not count", async () => {
    const { t, sent } = await fresh();
    t.track("flight.sample");
    t.track("room.join");
    t.flush();
    expect(sent).toEqual([]);
  });

  it("keeps counts until a connection exists", async () => {
    const { t } = await fresh();
    t.setTelemetrySink(null);
    t.track("hw.connect");
    t.flush();
    const sent: [string, number][] = [];
    t.setTelemetrySink(async (kind, count) => void sent.push([kind, count]));
    t.flush();
    expect(sent).toEqual([["hw.connect", 1]]);
  });

  it("sends nothing, and forgets what was queued, once the learner opts out", async () => {
    const { t, sent } = await fresh();
    t.track("fault");
    localStorage.setItem("iynk:v1", JSON.stringify({ v: 1, settings: { telemetry: false } }));
    t.track("fault");
    t.flush();
    expect(sent).toEqual([]);
  });
});
