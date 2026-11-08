import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LabKind, LabStore } from "@/components/dock/types";
import { FakeModule, identityOf } from "./__fixtures__/module";
import { RoomClient } from "./room";
import { attachStore } from "./store-sync";

type Act = { type: string; [key: string]: unknown };

type Drone = { pick: Record<string, string>; log: string[]; sel: string | null; tab: string };

function makeStore<S>(init: S, reduce: (s: S, a: Act) => S): LabStore<S, Act> {
  let state = init;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action) {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    },
  };
}

const droneInit: Drone = { pick: {}, log: [], sel: null, tab: "design" };

function droneReduce(s: Drone, a: Act): Drone {
  switch (a.type) {
    case "design/pick":
      return { ...s, pick: { ...s.pick, [String(a.key)]: String(a.value) }, log: [...s.log, `${String(a.key)}=${String(a.value)}`] };
    case "select":
      return { ...s, sel: (a.id as string | null) ?? null, log: [...s.log, `sel=${String(a.id)}`] };
    case "tab":
      return { ...s, tab: String(a.tab) };
    case "sync/hydrate": {
      const from = a.state as Drone;
      return { ...from, tab: s.tab };
    }
    default:
      return s;
  }
}

type Board = { code: string; view: string; power: string | null; run: { status: string } };

function boardReduce(s: Board, a: Act): Board {
  if (a.type === "code/replace") return a.code === s.code ? s : { ...s, code: String(a.code) };
  if (a.type === "view/set") return { ...s, view: String(a.view) };
  if (a.type === "power/set") return { ...s, power: (a.source as string | null) ?? null };
  if (a.type === "run/start") return s.run.status === "stopped" ? { ...s, run: { status: "compiling" } } : s;
  if (a.type === "sync/hydrate") return { ...(a.state as Board), run: s.run };
  return s;
}

const boardInit: Board = { code: "void setup() {}", view: "board", power: "usb", run: { status: "stopped" } };


const ANA = 1;
const BO = 2;
const CY = 3;
const hex = (n: number) => identityOf(n).toHexString();

function join<S>(db: FakeModule, n: number, store: LabStore<S, Act>, lab: LabKind = "drone", itemId = "quad5", scope = `/${lab}/${itemId}`) {
  const room = new RoomClient({
    id: db.code,
    link: `https://iynk.test/en/drones/${itemId}?room=${db.code}`,
    selfId: hex(n),
    me: { name: `peer${n}`, color: "#ef6a4c", lang: "en", done: [] },
    lab,
    itemId,
    backend: db.backend(n),
  });
  const detach = attachStore(store, lab, room, { scope, debounceMs: 100, maxWaitMs: 300 });
  db.attach(n, room);
  return { room, store, detach };
}

/** Lets the joins, snapshots and rejoins that run on promises and timers finish. */
const settle = (ms = 500) => vi.advanceTimersByTimeAsync(ms);

function started(lab: LabKind = "drone", itemId = "quad5") {
  const db = new FakeModule();
  db.create(ANA, lab, itemId);
  return db;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ordering and convergence", () => {
  test("every client applies every shared action in the db's seq order, their own included", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    await settle();
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    const c = join(db, CY, makeStore(droneInit, droneReduce));
    await settle();
    expect([a, b, c].map((x) => x.room.getState().status)).toEqual(["live", "live", "live"]);

    // Selecting a part is free for everyone, so all three write at once.
    for (let i = 0; i < 6; i += 1) {
      a.store.dispatch({ type: "select", id: `a${i}` });
      b.store.dispatch({ type: "select", id: `b${i}` });
      c.store.dispatch({ type: "select", id: `c${i}` });
    }
    a.store.dispatch({ type: "design/pick", key: "battery", value: "late" });
    await settle();

    const order = db.actions.map((row) => {
      const action = JSON.parse(row.action) as Act;
      return action.type === "select" ? `sel=${String(action.id)}` : `${String(action.key)}=${String(action.value)}`;
    });
    expect(order).toHaveLength(19);
    for (const x of [a, b, c]) expect(x.store.getState().log).toEqual(order);
    expect(new Set([a, b, c].map((x) => x.room.getState().seq))).toEqual(new Set([19]));
  });

  test("local actions stay on their own screen", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    a.store.dispatch({ type: "tab", tab: "wiring" });
    await settle();
    expect(a.store.getState().tab).toBe("wiring");
    expect(b.store.getState().tab).toBe("design");
    expect(db.actions).toHaveLength(0);
  });
});

