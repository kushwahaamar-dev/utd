import { describe, expect, it } from "vitest";
import { ConnectionId, ScheduleAt, Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import spacetimedb, * as mod from "./index";
import { GOOD_EVENTS, runText } from "./fixtures";

const auth = (name: string, n: bigint) =>
  TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: name }), new ConnectionId(n));

function setup() {
  const test = createModuleTestHarness(spacetimedb, mod);
  const alice = auth("alice", 1n);
  const bob = auth("bob", 2n);
  const carol = auth("carol", 3n);
  const call = <T,>(who: TestAuth, run: (ctx: Parameters<Parameters<typeof test.withReducerTx>[1]>[0]) => T) => test.withReducerTx(who, run);
  const idOf = (who: TestAuth) => {
    let id: unknown;
    test.withReducerTx(who, (ctx) => {
      id = ctx.sender;
    });
    return id as import("spacetimedb").Identity;
  };
  return { test, alice, bob, carol, call, idOf };
}

function newRoom(s: ReturnType<typeof setup>, lab = "drone", item = "quad5") {
  s.call(s.alice, (ctx) => mod.createRoom(ctx, { lab, itemId: item }));
  const room = [...s.test.db.room.iter()][0]!;
  s.call(s.bob, (ctx) => mod.joinRoom(ctx, { code: room.code, lab: undefined, itemId: undefined }));
  return room.code;
}

