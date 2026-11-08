import { Identity } from "spacetimedb";
import type { LabKind } from "@/components/dock/types";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import type { ChatMessage, Room, RoomAction, RoomMember, RoomSnapshot as StoredSnapshot } from "@/lib/stdb";
import type { StdbActions } from "@/lib/stdb";
import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, newId, STREAM_INTERVAL_MS, type Action, type ChatKind, type Role } from "./protocol";
import type { ChatMsg, CursorPoint, Peer, RoomEnd, RoomStatus, SystemEvent } from "./types";

/** How the room reads and writes the lab store; see store-sync.ts. */
export type SyncTarget = {
  snapshot(): unknown;
  /** True when the state was for this page and has been taken. */
  hydrate(state: unknown): boolean;
  /** One shared action, in seq order; `from` is the peer that sent it. */
  apply(action: Action, from: string): void;
  /** Runs `fn` as catching up: the store's listeners treat what it applies as history, not as new events. */
  catchUp(fn: () => void): void;
};

/** What the room posts for a late joiner (the module stores it as opaque JSON). */
export type RoomSnapshot = { v: 1; lab?: LabKind; itemId?: string; state: unknown };

export type RoomState = {
  id: string;
  link: string;
  status: RoomStatus;
  ended: RoomEnd | null;
  you: Peer;
  peers: Peer[];
  hostId: string;
  batonHolder: string;
  batonDenied: number;
  messages: ChatMsg[];
  seq: number;
  /** The module has no translation key, so lines show as written. */
  translationOff: boolean;
};

/** The reducers and procedures a room calls; `useStdbActions()` provides them. */
export type RoomBackend = Pick<
  StdbActions,
  | "setProfile"
  | "joinRoom"
  | "leaveRoom"
  | "submitAction"
  | "postSnapshot"
  | "sendChat"
  | "setPresence"
  | "passBaton"
  | "kick"
  | "sendCursor"
  | "sendPose"
  | "translateMessage"
>;

/** Everything the subscriptions currently say about this room. */
export type RoomRows = {
  /** The connection to the module is up. */
  online: boolean;
  /** Every subscription below has delivered its first rows. */
  ready: boolean;
  room: Room | undefined;
  members: readonly RoomMember[];
  actions: readonly RoomAction[];
  snapshot: StoredSnapshot | undefined;
  chat: readonly ChatMessage[];
  translations: ReadonlyMap<bigint, Record<string, string>>;
  /** Peer id -> language, from the player table (room members do not carry one). */
  langs: ReadonlyMap<string, string>;
};

export type RoomClientOptions = {
  id: string;
  link: string;
  /** This tab's identity as the module sees it: `identity.toHexString()`. */
  selfId: string;
  me: { name: string; color: string; lang: Locale; done: string[] };
  lab: LabKind;
  itemId: string;
  backend: RoomBackend;
  now?: () => number;
};

const MAX_MESSAGES = 200;
/** The host posts a fresh snapshot after this many applied actions. */
const SNAPSHOT_EVERY = 50;
const SNAPSHOT_DELAY_MS = 400;
const REJOIN_GAP_MS = 1500;

/** Module errors that end the session. */
const END_ERRORS: Array<[string, RoomEnd]> = [
  ["kicked", "removed"],
  ["room_full", "full"],
  ["wrong_item", "wrong-item"],
  ["room_not_found", "not-found"],
  ["too many rooms", "error"],
];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const englishSystem: Record<SystemEvent["event"], (e: SystemEvent) => string> = {
  join: (e) => `${e.name} joined`,
  leave: (e) => `${e.name} left`,
  host: (e) => `${e.name} is now the host`,
  removed: (e) => `${e.name} was removed by the host`,
  baton: (e) => `${e.name} has the keyboard now`,
  "baton-request": (e) => `${e.name} asked for the keyboard`,
};

