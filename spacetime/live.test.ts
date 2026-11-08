// Drives a published module over real WebSockets with several identities.
// Run it with: STDB_LIVE=1 npm run stdb:test   (needs `npm run stdb:start` and `npm run stdb:publish`)
import { describe, expect, it } from "vitest";
import type { Identity } from "spacetimedb";
import { DbConnection } from "../src/lib/stdb/bindings";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { linkMessage } from "../src/lib/stdb/link-message";
import { GOOD_EVENTS, lapInputsFor, runText } from "./src/fixtures";

const URI = process.env.STDB_URI ?? "ws://127.0.0.1:3100";
const DB = process.env.STDB_DB ?? "iynk";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "dev-worker-secret";
const WALLET_SECRET = ed25519.utils.randomPrivateKey();
const WALLET = bs58.encode(ed25519.getPublicKey(WALLET_SECRET));
const signLink = (hex: string, secret = WALLET_SECRET) => bs58.encode(ed25519.sign(new TextEncoder().encode(linkMessage(hex)), secret));
const link = (c: { conn: DbConnection; hex: string }) => c.conn.reducers.linkWallet({ wallet: WALLET, signature: signLink(c.hex) });

type Client = Awaited<ReturnType<typeof connect>>;

function connect() {
  return new Promise<{ conn: DbConnection; hex: string; identity: Identity }>((resolve, reject) => {
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
    const room = await until(() => [...a.conn.db.myRooms.iter()].find((r) => r.host.isEqual(a.identity)), "room");
    const code = room.code;
    expect(code).toMatch(/^[2-9a-z]{8}$/);

    await b.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined });
    await until(() => [...b.conn.db.myRoomMembers.iter()].filter((m) => m.roomCode === code).length === 2, "two members in b's cache");
    const mine = [...a.conn.db.myRoomMembers.iter()].find((m) => m.identity.isEqual(a.identity))!;
    expect(mine).toMatchObject({ name: "Ada", role: "host", baton: true });

    await rejects(b.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/run" }) }), "no_baton");
    await b.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "select", id: "m1" }) });
    await a.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/run" }) });
    await a.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/add" }) });
    const seen = await until(() => {
      const rows = [...b.conn.db.myRoomActions.iter()].filter((r) => r.roomCode === code);
      return rows.length === 3 && rows;
    }, "three actions on b");
    expect(seen.map((r) => r.seq).sort((x, y) => Number(x - y))).toEqual([1n, 2n, 3n]);

    await a.conn.reducers.postSnapshot({ code, seq: 3n, state: JSON.stringify({ v: 1, state: {} }) });
    await c.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined });
    const snap = await until(() => [...c.conn.db.myRoomSnapshots.iter()].find((s) => s.roomCode === code), "snapshot on late joiner");
    expect(snap.seq).toBe(3n);

    await b.conn.reducers.sendChat({ code, text: "hello", lang: "en", kind: "text" });
    const msg = await until(() => [...c.conn.db.myChat.iter()].find((m) => m.text === "hello"), "chat on c");
    expect(msg.name).toMatch(/guest-/);

    await rejects(b.conn.reducers.kick({ code, target: c.identity }), "not_host");
    await a.conn.reducers.kick({ code, target: c.identity });
    await until(() => ![...a.conn.db.myRoomMembers.iter()].some((m) => m.identity.isEqual(c.identity)), "c removed");
    await rejects(c.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined }), "kicked");

    await a.conn.reducers.leaveRoom({ code });
    const host = await until(() => {
      const r = [...b.conn.db.myRooms.iter()].find((x) => x.code === code);
      return r && r.host.isEqual(b.identity) && r;
    }, "host handoff to b");
    expect(host.host.isEqual(b.identity)).toBe(true);

    // Dropping the connection removes the last member (the empty-room clock is covered by the module tests).
    // A room only its members can see is gone from everyone else's view, including a former member's.
    b.conn.disconnect();
    expect([...a.conn.db.myRooms.iter()].filter((x) => x.code === code)).toHaveLength(0);
    for (const x of [a, c]) x.conn.disconnect();
  });

  it("laps keep the best time; progress comes back through the view; events reach other members", async () => {
    const [a, b] = [await connect(), await connect()];
    const course = "quad5-race";
    await a.conn.reducers.submitLap({ course, timeMs: 42_000, inputs: lapInputsFor(42000), name: undefined });
    await a.conn.reducers.submitLap({ course, timeMs: 39_500, inputs: lapInputsFor(39500), name: undefined });
    await a.conn.reducers.submitLap({ course, timeMs: 44_000, inputs: lapInputsFor(44000), name: undefined });
    const row = await until(() => {
      const rows = [...b.conn.db.leaderboard.iter()].filter((l) => l.course === course && l.identity.isEqual(a.identity));
      return rows.length === 1 && rows[0]!.bestMs === 39_500 && rows[0];
    }, "leaderboard row");
    expect(row.bestMs).toBe(39_500);
    await rejects(a.conn.reducers.submitLap({ course, timeMs: 5, inputs: "[]", name: undefined }), "outside");
    // A faked 2.5 s lap is stored but never reaches the board.
    await a.conn.reducers.submitLap({ course, timeMs: 2_500, inputs: lapInputsFor(2500), name: undefined });
    await new Promise((r) => setTimeout(r, 300));
    expect([...b.conn.db.leaderboard.iter()].find((l) => l.course === course && l.identity.isEqual(a.identity))!.bestMs).toBe(39_500);

    await a.conn.reducers.recordProgress({ key: "board:uno-r3:blink" });
    await until(() => [...a.conn.db.myProgress.iter()].some((p) => p.key === "board:uno-r3:blink"), "my_progress");
    expect([...b.conn.db.myProgress.iter()]).toHaveLength(0);

    await a.conn.reducers.createRoom({ lab: "drone", itemId: "quad5" });
    const code = (await until(() => [...a.conn.db.myRooms.iter()].find((r) => r.host.isEqual(a.identity)), "room")).code;
    await b.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined });
    const cursors: number[] = [];
    b.conn.db.cursorEvt.onInsert((_ctx, e) => cursors.push(e.x));
    await until(() => [...b.conn.db.myRoomMembers.iter()].filter((m) => m.roomCode === code).length === 2, "b joined");
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
    const job = await until(() => [...worker.conn.db.workerAgentJobs.iter()].find((j) => j.owner.isEqual(user.identity) && j.status === "queued"), "queued job");

    await worker.conn.reducers.workerJobStatus({ jobId: job.id, status: "planning", result: undefined, error: undefined });
    await worker.conn.reducers.workerStepStart({ jobId: job.id, idx: 0, role: "planner", title: "Plan", tool: undefined, input: "{}", model: "nemotron" });
    await worker.conn.reducers.workerStepFinish({ jobId: job.id, idx: 0, output: '{"plan":["check props"]}', status: "ok", ms: 120 });
    await worker.conn.reducers.workerAddProposal({ jobId: job.id, kind: "swap-part", payload: '{"part":"PROPS"}' });
    const proposal = await until(() => [...user.conn.db.myAgentProposals.iter()].find((p) => p.jobId === job.id), "proposal");
    await rejects(stranger.conn.reducers.resolveProposal({ proposalId: proposal.id, accept: true }), "not your job");
    await user.conn.reducers.resolveProposal({ proposalId: proposal.id, accept: true });
    await worker.conn.reducers.workerJobStatus({ jobId: job.id, status: "done", result: '{"ok":true}', error: undefined });
    const done = await until(() => [...user.conn.db.agentJob.iter()].find((j) => j.id === job.id && j.status === "done"), "done job");
    expect(done.result).toBe('{"ok":true}');
    const steps = [...user.conn.db.myAgentSteps.iter()].filter((s) => s.jobId === job.id);
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
    await link(user);
    const tampered = runText([{ ...GOOD_EVENTS[0]!, smokeOk: false, motorOk: false }, { type: "add", id: "PROPS", orient: 0 }], { itemId: "racer" });
    await rejects(user.conn.reducers.submitRun({ kind: "drone-safety", itemId: "racer", sub: undefined, run: tampered }), "replay did not pass");

    await user.conn.reducers.submitRun({ kind: "drone-safety", itemId: "quad5", sub: undefined, run: runText(GOOD_EVENTS) });
    const job = await until(() => [...worker.conn.db.workerChainJobs.iter()].find((j) => j.kind === "issue_credential" && j.payload.includes(user.hex)), "chain job");
    await worker.conn.reducers.workerChainResult({ jobId: job.id, status: "confirmed", sig: "sig1", error: undefined, pda: "PDA1" });
    const cred = await until(() => [...user.conn.db.credential.iter()].find((c) => c.identity.isEqual(user.identity)), "credential");
    expect(cred).toMatchObject({ skill: "drone:quad5:safety", pda: "PDA1", wallet: WALLET });
    user.conn.disconnect();
    worker.conn.disconnect();
  });

  it("races: entry, best time from a lap, close queues results and settlement", async () => {
    const [user, worker] = [await connect(), await connect()];
    await worker.conn.reducers.workerRegister({ secret: WORKER_SECRET });
    await link(user);
    const course = "quad5-race";
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
    await user.conn.reducers.submitLap({ course, timeMs: 31_000, inputs: lapInputsFor(31000), name: undefined });
    const entry = await until(() => [...user.conn.db.raceEntry.iter()].find((e) => e.raceId === race.id && e.bestMs === 31_000), "entry with best time");
    expect(entry.lapId).toBeDefined();
    const settle = await until(
      () => [...worker.conn.db.workerChainJobs.iter()].find((j) => j.kind === "settle_race" && j.payload.includes(onchain)),
      "settle_race job after close",
      9000,
    );
    expect(JSON.parse(settle.payload).ranking[0].bestMs).toBe(31_000);
    expect([...worker.conn.db.race.iter()].find((r) => r.id === race.id)!.status).toBe("closed");
    expect([...worker.conn.db.workerChainJobs.iter()].some((j) => j.kind === "submit_result" && j.payload.includes(onchain))).toBe(true);
    await rejects(user.conn.reducers.enterRace({ raceId: race.id, enterSig: "6".repeat(88) }), "closed");
    user.conn.disconnect();
    worker.conn.disconnect();
  });

  it("procedures answer 'not configured' without keys instead of crashing", async () => {
    const a = await connect();
    await a.conn.reducers.createRoom({ lab: "board", itemId: "uno-r3" });
    const code = (await until(() => [...a.conn.db.myRooms.iter()].find((r) => r.host.isEqual(a.identity)), "room")).code;
    await a.conn.reducers.sendChat({ code, text: "hola", lang: "es", kind: "text" });
    const msg = await until(() => [...a.conn.db.myChat.iter()].find((m) => m.roomCode === code), "message");
    const t = await a.conn.procedures.translateMessage({ messageId: msg.id, lang: "en" });
    expect(t.ok === false ? t.error : "configured").toMatch(/not configured|upstream_failed/);
    const s = await a.conn.procedures.searchWeb({ query: "tb6612fng datasheet" });
    expect(s.ok === false ? s.error : "configured").toMatch(/not configured|upstream_failed/);
    a.conn.disconnect();
  });

  it("security: an outsider sees nothing of a room and cannot write into it", async () => {
    const [a, b, outsider] = [await connect(), await connect(), await connect()];
    await a.conn.reducers.createRoom({ lab: "drone", itemId: "quad5" });
    const code = (await until(() => [...a.conn.db.myRooms.iter()].find((r) => r.host.isEqual(a.identity)), "room")).code;
    await b.conn.reducers.joinRoom({ code, lab: undefined, itemId: undefined });
    await a.conn.reducers.sendChat({ code, text: "secret plan", lang: "en", kind: "text" });
    await a.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/run" }) });
    await a.conn.reducers.postSnapshot({ code, seq: 1n, state: JSON.stringify({ v: 1, state: {} }) });
    await a.conn.reducers.sendCursor({ code, x: 1, y: 2 });
    await until(() => [...b.conn.db.myChat.iter()].some((m) => m.text === "secret plan"), "member sees chat");
    await until(() => [...b.conn.db.myRoomSnapshots.iter()].length === 1, "member sees snapshot");

    expect([...outsider.conn.db.myRooms.iter()].filter((r) => r.code === code)).toHaveLength(0);
    expect([...outsider.conn.db.myRoomMembers.iter()]).toHaveLength(0);
    expect([...outsider.conn.db.myRooms.iter()]).toHaveLength(0);
    // Pose and cursor events are public, but carry an opaque topic, never the join code.
    const topic = (await until(() => [...a.conn.db.myRooms.iter()].find((r) => r.code === code), "own room")).topic;
    expect(topic).not.toContain(code);
    expect(topic).toMatch(/^[0-9a-f]{16}$/);
    expect([...outsider.conn.db.myChat.iter()].filter((m) => m.roomCode === code)).toHaveLength(0);
    expect([...outsider.conn.db.myRoomActions.iter()].filter((m) => m.roomCode === code)).toHaveLength(0);
    expect([...outsider.conn.db.myRoomSnapshots.iter()].filter((m) => m.roomCode === code)).toHaveLength(0);
    expect([...outsider.conn.db.myChatTranslations.iter()].filter((m) => m.roomCode === code)).toHaveLength(0);

    await rejects(outsider.conn.reducers.sendChat({ code, text: "hi", lang: "en", kind: "text" }), "not_member");
    await rejects(outsider.conn.reducers.submitAction({ code, action: JSON.stringify({ type: "bench/run" }) }), "not_member");
    await rejects(outsider.conn.reducers.passBaton({ code, to: outsider.identity }), "not_member");
    await rejects(outsider.conn.reducers.postSnapshot({ code, seq: 1n, state: "{}" }), "not_host");
    await rejects(outsider.conn.reducers.kick({ code, target: b.identity }), "not_host");
    await rejects(b.conn.reducers.postSnapshot({ code, seq: 1n, state: "{}" }), "not_host");
    await rejects(outsider.conn.reducers.joinRoom({ code: "zzzzzzzz", lab: undefined, itemId: undefined }), "room_not_found");
    for (const x of [a, b, outsider]) x.conn.disconnect();
  });

  it("security: agent jobs, steps and proposals belong to their owner; the worker feed is the worker's", async () => {
    const [owner, worker, stranger] = [await connect(), await connect(), await connect()];
    const goal = `private goal ${Date.now()}`;
    await worker.conn.reducers.workerRegister({ secret: WORKER_SECRET });
    await owner.conn.reducers.startAgentJob({ kind: "diagnose", goal, context: '{"note":"private"}', roomCode: undefined });
    const job = await until(() => [...worker.conn.db.workerAgentJobs.iter()].find((j) => j.goal === goal), "worker sees the job");
    await until(() => [...owner.conn.db.agentJob.iter()].find((j) => j.id === job.id), "owner sees the job");
    await new Promise((r) => setTimeout(r, 300));
    await worker.conn.reducers.workerStepStart({ jobId: job.id, idx: 0, role: "planner", title: "Plan", tool: undefined, input: "{}", model: undefined });
    await worker.conn.reducers.workerAddProposal({ jobId: job.id, kind: "x", payload: "{}" });
    await until(() => [...owner.conn.db.myAgentSteps.iter()].length > 0, "owner sees the step");
    await until(() => [...owner.conn.db.myAgentProposals.iter()].length > 0, "owner sees the proposal");
    expect([...owner.conn.db.agentJob.iter()].some((j) => j.goal === goal)).toBe(true);

    await new Promise((r) => setTimeout(r, 400));
    expect([...stranger.conn.db.agentJob.iter()].filter((j) => j.goal === goal)).toHaveLength(0);
    expect([...stranger.conn.db.myAgentSteps.iter()].filter((x) => x.jobId === job.id)).toHaveLength(0);
    expect([...stranger.conn.db.myAgentProposals.iter()].filter((x) => x.jobId === job.id)).toHaveLength(0);
    expect([...stranger.conn.db.workerAgentJobs.iter()]).toHaveLength(0);
    expect([...stranger.conn.db.workerChainJobs.iter()]).toHaveLength(0);
    expect([...owner.conn.db.workerAgentJobs.iter()]).toHaveLength(0);
    await rejects(stranger.conn.reducers.cancelAgentJob({ jobId: job.id }), "not your job");
    await rejects(stranger.conn.reducers.workerRegister({ secret: "nope-nope-nope-nope" }), "bad worker secret");
    await rejects(stranger.conn.reducers.workerAddProposal({ jobId: job.id, kind: "x", payload: "{}" }), "worker only");
    for (const x of [owner, worker, stranger]) x.conn.disconnect();
  });

  it("security: wallet links need the wallet's signature; credentials jobs show to their owner only", async () => {
    const [user, stranger] = [await connect(), await connect()];
    await rejects(user.conn.reducers.linkWallet({ wallet: WALLET, signature: signLink(stranger.hex) }), "signature");
    await rejects(user.conn.reducers.linkWallet({ wallet: WALLET, signature: signLink(user.hex, ed25519.utils.randomPrivateKey()) }), "signature");
    await link(user);
    await until(() => [...user.conn.db.myWallet.iter()].some((w) => w.wallet === WALLET), "own wallet through my_wallet");
    expect([...stranger.conn.db.myWallet.iter()]).toHaveLength(0);
    await user.conn.reducers.submitRun({ kind: "drone-safety", itemId: "quad5", sub: undefined, run: runText(GOOD_EVENTS) }).catch(() => {});
    await until(() => [...user.conn.db.myChainJobs.iter()].some((j) => j.payload.includes(user.hex)), "own chain job");
    expect([...stranger.conn.db.myChainJobs.iter()]).toHaveLength(0);
    for (const x of [user, stranger]) x.conn.disconnect();
  });
});
