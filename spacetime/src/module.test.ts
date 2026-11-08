import { describe, expect, it } from "vitest";
import { ConnectionId, ScheduleAt, Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import spacetimedb, * as mod from "./index";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { GOOD_EVENTS, lapInputsFor, runText } from "./fixtures";
import { linkMessage } from "./profile";

const auth = (name: string, n: bigint) =>
  TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: name }), new ConnectionId(n));

const SECRET = ed25519.utils.randomPrivateKey();
const WALLET_KEY = bs58.encode(ed25519.getPublicKey(SECRET));

/** The reducer args a wallet owner would send: the wallet signs the message that names the caller's identity. */
const linkArgs = (s: ReturnType<typeof setup>, who: import("spacetimedb/server/test-utils").TestAuth, secret = SECRET) => {
  const wallet = bs58.encode(ed25519.getPublicKey(secret));
  const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(linkMessage(s.idOf(who).toHexString())), secret));
  return { wallet, signature };
};

const link = (s: ReturnType<typeof setup>, who: import("spacetimedb/server/test-utils").TestAuth, secret = SECRET) => {
  const args = linkArgs(s, who, secret);
  s.call(who, (ctx) => mod.linkWallet(ctx, args));
};

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
  it("makes an 8 character code, hosts the creator and gives them the baton", () => {
    const s = setup();
    const code = newRoom(s);
    expect(code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
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
  const BOARD = "quad5-race";
  const lap = (s: ReturnType<typeof setup>, timeMs: number, inputs = lapInputsFor(timeMs), course = BOARD, who = s.alice) =>
    s.call(who, (ctx) => mod.submitLap(ctx, { course, timeMs, inputs, name: undefined }));

  it("keeps only the best verified lap per course and identity", () => {
    const s = setup();
    lap(s, 40_000);
    lap(s, 35_000);
    lap(s, 50_000);
    const rows = [...s.test.db.leaderboard.iter()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bestMs).toBe(35_000);
    expect([...s.test.db.lap.iter()].every((l) => l.verified)).toBe(true);
    expect(() => lap(s, 10)).toThrow("outside");
    expect(() => lap(s, 5000, "[]", "Bad Course")).toThrow("bad course");
  });

  it("stores a faked lap but keeps it off the board", () => {
    const s = setup();
    lap(s, 39_000);
    lap(s, 2_500); // faster than half the gold par on this course
    lap(s, 30_000, lapInputsFor(30_000, { log: null })); // no input log
    lap(s, 30_000, lapInputsFor(30_000, { log: [{ step: 0, action: { type: "sticks" } }] })); // never arms
    lap(s, 30_000, lapInputsFor(30_000, { craft: "nope" }));
    lap(s, 30_000, lapInputsFor(30_000, { time: 12 })); // header disagrees with the claim
    lap(s, 30_000, lapInputsFor(30_000, { steps: 100 })); // fewer physics steps than the lap needs
    lap(s, 30_000, "[]");
    lap(s, 30_000, lapInputsFor(30_000), "quad5-bando"); // board is not the course flown
    const board = [...s.test.db.leaderboard.iter()];
    expect(board).toHaveLength(1);
    expect(board[0]!.bestMs).toBe(39_000);
    expect([...s.test.db.lap.iter()].filter((l) => l.verified)).toHaveLength(1);
  });

  it("does not let an unverified lap set a race result", () => {
    const s = setup();
    const raceId = s.test.withReducerTx(TestAuth.internal(), (ctx) =>
      ctx.db.race.insert({ id: 0n, onchain: "R1", course: BOARD, entryLamports: 1n, potLamports: 1n, closesAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + 600_000_000n), status: "open", settleSig: undefined }).id,
    );
    link(s, s.alice);
    s.call(s.alice, (ctx) => mod.enterRace(ctx, { raceId, enterSig: "5".repeat(88) }));
    lap(s, 2_500);
    expect([...s.test.db.raceEntry.iter()][0]!.bestMs).toBeUndefined();
    lap(s, 31_000);
    expect([...s.test.db.raceEntry.iter()][0]!.bestMs).toBe(31_000);
  });

  it("refuses a daily board that is not for today", () => {
    const s = setup();
    lap(s, 31_000, lapInputsFor(31_000), "daily-19990101");
    expect(s.test.db.leaderboard.count()).toBe(0n);
  });
});