const micros = (at: { microsSinceUnixEpoch: bigint }) => Number(at.microsSinceUnixEpoch / 1000n);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseStrings(text: string): string[] {
  const value = parseJson(text);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * One peer's view of one room. SpacetimeDB is the source of truth: it orders
 * the shared actions, holds the keyboard baton, the members and the chat. The
 * provider feeds this class what the subscriptions say (`ingest`); it applies
 * each action to the lab store once, in seq order, and turns the module's rows
 * into the state the UI reads.
 */
export class RoomClient {
  private state: RoomState;
  private readonly listeners = new Set<() => void>();
  private readonly poseListeners = new Set<(from: string, pose: unknown) => void>();
  private readonly cursorListeners = new Set<(from: string, point: CursorPoint | null) => void>();
  private readonly passHooks = new Set<() => void>();
  private readonly lastStream = new Map<string, number>();
  private readonly kicked = new Set<string>();
  private readonly translationsTried = new Set<string>();
  private readonly untranslated = new Map<string, Set<Locale>>();
  private readonly now: () => number;
  private rows: RoomRows | null = null;
  private target: SyncTarget | null = null;
  private systemLines: ChatMsg[] = [];
  private chatLines: ChatMsg[] = [];
  private synced = false;
  private applied = 0;
  private epoch: number | null = null;
  private knownMembers = new Set<string>();
  private knownHost = "";
  private joining = false;
  private joinedAt = 0;
  private profileSent = false;
  private lastPosted = -1;
  private postedAtPeers = 0;
  private postTimer: ReturnType<typeof setTimeout> | undefined;
  private rejoinTimer: ReturnType<typeof setTimeout> | undefined;
  private translateLocale: Locale | null = null;

  constructor(private readonly options: RoomClientOptions) {
    this.now = options.now ?? Date.now;
    this.state = {
      id: options.id,
      link: options.link,
      status: "connecting",
      ended: null,
      you: { id: options.selfId, ...options.me, baton: false },
      peers: [],
      hostId: "",
      batonHolder: "",
      batonDenied: 0,
      messages: [],
      seq: 0,
      translationOff: false,
    };
  }

  getState = (): RoomState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The store the shared actions land in. Set it before the first ingest. */
  bind(target: SyncTarget | null) {
    this.target = target;
  }

  isLive(): boolean {
    return this.state.status === "live";
  }

  holdsBaton(): boolean {
    return this.state.batonHolder === this.state.you.id;
  }

  /** A shared action from this tab: the module numbers it, and it comes back in the stream like everyone's. */
  sendAction(action: Action) {
    this.run(this.options.backend.submitAction(this.options.id, action));
  }

  denyBaton() {
    this.set({ batonDenied: this.state.batonDenied + 1 });
  }

  chat(text: string, kind: ChatKind = "text", options: { lang?: Locale } = {}) {
    const clean = text.trim().slice(0, MAX_CHAT_LENGTH);
    if (!clean || this.state.ended) return;
    const lang = options.lang ?? this.state.you.lang;
    this.run(this.options.backend.sendChat(this.options.id, clean, lang, kind === "system" ? "text" : kind));
  }

  setPresence(fields: { role?: Role; status?: string; baton?: boolean }) {
    const { baton, role, status } = fields;
    if (baton === true && !this.holdsBaton()) {
      if (this.state.hostId === this.state.you.id) this.passBaton(this.state.you.id);
      else this.requestBaton();
    } else if (baton === false && this.holdsBaton()) {
      this.passBaton(null);
    }
    if (role === undefined && status === undefined) return;
    this.run(this.options.backend.setPresence(this.options.id, { labRole: role, status }));
  }

  rename(name: string) {
    const clean = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!clean) return;
    this.run(this.options.backend.setPresence(this.options.id, { name: clean }));
  }

  shareDone(done: string[]) {
    this.run(this.options.backend.setPresence(this.options.id, { done }));
  }

  passBaton(to: string | null) {
    // Pending code goes out first, so it lands while we still hold the keyboard.
    for (const hook of [...this.passHooks]) hook();
    this.run(this.options.backend.passBaton(this.options.id, to === null ? null : Identity.fromString(to)));
  }

  /** Runs right before this tab passes the keyboard on. */
  beforeBatonPass(hook: () => void): () => void {
    this.passHooks.add(hook);
    return () => {
      this.passHooks.delete(hook);
    };
  }

  requestBaton() {
    this.sendAction({ type: "room/baton-request" });
  }

  kick(id: string) {
    if (this.state.hostId !== this.state.you.id || id === this.state.you.id) return;
    const peer = this.state.peers.find((p) => p.id === id);
    if (!peer) return;
    this.kicked.add(id);
    this.addSystem({ event: "removed", peer: id, name: peer.name }, this.now());
    this.run(this.options.backend.kick(this.options.id, Identity.fromString(id)));
  }

  sendCursor(point: CursorPoint | null) {
    if (!this.stream("cursor", point === null)) return;
    if (point) this.options.backend.sendCursor(this.options.id, clamp01(point.x), clamp01(point.y));
    else this.options.backend.sendCursor(this.options.id, -1, -1);
  }

  onCursor(listener: (from: string, point: CursorPoint | null) => void) {
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  }

  sendPose(pose: unknown) {
    if (!pose || typeof pose !== "object" || !this.stream("pose")) return;
    this.options.backend.sendPose(this.options.id, pose as { p: number[]; q: number[]; v?: unknown; gate?: unknown });
  }

  onPose(listener: (from: string, pose: unknown) => void) {
    this.poseListeners.add(listener);
    return () => {
      this.poseListeners.delete(listener);
    };
  }

  /** A cursor frame from the module's event table. */
  cursorEvent(from: string, x: number, y: number) {
    if (from === this.state.you.id || this.state.ended) return;
    const point = x < 0 || y < 0 || x > 1 || y > 1 ? null : { x, y };
    for (const listener of [...this.cursorListeners]) listener(from, point);
  }

  /** A pose frame from the module's event table (its fields are JSON text). */
  poseEvent(from: string, frame: { p: string; q: string; v?: string | null; gate?: string | null }) {
    if (from === this.state.you.id || this.state.ended) return;
    const pose = { p: parseJson(frame.p), q: parseJson(frame.q), v: frame.v ? parseJson(frame.v) : undefined, gate: frame.gate ? parseJson(frame.gate) : undefined };
    for (const listener of [...this.poseListeners]) listener(from, pose);
  }

  /** Asks the module to translate every line this reader can't read yet; the answers arrive as rows. */
  translateFor(locale: Locale) {
    if (this.state.translationOff || this.state.ended) return;
    this.translateLocale = locale;
    for (const msg of this.state.messages) {
      if (msg.kind === "system" || msg.lang === locale || msg.translations[locale] !== undefined) continue;
      const key = `${msg.id}:${locale}`;
      if (this.translationsTried.has(key)) continue;
      this.translationsTried.add(key);
      void this.options.backend.translateMessage(BigInt(msg.id), locale).then(
        (result) => {
          if (result.ok) return;
          // Without a key on the database there is nothing to retry: readers see the originals.
          if (result.error.startsWith("not configured")) this.set({ translationOff: true });
          else this.markUntranslated(msg.id, locale);
        },
        () => this.markUntranslated(msg.id, locale),
      );
    }
  }

  /** A module error that doesn't come from one of our own calls (a failed join, say). */
  fail(error: unknown) {
    const message = messageOf(error);
    const end = END_ERRORS.find(([needle]) => message.includes(needle))?.[1];
    if (end) this.leave(end);
  }

  leave(reason: RoomEnd = "left") {
    if (this.state.ended) return;
    clearTimeout(this.postTimer);
    clearTimeout(this.rejoinTimer);
    this.target = null;
    this.set({ status: "ended", ended: reason });
    // Best effort: the module drops us anyway when the connection closes.
    void this.options.backend.leaveRoom(this.options.id).catch(() => {});
  }

  /** The newest rows from the subscriptions. Call it whenever any of them changes. */
  ingest(rows: RoomRows) {
    if (this.state.ended) return;
    this.rows = rows;
    const me = this.options.selfId;
    const { room, members } = rows;
    const self = members.find((m) => m.identity.toHexString() === me);

    if (!rows.online) {
      this.joining = false;
      this.profileSent = false;
      this.set({ status: this.synced ? "reconnecting" : "connecting" });
      return;
    }
    if (rows.ready && !self) this.ensureJoined();
    if (!room || !self) {
      this.set({ status: this.synced ? "reconnecting" : "connecting" });
      return;
    }

    if (this.epoch !== null && room.epoch !== this.epoch) this.synced = false;
    this.epoch = room.epoch;

    const live = this.synced;
    this.readPeople(rows, room, live);
    if (!this.synced && rows.ready) this.catchUp(rows, room);
    if (this.synced) this.applyActions(rows.actions, live);
    this.readChat(rows);
    this.set({ status: this.synced ? "live" : "syncing" });
    if (this.synced) {
      this.translateLater();
      this.maybePost();
    }
  }

  // ---------------------------------------------------------------------------

  /** Fire and forget: the call's failure ends the room, or says why an edit was refused. */
  private run(call: Promise<unknown>) {
    call.catch((error) => {
      const message = messageOf(error);
      if (message.includes("no_baton")) return this.denyBaton();
      if (message.includes("not_member")) return this.ensureJoined();
      this.fail(error);
    });
  }

  private ensureJoined() {
    const t = this.now();
    if (this.joining) return;
    if (t - this.joinedAt < REJOIN_GAP_MS) {
      // Too soon after the last try; look again once the gap is over, whether or not a row changes by then.
      this.rejoinTimer ??= setTimeout(() => {
        this.rejoinTimer = undefined;
        if (this.rows) this.ingest(this.rows);
      }, REJOIN_GAP_MS);
      return;
    }
    this.joining = true;
    this.joinedAt = t;
    const { backend, id, lab, itemId, me } = this.options;
    const profile = this.profileSent ? Promise.resolve() : backend.setProfile({ name: this.state.you.name, color: me.color, lang: this.state.you.lang });
    profile
      .then(() => {
        this.profileSent = true;
        return backend.joinRoom(id, { lab, itemId });
      })
      .catch((error) => this.fail(error))
      .finally(() => {
        this.joining = false;
      });
  }

  private set(patch: Partial<RoomState>) {
    const next = { ...this.state, ...patch };
    const same = (Object.keys(patch) as Array<keyof RoomState>).every((key) => Object.is(next[key], this.state[key]));
    if (same) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  private stream(kind: "cursor" | "pose", force = false): boolean {
    if (!this.isLive()) return false;
    const t = this.now();
    if (!force && t - (this.lastStream.get(kind) ?? 0) < STREAM_INTERVAL_MS) return false;
    this.lastStream.set(kind, t);
    return true;
  }

  private peerOf(row: RoomMember, rows: RoomRows, holder: string): Peer {
    const id = row.identity.toHexString();
    const lang = rows.langs.get(id);
    return {
      id,
      name: row.name.slice(0, MAX_NAME_LENGTH),
      color: row.color,
      lang: lang && isLocale(lang) ? lang : DEFAULT_LOCALE,
      role: (row.labRole ?? undefined) as Role | undefined,
      status: row.status || undefined,
      done: parseStrings(row.done),
      baton: id === holder,
    };
  }

  private readPeople(rows: RoomRows, room: Room, announce: boolean) {
    const me = this.options.selfId;
    const hostId = room.host.toHexString();
    const holderRow = rows.members.find((m) => m.baton);
    const holder = holderRow ? holderRow.identity.toHexString() : hostId;
    const everyone = [...rows.members].sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => this.peerOf(row, rows, holder));
    const you = everyone.find((p) => p.id === me) ?? this.state.you;
    const peers = everyone.filter((p) => p.id !== me);

    if (announce) {
      const t = this.now();
      for (const peer of peers) {
        if (!this.knownMembers.has(peer.id)) this.addSystem({ event: "join", peer: peer.id, name: peer.name }, t);
      }
      for (const id of this.knownMembers) {
        if (id === me || peers.some((p) => p.id === id)) continue;
        if (this.kicked.delete(id)) continue;
        this.addSystem({ event: "leave", peer: id, name: this.state.peers.find((p) => p.id === id)?.name ?? "" }, t);
      }
      if (hostId !== this.knownHost && this.knownHost !== "") {
        this.addSystem({ event: "host", peer: hostId, name: everyone.find((p) => p.id === hostId)?.name ?? "" }, t);
      }
    }
    this.knownMembers = new Set(everyone.map((p) => p.id));
    this.knownHost = hostId;
    const unchanged = JSON.stringify([you, peers]) === JSON.stringify([this.state.you, this.state.peers]);
    this.set({ ...(unchanged ? {} : { you, peers }), hostId, batonHolder: holder });
  }

  /** First sync: take the host's snapshot if it is for this page, then replay what came after it. */
  private catchUp(rows: RoomRows, room: Room) {
    const stored = rows.snapshot;
    let from = 0;
    this.target?.catchUp(() => {
      if (stored && stored.seq <= room.seq) {
        const parsed = parseJson(stored.state) as Partial<RoomSnapshot> | undefined;
        const mine = parsed && parsed.v === 1 && parsed.lab === this.options.lab && parsed.itemId === this.options.itemId;
        if (mine && parsed.state !== undefined && parsed.state !== null && this.target?.hydrate(parsed.state)) from = Number(stored.seq);
      }
      this.applied = from;
      this.applyActions(rows.actions, false);
    });
    if (!this.target) this.applied = Number(room.seq);
    this.synced = true;
    this.lastPosted = stored ? Number(stored.seq) : -1;
    this.postedAtPeers = this.state.peers.length;
  }

  private applyActions(actions: readonly RoomAction[], announce: boolean) {
    const fresh = actions.filter((a) => a.seq > BigInt(this.applied));
    if (fresh.length === 0) return;
    fresh.sort((a, b) => (a.seq < b.seq ? -1 : 1));
    for (const row of fresh) {
      this.applied = Number(row.seq);
      const action = parseJson(row.action) as Action | undefined;
      if (!action || typeof action.type !== "string") continue;
      this.applyOne(row.from.toHexString(), action, announce ? micros(row.at) : null);
    }
    this.set({ seq: this.applied });
  }

  private applyOne(from: string, action: Action, at: number | null) {
    if (action.type === "room/baton") {
      if (at !== null) {
        const to = typeof action.to === "string" ? action.to : this.state.hostId;
        const name = typeof action.name === "string" ? action.name : this.nameOf(to);
        const byName = typeof action.byName === "string" ? action.byName : this.nameOf(from);
        this.set({ batonDenied: 0 });
        this.addSystem({ event: "baton", peer: to, name, by: from, byName }, at);
      }
      return;
    }
    if (action.type === "room/baton-request") {
      if (at !== null) this.addSystem({ event: "baton-request", peer: from, name: this.nameOf(from) }, at);
      return;
    }
    if (action.type.startsWith("room/")) return;
    this.target?.apply(action, from);
  }

  private nameOf(id: string): string {
    if (id === this.state.you.id) return this.state.you.name;
    return this.state.peers.find((peer) => peer.id === id)?.name ?? "";
  }

  private addSystem(event: SystemEvent, ts: number) {
    this.systemLines.push({ id: newId(), from: "", text: englishSystem[event.event](event), lang: "en", kind: "system", ts, translations: {}, system: event });
    if (this.systemLines.length > MAX_MESSAGES) this.systemLines.splice(0, this.systemLines.length - MAX_MESSAGES);
    this.publishMessages();
  }

  private readChat(rows: RoomRows) {
    this.chatLines = rows.chat.map((row) => {
      const id = String(row.id);
      const translations = rows.translations.get(row.id) ?? {};
      const untranslated = this.untranslated.get(id);
      return {
        id,
        from: row.from.toHexString(),
        text: row.text.slice(0, MAX_CHAT_LENGTH),
        lang: isLocale(row.lang) ? row.lang : DEFAULT_LOCALE,
        kind: row.kind as ChatKind,
        ts: micros(row.at),
        translations,
        name: row.name.slice(0, MAX_NAME_LENGTH),
        ...(untranslated ? { untranslated: [...untranslated] } : {}),
      };
    });
    this.publishMessages();
  }

  private publishMessages() {
    const merged = [...this.chatLines, ...this.systemLines].sort((a, b) => a.ts - b.ts);
    const messages = merged.length > MAX_MESSAGES ? merged.slice(-MAX_MESSAGES) : merged;
    const old = this.state.messages;
    const unchanged = old.length === messages.length && old.every((m, i) => sameMessage(m, messages[i]));
    if (!unchanged) this.set({ messages });
  }

  private markUntranslated(id: string, locale: Locale) {
    const set = this.untranslated.get(id) ?? new Set<Locale>();
    set.add(locale);
    this.untranslated.set(id, set);
    if (this.rows) this.readChat(this.rows);
  }

  private translateLater() {
    if (this.translateLocale) this.translateFor(this.translateLocale);
  }

  /** The host keeps a snapshot fresh for whoever joins next. */
  private maybePost() {
    if (this.state.hostId !== this.state.you.id || !this.target) return;
    const peers = this.state.peers.length;
    const joined = peers > this.postedAtPeers;
    this.postedAtPeers = peers;
    const behind = this.applied - this.lastPosted >= SNAPSHOT_EVERY;
    if (!joined && !behind && this.lastPosted >= 0) return;
    if (this.postTimer) return;
    this.postTimer = setTimeout(() => {
      this.postTimer = undefined;
      this.post();
    }, SNAPSHOT_DELAY_MS);
  }

  private post() {
    if (this.state.ended || !this.target || this.state.hostId !== this.state.you.id) return;
    const seq = this.applied;
    const snapshot: RoomSnapshot = { v: 1, lab: this.options.lab, itemId: this.options.itemId, state: this.target.snapshot() };
    this.lastPosted = seq;
    this.options.backend.postSnapshot(this.options.id, seq, snapshot).catch(() => {
      // Too large, stale or rate limited: the next trigger tries again.
      if (this.lastPosted === seq) this.lastPosted = seq - SNAPSHOT_EVERY;
    });
  }
}

function sameMessage(a: ChatMsg, b: ChatMsg): boolean {
  if (a.id !== b.id || a.ts !== b.ts || a.text !== b.text || a.name !== b.name) return false;
  if (a.untranslated?.length !== b.untranslated?.length) return false;
  const left = Object.entries(a.translations);
  const right = Object.entries(b.translations);
  return left.length === right.length && left.every(([lang, text]) => (b.translations as Record<string, string>)[lang] === text);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