describe("joining", () => {
  test("a joiner takes the host's snapshot, then replays what came after it", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    await settle();
    a.store.dispatch({ type: "design/pick", key: "motor", value: "2207" });
    a.store.dispatch({ type: "select", id: "esc" });
    await settle();
    // The host posts when someone joins; this action lands after the snapshot it takes.
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    expect(db.snapshots).toBeGreaterThan(0);
    a.store.dispatch({ type: "design/pick", key: "battery", value: "4s" });
    await settle();
    const late = join(db, CY, makeStore(droneInit, droneReduce));
    await settle();

    expect(late.room.getState().status).toBe("live");
    expect(late.store.getState().log).toEqual(a.store.getState().log);
    expect(late.store.getState().sel).toBe("esc");
    expect(b.store.getState().log).toEqual(["motor=2207", "sel=esc", "battery=4s"]);
  });

  test("a joiner with no snapshot replays the whole history", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    await settle();
    a.store.dispatch({ type: "design/pick", key: "motor", value: "2306" });
    await settle();
    db.snapshot = null;
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle(50);
    expect(b.store.getState().log).toEqual(["motor=2306"]);
  });

  test("a joiner starts the sketch the host is running", async () => {
    const db = started("board", "uno-r3");
    const a = join(db, ANA, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3");
    await settle();
    a.store.dispatch({ type: "run/start" });
    await settle();
    expect(a.store.getState().run.status).toBe("compiling");
    const b = join(db, BO, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3");
    await settle();
    expect(b.store.getState().run.status).toBe("compiling");
    // Its own interpreter runs it: only the host's start went to the room.
    expect(db.actions.map((row) => (JSON.parse(row.action) as Act).type)).toEqual(["run/start"]);
  });

  test("a board's lessons share the room but not each other's state", async () => {
    const db = started("board", "uno-r3");
    const lesson = join(db, ANA, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3", "/boards/uno-r3/blink");
    await settle();
    lesson.store.dispatch({ type: "power/set", source: null });
    await settle();
    const other = join(db, BO, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3", "/boards/uno-r3/button");
    await settle();
    expect(other.room.getState().status).toBe("live");
    // The host's snapshot is for the blink page, and the button page's replay skips blink's actions.
    expect(other.store.getState().power).toBe("usb");
    lesson.store.dispatch({ type: "power/set", source: "barrel" });
    await settle();
    expect(lesson.store.getState().power).toBe("barrel");
    expect(other.store.getState().power).toBe("usb");
    other.room.chat("on the button lesson");
    await settle();
    expect(lesson.room.getState().messages.some((m) => m.text === "on the button lesson")).toBe(true);
  });

  test("the host leaving hands the room to the next peer, which answers the next joiner", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    await settle();
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    a.store.dispatch({ type: "design/pick", key: "motor", value: "2306" });
    await settle();
    a.room.leave();
    db.notify();
    await settle();
    expect(b.room.getState().hostId).toBe(hex(BO));
    const c = join(db, CY, makeStore(droneInit, droneReduce));
    await settle();
    expect(c.store.getState().log).toEqual(["motor=2306"]);
    expect(b.room.getState().messages.map((m) => m.system?.event)).toEqual(["join", "leave", "host", "join"].slice(1));
  });
});

describe("reconnecting", () => {
  test("a peer that drops rejoins as itself and catches up", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    await settle();
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    db.setOnline(BO, false);
    await settle(20);
    expect(b.room.getState().status).toBe("reconnecting");
    a.store.dispatch({ type: "design/pick", key: "motor", value: "2207" });
    await settle(100);
    db.setOnline(BO, true);
    await settle(3000);
    expect(b.room.getState().status).toBe("live");
    expect(b.room.getState().you.id).toBe(hex(BO));
    expect(b.store.getState().log).toEqual(["motor=2207"]);
    expect(b.store.getState().log).toEqual(a.store.getState().log);
  });
});