describe("authorization", () => {
  it("lets only the host post a room snapshot", () => {
    const s = setup();
    const code = newRoom(s);
    const state = JSON.stringify({ v: 1, state: {} });
    expect(() => s.call(s.bob, (ctx) => mod.postSnapshot(ctx, { code, seq: 0n, state }))).toThrow("not_host");
    s.call(s.alice, (ctx) => mod.postSnapshot(ctx, { code, seq: 0n, state }));
  });

  it("keeps outsiders out of a room's chat, actions and presence", () => {
    const s = setup();
    const code = newRoom(s);
    expect(() => s.call(s.carol, (ctx) => mod.sendChat(ctx, { code, text: "hi", lang: "en", kind: "text" }))).toThrow("not_member");
    expect(() => s.call(s.carol, (ctx) => mod.submitAction(ctx, { code, action: JSON.stringify({ type: "select", id: "x" }) }))).toThrow("not_member");
    expect(() => s.call(s.carol, (ctx) => mod.setPresence(ctx, { code, role: undefined, labRole: undefined, status: "x", name: undefined, done: undefined }))).toThrow("not_member");
    expect(() => s.call(s.carol, (ctx) => mod.passBaton(ctx, { code, to: undefined }))).toThrow("not_member");
    s.call(s.carol, (ctx) => mod.sendCursor(ctx, { code, x: 1, y: 1 }));
    expect(s.test.db.cursorEvt.count()).toBe(0n);
    expect(s.test.db.chatMessage.count()).toBe(0n);
  });

  it("lets only the host kick, and a kicked identity cannot rejoin", () => {
    const s = setup();
    const code = newRoom(s);
    const bob = s.idOf(s.bob);
    const alice = s.idOf(s.alice);
    expect(() => s.call(s.bob, (ctx) => mod.kick(ctx, { code, target: alice }))).toThrow("not_host");
    s.call(s.alice, (ctx) => mod.kick(ctx, { code, target: bob }));
    expect(() => s.call(s.bob, (ctx) => mod.joinRoom(ctx, { code, lab: undefined, itemId: undefined }))).toThrow("kicked");
  });

  it("lets only the owner cancel a job or resolve its proposal, and caps jobs in flight", () => {
    const s = setup();
    const start = (who: TestAuth) => s.call(who, (ctx) => mod.startAgentJob(ctx, { kind: "diagnose", goal: "why", context: "{}", roomCode: undefined }));
    start(s.alice);
    const job = [...s.test.db.agentJob.iter()][0]!;
    expect(() => s.call(s.bob, (ctx) => mod.cancelAgentJob(ctx, { jobId: job.id }))).toThrow("not your job");
    const proposal = s.test.withReducerTx(TestAuth.internal(), (ctx) => ctx.db.agentProposal.insert({ id: 0n, jobId: job.id, kind: "x", payload: "{}", status: "pending", at: ctx.timestamp }));
    expect(() => s.call(s.bob, (ctx) => mod.resolveProposal(ctx, { proposalId: proposal.id, accept: true }))).toThrow("not your job");
    start(s.alice);
    start(s.alice);
    expect(() => start(s.alice)).toThrow("already have jobs");
    expect(() => s.call(s.alice, (ctx) => mod.startAgentJob(ctx, { kind: "diagnose", goal: "x", context: "{}", roomCode: "zzzzzzzz" }))).toThrow();
  });

  it("refuses a room job for someone who is not in the room, and oversized goals", () => {
    const s = setup();
    const code = newRoom(s);
    expect(() => s.call(s.carol, (ctx) => mod.startAgentJob(ctx, { kind: "plan", goal: "x", context: "{}", roomCode: code }))).toThrow("not in that room");
    expect(() => s.call(s.alice, (ctx) => mod.startAgentJob(ctx, { kind: "plan", goal: "x".repeat(2001), context: "{}", roomCode: undefined }))).toThrow("over");
    expect(() => s.call(s.alice, (ctx) => mod.startAgentJob(ctx, { kind: "plan", goal: "x", context: "x".repeat(40_000), roomCode: undefined }))).toThrow("over");
  });

  it("refuses every worker-only reducer from a client", () => {
    const s = setup();
    const only = (run: () => unknown) => expect(run).toThrow("worker only");
    const as = (fn: (ctx: never) => unknown) => () => s.call(s.alice, fn as never);
    only(as((ctx) => mod.workerStepStart(ctx, { jobId: 1n, idx: 0, role: "planner", title: "t", tool: undefined, input: "{}", model: undefined })));
    only(as((ctx) => mod.workerStepFinish(ctx, { jobId: 1n, idx: 0, output: "{}", status: "ok", ms: 1 })));
    only(as((ctx) => mod.workerAddProposal(ctx, { jobId: 1n, kind: "x", payload: "{}" })));
    only(as((ctx) => mod.workerSetTranslation(ctx, { messageId: 1n, lang: "en", text: "x" })));
    only(as((ctx) => mod.workerQueueChainJob(ctx, { kind: "settle_race", payload: "{}" })));
    only(as((ctx) => mod.workerChainResult(ctx, { jobId: 1n, status: "confirmed", sig: undefined, error: undefined, pda: undefined })));
    only(as((ctx) => mod.workerUpsertRace(ctx, { onchain: "x", course: "c", entryLamports: 1n, potLamports: 1n, closesAt: new Timestamp(1n), status: "open", settleSig: undefined })));
    only(as((ctx) => mod.workerRaceEntryResult(ctx, { entryId: 1n, verified: true, bestMs: 1, lapId: undefined, resultSig: undefined, payoutLamports: undefined })));
  });

  it("refuses a wallet link whose signature is not the wallet's, or is for another identity", () => {
    const s = setup();
    const mine = linkArgs(s, s.alice);
    const forBob = linkArgs(s, s.bob);
    const other = ed25519.utils.randomPrivateKey();
    expect(() => s.call(s.alice, (ctx) => mod.linkWallet(ctx, forBob))).toThrow("signature");
    expect(() => s.call(s.alice, (ctx) => mod.linkWallet(ctx, { wallet: bs58.encode(ed25519.getPublicKey(other)), signature: mine.signature }))).toThrow("signature");
    expect(() => s.call(s.alice, (ctx) => mod.linkWallet(ctx, { wallet: mine.wallet, signature: "nonsense" }))).toThrow("signature");
    s.call(s.alice, (ctx) => mod.linkWallet(ctx, mine));
  });

  it("moves a wallet to the identity that proves it holds it", () => {
    const s = setup();
    link(s, s.alice);
    link(s, s.bob);
    const rows = [...s.test.db.playerWallet.iter()];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identity.isEqual(s.idOf(s.bob))).toBe(true);
  });
});

