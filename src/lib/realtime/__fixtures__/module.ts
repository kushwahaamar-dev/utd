import { Identity } from "spacetimedb";
import type { LabKind } from "@/components/dock/types";
import type { RoomBackend, RoomClient, RoomRows } from "../room";
import { labSync } from "../shared-actions";

// A small in-memory stand-in for the SpacetimeDB room module: the same rules
// (seq order, baton, kick, membership) over plain arrays, and the same rows
// handed to each client that the subscriptions would deliver.

type Member = { id: bigint; roomCode: string; identity: Identity; name: string; color: string; role: string; labRole?: string; status: string; baton: boolean; done: string; joinedAt: number };
type Stored = { code: string; lab: LabKind; itemId: string; host: Identity; epoch: number; seq: bigint };

const at = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });

export function identityOf(n: number): Identity {
  return Identity.fromString(n.toString(16).padStart(64, "0"));
}

export class FakeModule {
  room: Stored | null = null;
  members: Member[] = [];
  actions: Array<{ id: bigint; roomCode: string; seq: bigint; from: Identity; action: string; at: ReturnType<typeof at> }> = [];
  chat: Array<{ id: bigint; roomCode: string; from: Identity; name: string; text: string; lang: string; kind: string; at: ReturnType<typeof at> }> = [];
  snapshot: { roomCode: string; seq: bigint; state: string; by: Identity; at: ReturnType<typeof at> } | null = null;
  bans: string[] = [];
  snapshots = 0;
  langs = new Map<string, string>();
  private next = 1n;
  private clients = new Map<string, { client: RoomClient; online: boolean }>();
  maxMembers = 8;
  now = Date.now();

  constructor(readonly code = "abc234") {}

  create(creator: number, lab: LabKind, itemId: string) {
    this.room = { code: this.code, lab, itemId, host: identityOf(creator), epoch: 1, seq: 0n };
  }

  /** The backend one browser would hold, signed in as `n`. */
  backend(n: number, name = `peer${n}`): RoomBackend {
    const me = identityOf(n);
    this.langs.set(me.toHexString(), "en");
    const fail = (message: string) => Promise.reject(new Error(message));
    const ok = () => Promise.resolve();
    const member = () => this.members.find((m) => m.identity.isEqual(me));
    const holder = () => this.members.find((m) => m.baton);
    return {
      setProfile: async () => {},
      joinRoom: async (_code, bind) => {
        const room = this.room;
        if (!room) return fail("room_not_found");
        if (this.bans.includes(me.toHexString())) return fail("kicked");
        if (member()) return ok();
        if (this.members.length >= this.maxMembers) return fail("room_full");
        if (bind && (bind.lab !== room.lab || bind.itemId !== room.itemId)) return fail("wrong_item");
        const first = this.members.length === 0;
        if (first) room.host = me;
        this.members.push({ id: this.next++, roomCode: this.code, identity: me, name, color: "#ef6a4c", role: first ? "host" : "builder", status: "", baton: first, done: "[]", joinedAt: this.now });
        this.notify();
      },
      leaveRoom: async () => this.remove(me),
      submitAction: async (_code, action) => {
        const room = this.room!;
        const self = member();
        if (!self) return fail("not_member");
        if (action.type.startsWith("room/")) {
          if (action.type !== "room/baton-request") return fail("not_shared");
        } else {
          const sync = labSync(room.lab);
          if (!sync.isShared(action.type)) return fail("not_shared");
          if (!sync.isFree(action.type) && !self.baton) return fail("no_baton");
        }
        this.append(me, action);
      },
      postSnapshot: async (_code, seq, state) => {
        if (BigInt(seq) > this.room!.seq) return fail("seq is ahead of the room");
        this.snapshots += 1;
        this.snapshot = { roomCode: this.code, seq: BigInt(seq), state: JSON.stringify(state), by: me, at: at(this.now) };
        this.notify();
      },
      sendChat: async (_code, text, lang, kind = "text") => {
        const self = member();
        if (!self) return fail("not_member");
        this.chat.push({ id: this.next++, roomCode: this.code, from: me, name: self.name, text, lang, kind, at: at(this.now++) });
        this.notify();
      },
      setPresence: async (_code, update) => {
        const self = member();
        if (!self) return fail("not_member");
        if (update.name) self.name = update.name;
        if (update.labRole) self.labRole = update.labRole;
        if (update.status !== undefined) self.status = update.status;
        if (update.done) self.done = JSON.stringify(update.done);
        this.notify();
      },
      passBaton: async (_code, to) => {
        const self = member();
        if (!self || (!self.baton && !this.room!.host.isEqual(me))) return fail("no_baton");
        const target = to ?? this.room!.host;
        const dest = this.members.find((m) => m.identity.isEqual(target));
        if (!dest) return fail("that person is not in the room");
        for (const m of this.members) m.baton = m === dest;
        this.append(me, { type: "room/baton", to: to ? to.toHexString() : null, byName: self.name, name: dest.name });
      },
      kick: async (_code, target) => {
        if (!this.room!.host.isEqual(me)) return fail("not_host");
        this.bans.push(target.toHexString());
        this.remove(target);
      },
      sendCursor: () => {},
      sendPose: () => {},
      translateMessage: async () => ({ ok: false, error: "not configured: no key" }),
    };
  }

  attach(n: number, client: RoomClient) {
    this.clients.set(identityOf(n).toHexString(), { client, online: true });
    this.notify();
  }

  setOnline(n: number, online: boolean) {
    const entry = this.clients.get(identityOf(n).toHexString());
    if (!entry) return;
    entry.online = online;
    if (!online) this.remove(identityOf(n));
    else this.notify();
  }

  /** The host's identity as the room last saw it. */
  get hostHex() {
    return this.room?.host.toHexString() ?? "";
  }

  private append(from: Identity, action: object) {
    const room = this.room!;
    room.seq += 1n;
    this.actions.push({ id: this.next++, roomCode: this.code, seq: room.seq, from, action: JSON.stringify(action), at: at(this.now++) });
    this.notify();
  }

  private remove(identity: Identity) {
    const gone = this.members.find((m) => m.identity.isEqual(identity));
    if (!gone) return;
    this.members = this.members.filter((m) => m !== gone);
    const room = this.room!;
    if (room.host.isEqual(identity) && this.members.length > 0) {
      room.host = this.members[0].identity;
      this.members[0].role = "host";
    }
    if (gone.baton && this.members.length > 0) for (const m of this.members) m.baton = m.identity.isEqual(room.host);
    this.notify();
  }

  rowsFor(online: boolean): RoomRows {
    return {
      online,
      ready: true,
      room: (this.room ? { ...this.room, createdAt: at(0), emptySince: undefined } : undefined) as never,
      members: this.members as never,
      actions: this.actions as never,
      snapshot: this.snapshot as never,
      chat: this.chat as never,
      translations: new Map(),
      langs: this.langs,
    };
  }

  notify() {
    for (const { client, online } of this.clients.values()) client.ingest(this.rowsFor(online));
  }
}