describe("the keyboard baton", () => {
  test("only the holder edits code; the others follow the debounced full text", async () => {
    const db = started("board", "uno-r3");
    const board = () => makeStore<Board>(boardInit, boardReduce);
    const a = join(db, ANA, board(), "board", "uno-r3");
    await settle();
    const b = join(db, BO, board(), "board", "uno-r3");
    await settle();
    expect(a.room.getState().batonHolder).toBe(hex(ANA));

    b.store.dispatch({ type: "code/replace", code: "hacked" });
    expect(b.store.getState().code).toBe("void setup() {}");
    expect(b.room.getState().batonDenied).toBe(1);

    // The holder sees its own typing at once, and its echo never rewinds it.
    a.store.dispatch({ type: "code/replace", code: "void setup() { pinMode(13" });
    expect(a.store.getState().code).toBe("void setup() { pinMode(13");
    await settle(120);
    a.store.dispatch({ type: "code/replace", code: "void setup() { pinMode(13, OUTPUT); }" });
    await settle(15);
    expect(a.store.getState().code).toBe("void setup() { pinMode(13, OUTPUT); }");
    await settle(400);
    expect(b.store.getState().code).toBe("void setup() { pinMode(13, OUTPUT); }");

    a.room.passBaton(hex(BO));
    await settle(100);
    expect(b.room.getState().batonHolder).toBe(hex(BO));
    expect(a.room.getState().batonHolder).toBe(hex(BO));
    b.store.dispatch({ type: "code/replace", code: "// bo was here" });
    await settle(400);
    expect(a.store.getState().code).toBe("// bo was here");
    expect(a.room.getState().messages.filter((m) => m.system?.event === "baton")).toHaveLength(1);
  });

  test("only the holder changes the build; anyone can look around", async () => {
    const db = started("board", "uno-r3");
    const a = join(db, ANA, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3");
    await settle();
    const b = join(db, BO, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3");
    await settle();

    b.store.dispatch({ type: "power/set", source: null });
    b.store.dispatch({ type: "run/start" });
    expect(b.room.getState().batonDenied).toBe(2);
    b.store.dispatch({ type: "view/set", view: "schematic" });
    await settle(100);
    expect(db.actions.map((row) => (JSON.parse(row.action) as Act).type)).toEqual(["view/set"]);
    expect([a, b].map((x) => x.store.getState().view)).toEqual(["schematic", "schematic"]);

    a.store.dispatch({ type: "power/set", source: "barrel" });
    await settle(100);
    expect([a, b].map((x) => x.store.getState().power)).toEqual(["barrel", "barrel"]);
  });

  test("a send the db refuses as no_baton counts as denied", async () => {
    const db = started("board", "uno-r3");
    const a = join(db, ANA, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3");
    const b = join(db, BO, makeStore<Board>(boardInit, boardReduce), "board", "uno-r3");
    await settle();
    // The client thinks it holds the keyboard; the db knows better.
    vi.spyOn(b.room, "holdsBaton").mockReturnValue(true);
    b.store.dispatch({ type: "power/set", source: "barrel" });
    await settle(50);
    expect(b.room.getState().batonDenied).toBe(1);
    expect(a.store.getState().power).toBe("usb");
  });

  test("asking for the keyboard shows up as a line for everyone", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    b.room.setPresence({ baton: true });
    await settle(50);
    expect(a.room.getState().messages.at(-1)?.system).toMatchObject({ event: "baton-request", peer: hex(BO), name: "peer2" });
  });
});

describe("chat and peers", () => {
  test("chat reaches everyone once, and the host can remove a peer", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    b.room.chat("  hola, ¿quién conecta el LED?  ", "text", { lang: "es" });
    await settle(100);
    const texts = (x: typeof a) => x.room.getState().messages.filter((m) => m.kind === "text");
    expect(texts(a).map((m) => [m.text, m.lang, m.from])).toEqual([["hola, ¿quién conecta el LED?", "es", hex(BO)]]);
    expect(texts(b)).toHaveLength(1);

    b.room.kick(hex(ANA));
    a.room.kick(hex(BO));
    await settle(100);
    expect(a.room.getState().peers).toEqual([]);
    expect(a.room.getState().messages.at(-1)?.system?.event).toBe("removed");
    // The removed peer's next try to get back in is refused.
    db.setOnline(BO, false);
    db.setOnline(BO, true);
    await settle(3000);
    expect(b.room.getState().ended).toBe("removed");
  });

  test("a translation row shows up on the line it belongs to", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    b.room.chat("hola", "text", { lang: "es" });
    await settle(50);
    const id = db.chat[0].id;
    a.room.ingest({ ...db.rowsFor(true), translations: new Map([[id, { en: "hello" }]]) });
    expect(a.room.getState().messages.find((m) => m.kind === "text")?.translations).toEqual({ en: "hello" });
  });

  test("a peer's join and leave are announced to the others", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    await settle();
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    await settle();
    b.room.leave();
    db.notify();
    expect(a.room.getState().messages.map((m) => m.system?.event)).toEqual(["join", "leave"]);
  });
});

