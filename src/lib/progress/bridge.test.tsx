import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stdb = vi.hoisted(() => ({
  status: "online" as "online" | "offline",
  keys: new Set<string>(),
  ready: true,
  recordProgress: vi.fn(async (_key: string) => {}),
}));

vi.mock("@/lib/stdb", () => ({
  useStdb: () => ({ status: stdb.status }),
  useStdbActions: () => ({ recordProgress: stdb.recordProgress }),
  useMyProgress: () => ({ keys: stdb.keys, rows: [], ready: stdb.ready }),
}));

import { ProgressBridge } from "./bridge";
import { markDone } from "./progress";
import { getSaved, STORAGE_KEY } from "./storage";

beforeEach(() => {
  localStorage.clear();
  stdb.status = "online";
  stdb.keys = new Set();
  stdb.ready = true;
  stdb.recordProgress.mockClear();
});
afterEach(cleanup);

describe("ProgressBridge", () => {
  it("reports a finished key to the module as it happens, once", () => {
    render(<ProgressBridge />);
    act(() => markDone("board:uno:lesson:blink"));
    act(() => markDone("board:uno:lesson:blink"));
    expect(stdb.recordProgress.mock.calls).toEqual([["board:uno:lesson:blink"]]);
  });

  it("adds keys the server has to this browser and sends the ones only this browser has", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, done: { "drone:quad5:build": true, "robotics:arm:step:grip": true } }));
    stdb.keys = new Set(["drone:quad5:build", "board:uno:lesson:blink"]);
    render(<ProgressBridge />);
    expect(Object.keys(getSaved().done).sort()).toEqual(["board:uno:lesson:blink", "drone:quad5:build", "robotics:arm:step:grip"]);
    expect(stdb.recordProgress.mock.calls).toEqual([["robotics:arm:step:grip"]]);
  });

  it("stays local while the module is unreachable", () => {
    stdb.status = "offline";
    render(<ProgressBridge />);
    act(() => markDone("board:uno:lesson:blink"));
    expect(stdb.recordProgress).not.toHaveBeenCalled();
    expect(getSaved().done["board:uno:lesson:blink"]).toBe(true);
  });

  it("skips keys the module would refuse", () => {
    render(<ProgressBridge />);
    act(() => markDone("Bad Key"));
    expect(stdb.recordProgress).not.toHaveBeenCalled();
  });
});