describe("worker auth", () => {
  it("refuses worker reducers from anyone who has not registered", () => {
    const s = setup();
    expect(() => s.call(s.alice, (ctx) => mod.workerJobStatus(ctx, { jobId: 1n, status: "done", result: undefined, error: undefined }))).toThrow("worker only");
  });
});

describe("submit_run", () => {
  const WALLET = WALLET_KEY;

  it("needs a wallet, queues a credential job for a clean run, and refuses a repeat", () => {
    const s = setup();
    const run = runText(GOOD_EVENTS);
    expect(() => s.call(s.alice, (ctx) => mod.submitRun(ctx, { kind: "drone-safety", itemId: "quad5", sub: undefined, run }))).toThrow("wallet");
    link(s, s.alice);
    s.call(s.alice, (ctx) => mod.submitRun(ctx, { kind: "drone-safety", itemId: "quad5", sub: undefined, run }));
    const jobs = [...s.test.db.chainJob.iter()];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "issue_credential", status: "queued" });
    expect(JSON.parse(jobs[0]!.payload)).toMatchObject({ skillId: "drone:quad5:safety", score: 100, wallet: WALLET });
    expect(() => s.call(s.alice, (ctx) => mod.submitRun(ctx, { kind: "drone-safety", itemId: "quad5", sub: undefined, run }))).toThrow("already");
  });

  it("refuses a run that does not replay clean", () => {
    const s = setup();
    link(s, s.alice);
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