describe("a join the db refuses", () => {
  test.each([
    ["room_full", "full"],
    ["kicked", "removed"],
    ["wrong_item", "wrong-item"],
  ] as const)("%s ends the room as %s", async (message, ended) => {
    const db = started();
    const backend = db.backend(BO);
    backend.joinRoom = () => Promise.reject(new Error(message));
    const room = new RoomClient({ id: db.code, link: "", selfId: hex(BO), me: { name: "bo", color: "#ef6a4c", lang: "en", done: [] }, lab: "drone", itemId: "quad5", backend });
    db.attach(BO, room);
    await settle(50);
    expect(room.getState().ended).toBe(ended);
  });

  test("a code nobody opened is not found", async () => {
    const db = new FakeModule();
    const room = new RoomClient({ id: db.code, link: "", selfId: hex(BO), me: { name: "bo", color: "#ef6a4c", lang: "en", done: [] }, lab: "drone", itemId: "quad5", backend: db.backend(BO) });
    db.attach(BO, room);
    await settle(50);
    expect(room.getState().ended).toBe("not-found");
  });
});

describe("streams and translation", () => {
  test("cursor and pose frames from others reach listeners, with the cursor's off-screen marker", async () => {
    const db = started();
    const a = join(db, ANA, makeStore(droneInit, droneReduce));
    await settle();
    const cursors: Array<[string, unknown]> = [];
    const poses: Array<[string, unknown]> = [];
    a.room.onCursor((from, point) => cursors.push([from, point]));
    a.room.onPose((from, pose) => poses.push([from, pose]));
    a.room.cursorEvent(hex(BO), 0.25, 0.5);
    a.room.cursorEvent(hex(BO), -1, -1);
    a.room.cursorEvent(hex(ANA), 0.1, 0.1);
    a.room.poseEvent(hex(BO), { p: "[1,2,3]", q: "[0,0,0,0]", gate: '"gate-race"' });
    expect(cursors).toEqual([
      [hex(BO), { x: 0.25, y: 0.5 }],
      [hex(BO), null],
    ]);
    expect(poses).toEqual([[hex(BO), { p: [1, 2, 3], q: [0, 0, 0, 0], v: undefined, gate: "gate-race" }]]);
  });

  test("lines in another language are sent for translation once; a database without a key turns it off", async () => {
    const db = started();
    const backend = db.backend(ANA);
    const asked: Array<[bigint, string]> = [];
    backend.translateMessage = async (id, lang) => {
      asked.push([BigInt(id), lang]);
      return { ok: false, error: "not configured: no key" };
    };
    const a = new RoomClient({ id: db.code, link: "", selfId: hex(ANA), me: { name: "ana", color: "#ef6a4c", lang: "en", done: [] }, lab: "drone", itemId: "quad5", backend });
    const b = join(db, BO, makeStore(droneInit, droneReduce));
    db.attach(ANA, a);
    await settle();
    b.room.chat("hola", "text", { lang: "es" });
    b.room.chat("hello", "text", { lang: "en" });
    a.translateFor("en");
    await settle(50);
    a.translateFor("en");
    expect(asked).toHaveLength(1);
    expect(a.getState().translationOff).toBe(true);
    b.room.chat("otra vez", "text", { lang: "es" });
    await settle(50);
    expect(asked).toHaveLength(1);
  });
});