describe("rooms", () => {
  it("makes a 6 character code, hosts the creator and gives them the baton", () => {
    const s = setup();
    const code = newRoom(s);
    expect(code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
    const members = [...s.test.db.roomMember.iter()];
    expect(members.map((m) => m.role).sort()).toEqual(["builder", "host"]);
    expect(members.find((m) => m.role === "host")!.baton).toBe(true);
    expect(members.find((m) => m.role === "builder")!.baton).toBe(false);
  });

  it("refuses a ninth member and a wrong lab item", () => {
    const s = setup();
    const code = newRoom(s);
    expect(() => s.call(s.carol, (ctx) => mod.joinRoom(ctx, { code, lab: "drone", itemId: "racer" }))).toThrow("wrong_item");
    for (let i = 0; i < 6; i++) {
      s.call(auth(`p${i}`, BigInt(10 + i)), (ctx) => mod.joinRoom(ctx, { code, lab: undefined, itemId: undefined }));
    }
    expect([...s.test.db.roomMember.iter()]).toHaveLength(8);
    expect(() => s.call(s.carol, (ctx) => mod.joinRoom(ctx, { code, lab: undefined, itemId: undefined }))).toThrow("room_full");
  });

  it("orders shared actions with one seq per room and enforces the baton", () => {
    const s = setup();
    const code = newRoom(s);
    const run = JSON.stringify({ type: "bench/run" });
    const select = JSON.stringify({ type: "select", id: "x" });
    expect(() => s.call(s.bob, (ctx) => mod.submitAction(ctx, { code, action: run }))).toThrow("no_baton");
    s.call(s.bob, (ctx) => mod.submitAction(ctx, { code, action: select }));
    s.call(s.alice, (ctx) => mod.submitAction(ctx, { code, action: run }));
    s.call(s.bob, (ctx) => mod.submitAction(ctx, { code, action: select }));
    const rows = [...s.test.db.roomAction.iter()].sort((a, b) => Number(a.seq - b.seq));
    expect(rows.map((r) => r.seq)).toEqual([1n, 2n, 3n]);
    expect(s.test.db.room.code.find(code)!.seq).toBe(3n);
    expect(() => s.call(s.alice, (ctx) => mod.submitAction(ctx, { code, action: JSON.stringify({ type: "made/up" }) }))).toThrow("not_shared");
    expect(() => s.call(s.alice, (ctx) => mod.submitAction(ctx, { code, action: JSON.stringify({ type: "room/baton", to: null }) }))).toThrow("not_shared");
  });

  it("passes the baton and logs it in the action stream", () => {
    const s = setup();
    const code = newRoom(s);
    const bob = s.idOf(s.bob);
    const alice = s.idOf(s.alice);
    s.call(s.alice, (ctx) => mod.passBaton(ctx, { code, to: bob }));
    const run = JSON.stringify({ type: "bench/run" });
    s.call(s.bob, (ctx) => mod.submitAction(ctx, { code, action: run }));
    expect(() => s.call(s.alice, (ctx) => mod.submitAction(ctx, { code, action: run }))).toThrow("no_baton");
    const baton = [...s.test.db.roomAction.iter()].find((a) => a.action.includes("room/baton"));
    expect(JSON.parse(baton!.action).to).toBe(bob.toHexString());
    // The host can always take it back.
    s.call(s.alice, (ctx) => mod.passBaton(ctx, { code, to: alice }));
    s.call(s.alice, (ctx) => mod.submitAction(ctx, { code, action: run }));
  });

  it("hands the host role to the longest-standing member when the host leaves", () => {
    const s = setup();
    const code = newRoom(s);
    s.call(s.carol, (ctx) => mod.joinRoom(ctx, { code, lab: undefined, itemId: undefined }));
    s.call(s.alice, (ctx) => mod.leaveRoom(ctx, { code }));
    const room = s.test.db.room.code.find(code)!;
    expect(room.host.equals(s.idOf(s.bob))).toBe(true);
    const bob = [...s.test.db.roomMember.iter()].find((m) => m.identity.equals(s.idOf(s.bob)))!;
    expect(bob.role).toBe("host");
    expect(bob.baton).toBe(true);
  });

  it("kicks and bans, host only", () => {
    const s = setup();
    const code = newRoom(s);
    const [alice, bob] = [s.idOf(s.alice), s.idOf(s.bob)];
    expect(() => s.call(s.bob, (ctx) => mod.kick(ctx, { code, target: alice }))).toThrow("not_host");
    s.call(s.alice, (ctx) => mod.kick(ctx, { code, target: bob }));
    expect([...s.test.db.roomMember.iter()]).toHaveLength(1);
    expect(() => s.call(s.bob, (ctx) => mod.joinRoom(ctx, { code, lab: undefined, itemId: undefined }))).toThrow("kicked");
  });

  it("marks a room empty when the last member leaves, and lets a new lab item rebind it", () => {
    const s = setup();
    const code = newRoom(s);
    s.call(s.alice, (ctx) => mod.leaveRoom(ctx, { code }));
    s.call(s.bob, (ctx) => mod.leaveRoom(ctx, { code }));
    expect(s.test.db.room.code.find(code)!.emptySince).toBeDefined();
    s.call(s.carol, (ctx) => mod.joinRoom(ctx, { code, lab: "board", itemId: "uno-r3" }));
    const room = s.test.db.room.code.find(code)!;
    expect(room.lab).toBe("board");
    expect(room.epoch).toBe(2);
    expect(room.seq).toBe(0n);
    expect(room.host.equals(s.idOf(s.carol))).toBe(true);
  });

  it("throttles cursor frames to a burst and drops the rest without failing", () => {
    const s = setup();
    const code = newRoom(s);
    let sent = 0;
    s.test.withReducerTx(s.alice, (ctx) => {
      for (let i = 0; i < 20; i++) mod.sendCursor(ctx, { code, x: i, y: i });
      sent = [...ctx.db.cursorEvt.iter()].length;
    });
    expect(sent).toBe(3);
  });
});

describe("laps", () => {
  it("keeps only the best lap per course and identity and rejects impossible times", () => {
    const s = setup();
    const lap = (timeMs: number) => s.call(s.alice, (ctx) => mod.submitLap(ctx, { course: "quad5-gates", timeMs, inputs: "[]", name: undefined }));
    lap(40_000);
    lap(35_000);
    lap(50_000);
    const rows = [...s.test.db.leaderboard.iter()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bestMs).toBe(35_000);
    expect([...s.test.db.lap.iter()]).toHaveLength(3);
    expect(() => lap(10)).toThrow("outside");
    expect(() => s.call(s.alice, (ctx) => mod.submitLap(ctx, { course: "Bad Course", timeMs: 5000, inputs: "[]", name: undefined }))).toThrow("bad course");
  });
});

describe("worker auth", () => {
  it("refuses worker reducers from anyone who has not registered", () => {
    const s = setup();
    expect(() => s.call(s.alice, (ctx) => mod.workerJobStatus(ctx, { jobId: 1n, status: "done", result: undefined, error: undefined }))).toThrow("worker only");
  });
});

describe("submit_run", () => {
  const WALLET = "4Nd1mYQ7mCF3x9bX8f3Z5r2yTn5pU6hQm9o3Q1vK7w2a";

  it("needs a wallet, queues a credential job for a clean run, and refuses a repeat", () => {
    const s = setup();
    const run = runText(GOOD_EVENTS);
    expect(() => s.call(s.alice, (ctx) => mod.submitRun(ctx, { kind: "drone-safety", itemId: "quad5", sub: undefined, run }))).toThrow("wallet");
    s.call(s.alice, (ctx) => mod.linkWallet(ctx, { wallet: WALLET }));
    s.call(s.alice, (ctx) => mod.submitRun(ctx, { kind: "drone-safety", itemId: "quad5", sub: undefined, run }));
    const jobs = [...s.test.db.chainJob.iter()];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "issue_credential", status: "queued" });
    expect(JSON.parse(jobs[0]!.payload)).toMatchObject({ skillId: "drone:quad5:safety", score: 100, wallet: WALLET });
    expect(() => s.call(s.alice, (ctx) => mod.submitRun(ctx, { kind: "drone-safety", itemId: "quad5", sub: undefined, run }))).toThrow("already");
  });

  it("refuses a run that does not replay clean", () => {
    const s = setup();
    s.call(s.alice, (ctx) => mod.linkWallet(ctx, { wallet: WALLET }));
    const bad = runText([{ ...GOOD_EVENTS[0]!, smokeOk: false, motorOk: false }, { type: "add", id: "PROPS", orient: 0 }]);
    expect(() => s.call(s.alice, (ctx) => mod.submitRun(ctx, { kind: "drone-safety", itemId: "quad5", sub: undefined, run: bad }))).toThrow("replay did not pass");
    expect([...s.test.db.chainJob.iter()]).toHaveLength(0);
  });
});

