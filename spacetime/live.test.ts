// Drives a published module over real WebSockets with several identities.
// Run it with: STDB_LIVE=1 npm run stdb:test   (needs `npm run stdb:start` and `npm run stdb:publish`)
import { describe, expect, it } from "vitest";
import { DbConnection } from "../src/lib/stdb/bindings";
import { GOOD_EVENTS, runText } from "./src/fixtures";

const URI = process.env.STDB_URI ?? "ws://127.0.0.1:3100";
const DB = process.env.STDB_DB ?? "iynk";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "dev-worker-secret";
const WALLET = "4Nd1mYQ7mCF3x9bX8f3Z5r2yTn5pU6hQm9o3Q1vK7w2a";

type Client = Awaited<ReturnType<typeof connect>>;

function connect() {
  return new Promise<{ conn: DbConnection; hex: string; identity: DbConnection["identity"] }>((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnectError((_c, error) => reject(error))
      .onConnect((conn, identity) => {
        conn.subscriptionBuilder().onApplied(() => resolve({ conn, hex: identity.toHexString(), identity })).subscribeToAllTables();
      })
      .build();
  });
}

async function until<T>(read: () => T | undefined | false, what: string, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const rejects = async (p: Promise<unknown>, text: string) => {
  await expect(p).rejects.toThrow(text);
};

describe.skipIf(!process.env.STDB_LIVE)("live module", () => {
  it("rooms: join order, baton, snapshots, chat, kick and host handoff", async () => {
    const [a, b, c] = [await connect(), await connect(), await connect()];
    await a.conn.reducers.setProfile({ name: "Ada", color: "#ef6a4c", lang: "en" });
    await a.conn.reducers.createRoom({ lab: "drone", itemId: "quad5" });
    const room = await until(() => [...a.conn.db.room.iter()].find((r) => r.host.isEqual(a.identity)), "room");
    const code = room.code;
    expect(code).toMatch(/^[2-9a-z]{6}$/);

    await b.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined });
    await until(() => [...b.conn.db.roomMember.iter()].filter((m) => m.roomCode === code).length === 2, "two members in b's cache");
    const mine = [...a.conn.db.roomMember.iter()].find((m) => m.identity.isEqual(a.identity))!;
    expect(mine).toMatchObject({ name: "Ada", role: "host", baton: true });

    await rejects(b.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/run" }) }), "no_baton");
    await b.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "select", id: "m1" }) });
    await a.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/run" }) });
    await a.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/add" }) });
    const seen = await until(() => {
      const rows = [...b.conn.db.roomAction.iter()].filter((r) => r.roomCode === code);
      return rows.length === 3 && rows;
    }, "three actions on b");
    expect(seen.map((r) => r.seq).sort((x, y) => Number(x - y))).toEqual([1n, 2n, 3n]);

    await a.conn.reducers.postSnapshot({ code, seq: 3n, state: JSON.stringify({ v: 1, state: {} }) });
    await c.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined });
    const snap = await until(() => [...c.conn.db.roomSnapshot.iter()].find((s) => s.roomCode === code), "snapshot on late joiner");
    expect(snap.seq).toBe(3n);

    await b.conn.reducers.sendChat({ code, text: "hello", lang: "en", kind: "text" });
    const msg = await until(() => [...c.conn.db.chatMessage.iter()].find((m) => m.text === "hello"), "chat on c");
    expect(msg.name).toMatch(/guest-/);

    await rejects(b.conn.reducers.kick({ code, target: c.identity }), "not_host");
    await a.conn.reducers.kick({ code, target: c.identity });
    await until(() => ![...a.conn.db.roomMember.iter()].some((m) => m.identity.isEqual(c.identity)), "c removed");
    await rejects(c.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined }), "kicked");

    await a.conn.reducers.leaveRoom({ code });
    const host = await until(() => {
      const r = [...b.conn.db.room.iter()].find((x) => x.code === code);
      return r && r.host.isEqual(b.identity) && r;
    }, "host handoff to b");
    expect(host.host.isEqual(b.identity)).toBe(true);

    // Dropping the connection removes the last member and the room starts its 30 minute clock.
    b.conn.disconnect();
    await until(() => {
      const r = [...a.conn.db.room.iter()].find((x) => x.code === code);
      return r?.emptySince !== undefined && r;
    }, "room marked empty");
    for (const x of [a, c]) x.conn.disconnect();
  });

  it("laps keep the best time; progress comes back through the view; events reach other members", async () => {
    const [a, b] = [await connect(), await connect()];
    const course = `live-${Date.now() % 100000}`;
    await a.conn.reducers.submitLap({ course, timeMs: 42_000, inputs: "[]", name: undefined });
    await a.conn.reducers.submitLap({ course, timeMs: 39_500, inputs: "[]", name: undefined });
    await a.conn.reducers.submitLap({ course, timeMs: 44_000, inputs: "[]", name: undefined });
    const row = await until(() => {
      const rows = [...b.conn.db.leaderboard.iter()].filter((l) => l.course === course);
      return rows.length === 1 && rows[0]!.bestMs === 39_500 && rows[0];
    }, "leaderboard row");
    expect(row.bestMs).toBe(39_500);
    await rejects(a.conn.reducers.submitLap({ course, timeMs: 5, inputs: "[]", name: undefined }), "outside");

    await a.conn.reducers.recordProgress({ key: "board:uno-r3:blink" });
    await until(() => [...a.conn.db.myProgress.iter()].some((p) => p.key === "board:uno-r3:blink"), "my_progress");
    expect([...b.conn.db.myProgress.iter()]).toHaveLength(0);

    await a.conn.reducers.createRoom({ lab: "drone", itemId: "quad5" });
    const code = (await until(() => [...a.conn.db.room.iter()].find((r) => r.host.isEqual(a.identity)), "room")).code;
    await b.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined });
    const cursors: number[] = [];
    b.conn.db.cursorEvt.onInsert((_ctx, e) => cursors.push(e.x));
    await until(() => [...b.conn.db.roomMember.iter()].filter((m) => m.roomCode === code).length === 2, "b joined");
    for (let i = 0; i < 10; i++) a.conn.reducers.sendCursor({ code, x: i, y: 0 }).catch(() => {});
    await until(() => cursors.length > 0, "a cursor event");
    expect(cursors.length).toBeLessThanOrEqual(10);
    a.conn.disconnect();
    b.conn.disconnect();
  });

  it("agent job lifecycle through the worker reducers", async () => {
    const [user, worker, stranger] = [await connect(), await connect(), await connect()];
    await rejects(worker.conn.reducers.workerRegister({ secret: "wrong" }), "bad worker secret");
    await worker.conn.reducers.workerRegister({ secret: WORKER_SECRET });
    await rejects(stranger.conn.reducers.workerJobStatus({ jobId: 1n, status: "running", result: undefined, error: undefined }), "worker only");

    await rejects(user.conn.reducers.startAgentJob({ kind: "nonsense", goal: "x", context: "{}", roomCode: undefined }), "kind must be");
    await user.conn.reducers.startAgentJob({ kind: "diagnose", goal: "my quad flips on takeoff", context: "{}", roomCode: undefined });
    const job = await until(() => [...worker.conn.db.agentJob.iter()].find((j) => j.owner.isEqual(user.identity) && j.status === "queued"), "queued job");

    await worker.conn.reducers.workerJobStatus({ jobId: job.id, status: "planning", result: undefined, error: undefined });
    await worker.conn.reducers.workerStepStart({ jobId: job.id, idx: 0, role: "planner", title: "Plan", tool: undefined, input: "{}", model: "nemotron" });
    await worker.conn.reducers.workerStepFinish({ jobId: job.id, idx: 0, output: '{"plan":["check props"]}', status: "ok", ms: 120 });
    await worker.conn.reducers.workerAddProposal({ jobId: job.id, kind: "swap-part", payload: '{"part":"PROPS"}' });
    const proposal = await until(() => [...user.conn.db.agentProposal.iter()].find((p) => p.jobId === job.id), "proposal");
    await rejects(stranger.conn.reducers.resolveProposal({ proposalId: proposal.id, accept: true }), "not your job");
    await user.conn.reducers.resolveProposal({ proposalId: proposal.id, accept: true });
    await worker.conn.reducers.workerJobStatus({ jobId: job.id, status: "done", result: '{"ok":true}', error: undefined });
    const done = await until(() => [...user.conn.db.agentJob.iter()].find((j) => j.id === job.id && j.status === "done"), "done job");
    expect(done.result).toBe('{"ok":true}');
    const steps = [...user.conn.db.agentStep.iter()].filter((s) => s.jobId === job.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: "ok", ms: 120 });
    // A late status from a slow worker does not resurrect a finished job.
    await worker.conn.reducers.workerJobStatus({ jobId: job.id, status: "running", result: undefined, error: undefined });
    await user.conn.reducers.cancelAgentJob({ jobId: job.id });
    expect([...user.conn.db.agentJob.iter()].find((j) => j.id === job.id)!.status).toBe("done");
    for (const x of [user, worker, stranger]) x.conn.disconnect();
  });

  it("runs: a clean bench run queues a credential, a tampered one is refused; the worker confirms it", async () => {
    const [user, worker] = [await connect(), await connect()];
    await worker.conn.reducers.workerRegister({ secret: WORKER_SECRET });
    await user.conn.reducers.linkWallet({ wallet: WALLET });
    const tampered = runText([{ ...GOOD_EVENTS[0]!, smokeOk: false, motorOk: false }, { type: "add", id: "PROPS", orient: 0 }], { itemId: "racer" });
    await rejects(user.conn.reducers.submitRun({ kind: "drone-safety", itemId: "racer", sub: undefined, run: tampered }), "replay did not pass");

    await user.conn.reducers.submitRun({ kind: "drone-safety", itemId: "quad5", sub: undefined, run: runText(GOOD_EVENTS) });
    const job = await until(() => [...worker.conn.db.chainJob.iter()].find((j) => j.kind === "issue_credential" && j.payload.includes(user.hex)), "chain job");
    await worker.conn.reducers.workerChainResult({ jobId: job.id, status: "confirmed", sig: "sig1", error: undefined, pda: "PDA1" });
    const cred = await until(() => [...user.conn.db.credential.iter()].find((c) => c.identity.isEqual(user.identity)), "credential");
    expect(cred).toMatchObject({ skill: "drone:quad5:safety", pda: "PDA1", wallet: WALLET });
    user.conn.disconnect();
    worker.conn.disconnect();
  });

  it("races: entry, best time from a lap, close queues results and settlement", async () => {
    const [user, worker] = [await connect(), await connect()];
    await worker.conn.reducers.workerRegister({ secret: WORKER_SECRET });
    await user.conn.reducers.linkWallet({ wallet: WALLET });
    const course = `race-${Date.now() % 100000}`;
    const closes = new Date(Date.now() + 3000);
    const { Timestamp } = await import("spacetimedb");
    const onchain = `PDA${Date.now()}`;
    await worker.conn.reducers.workerUpsertRace({
      onchain, course, entryLamports: 1000n, potLamports: 0n, closesAt: Timestamp.fromDate(closes), status: "open", settleSig: undefined,
    });
    const race = await until(() => [...user.conn.db.race.iter()].find((r) => r.onchain === onchain), "race");
    const sig = "5".repeat(88);
    await user.conn.reducers.enterRace({ raceId: race.id, enterSig: sig });
    await rejects(user.conn.reducers.enterRace({ raceId: race.id, enterSig: sig }), "already in");
    await user.conn.reducers.submitLap({ course, timeMs: 31_000, inputs: "[]", name: undefined });
    const entry = await until(() => [...user.conn.db.raceEntry.iter()].find((e) => e.raceId === race.id && e.bestMs === 31_000), "entry with best time");
    expect(entry.lapId).toBeDefined();
    const settle = await until(
      () => [...worker.conn.db.chainJob.iter()].find((j) => j.kind === "settle_race" && j.payload.includes(onchain)),
      "settle_race job after close",
      9000,
    );
    expect(JSON.parse(settle.payload).ranking[0].bestMs).toBe(31_000);
    expect([...worker.conn.db.race.iter()].find((r) => r.id === race.id)!.status).toBe("closed");
    expect([...worker.conn.db.chainJob.iter()].some((j) => j.kind === "submit_result" && j.payload.includes(onchain))).toBe(true);
    await rejects(user.conn.reducers.enterRace({ raceId: race.id, enterSig: "6".repeat(88) }), "closed");
    user.conn.disconnect();
    worker.conn.disconnect();
  });

  it("procedures answer 'not configured' without keys instead of crashing", async () => {
    const a = await connect();
    await a.conn.reducers.createRoom({ lab: "board", itemId: "uno-r3" });
    const code = (await until(() => [...a.conn.db.room.iter()].find((r) => r.host.isEqual(a.identity)), "room")).code;
    await a.conn.reducers.sendChat({ code, text: "hola", lang: "es", kind: "text" });
    const msg = await until(() => [...a.conn.db.chatMessage.iter()].find((m) => m.roomCode === code), "message");
    const t = await a.conn.procedures.translateMessage({ messageId: msg.id, lang: "en" });
    expect(t.ok === false ? t.error : "configured").toMatch(/not configured|upstream_failed/);
    const s = await a.conn.procedures.searchWeb({ query: "tb6612fng datasheet" });
    expect(s.ok === false ? s.error : "configured").toMatch(/not configured|upstream_failed/);
    a.conn.disconnect();
  });
});
