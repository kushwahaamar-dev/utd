import { describe, expect, it } from "vitest";
import { RateGate } from "./gate";

describe("RateGate", () => {
  it("lets the first call through and spaces the next ones evenly", async () => {
    let clock = 1_000;
    const waits: number[] = [];
    const gate = new RateGate(30, () => clock, async (ms) => {
      waits.push(ms);
      clock += ms;
    });
    await gate.wait();
    await gate.wait();
    await gate.wait();
    expect(waits).toEqual([2000, 2000]);
  });

  it("does nothing when the limit is off", async () => {
    const gate = new RateGate(0, () => 0, async () => {
      throw new Error("should not sleep");
    });
    await gate.wait();
    await gate.wait();
  });
});
