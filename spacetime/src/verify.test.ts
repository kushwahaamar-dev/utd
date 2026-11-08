import { describe, expect, it } from "vitest";
import { replayHash } from "../../src/lib/verify/hash";
import { GOOD_EVENTS, runText } from "./fixtures";
import { parseRun, replayHashOf, verifyRun } from "./verify";

describe("module verification", () => {
  it("hashes the way the web app does with WebCrypto", async () => {
    const inputs = [{ t: 0, action: { b: 2, a: 1, type: "x" } }];
    expect(replayHashOf(inputs)).toBe(await replayHash(inputs));
  });

  it("passes a clean bench run and scores it from the replay, not the claim", () => {
    const run = parseRun(runText(GOOD_EVENTS, { result: { pass: true, score: 5 } }));
    if (typeof run === "string") throw new Error(run);
    const verdict = verifyRun("drone-safety", "quad5", undefined, run);
    expect(verdict).toMatchObject({ ok: true, score: 100, skillId: "drone:quad5:safety" });
  });

  it("fails a tampered run: props fitted before the tests passed", () => {
    const events = [
      { ...GOOD_EVENTS[0]!, smokeOk: false, motorOk: false },
      { type: "add", id: "PROPS", orient: 0 },
    ];
    const run = parseRun(runText(events));
    if (typeof run === "string") throw new Error(run);
    const verdict = verifyRun("drone-safety", "quad5", undefined, run);
    expect(verdict.ok).toBe(false);
  });

  it("refuses a log for another item and a malformed one", () => {
    const run = parseRun(runText(GOOD_EVENTS));
    if (typeof run === "string") throw new Error(run);
    expect(verifyRun("drone-safety", "racer", undefined, run).ok).toBe(false);
    expect(typeof parseRun("{}")).toBe("string");
    expect(typeof parseRun("nope")).toBe("string");
  });
});