describe("schedules", () => {
  const timer = (job: string) => ({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(1n), job });
  const at = (minutes: number) => new Timestamp(BigInt(minutes) * 60_000_000n + 1_000_000_000_000n);

  it("deletes rooms 30 minutes after they empty, with their history, and keeps busy ones", () => {
    const s = setup();
    s.test.clock.set(at(0));
    const code = newRoom(s);
    s.call(s.alice, (ctx) => mod.submitAction(ctx, { code, action: JSON.stringify({ type: "bench/run" }) }));
    s.call(s.alice, (ctx) => mod.leaveRoom(ctx, { code }));
    s.call(s.bob, (ctx) => mod.leaveRoom(ctx, { code }));
    s.test.clock.set(at(20));
    s.call(TestAuth.internal(), (ctx) => mod.sweep(ctx, { timer: timer("rooms") }));
    expect(s.test.db.room.count()).toBe(1n);
    s.test.clock.set(at(31));
    s.call(TestAuth.internal(), (ctx) => mod.sweep(ctx, { timer: timer("rooms") }));
    expect(s.test.db.room.count()).toBe(0n);
    expect(s.test.db.roomAction.count()).toBe(0n);
  });

  it("lets only the scheduler run a sweep or close a race", () => {
    const s = setup();
    expect(() => s.call(s.alice, (ctx) => mod.sweep(ctx, { timer: timer("rooms") }))).toThrow("scheduler only");
    expect(() =>
      s.call(s.alice, (ctx) => mod.closeRace(ctx, { timer: { scheduledId: 0n, scheduledAt: ScheduleAt.interval(1n), raceId: 1n } })),
    ).toThrow("scheduler only");
  });

  it("expires buddies after 24 hours", () => {
    const s = setup();
    s.test.clock.set(at(0));
    s.call(s.alice, (ctx) =>
      mod.upsertBuddy(ctx, { name: "Ada", lang: "en", interests: '["fpv"]', built: '["drone:quad5:safety"]', wants: "find a pilot" }),
    );
    expect(s.test.db.buddyProfile.count()).toBe(1n);
    s.test.clock.set(at(23 * 60));
    s.call(TestAuth.internal(), (ctx) => mod.sweep(ctx, { timer: timer("buddies") }));
    expect(s.test.db.buddyProfile.count()).toBe(1n);
    s.test.clock.set(at(25 * 60));
    s.call(TestAuth.internal(), (ctx) => mod.sweep(ctx, { timer: timer("buddies") }));
    expect(s.test.db.buddyProfile.count()).toBe(0n);
  });

  it("rate limits the token bucket per identity", () => {
    const s = setup();
    s.test.clock.set(at(0));
    const send = () => s.call(s.alice, (ctx) => mod.setProfile(ctx, { name: "Ada", color: "#ef6a4c", lang: "en" }));
    for (let i = 0; i < 10; i++) send();
    expect(send).toThrow("rate limited");
    s.test.clock.set(new Timestamp(at(0).microsSinceUnixEpoch + 10_000_000n));
    send();
  });
});
