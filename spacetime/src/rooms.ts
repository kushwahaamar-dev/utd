import { sha256 } from "@noble/hashes/sha2.js";
import { t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import { labSync } from "../../src/lib/realtime/shared-actions";
import spacetimedb from "./schema";
import { bumpActivity, byteLength, fail, limit, limitGlobal, requireJson, requireName, requirePlayer, requireStringArray, take, type Ctx } from "./util";

const ROOM_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const ROOM_CODE_LENGTH = 8;
const MAX_ROOMS = 400;
const LABS = ["board", "robotics", "drone"] as const;
const ITEM_ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/;
const MAX_MEMBERS = 8;
const MAX_ROOMS_PER_IDENTITY = 3;
const MAX_CHAT_LENGTH = 500;
const CHAT_BACKLOG = 200;
const ACTION_BACKLOG = 4000;
const MAX_ACTION_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024;

const normalizeCode = (input: string) => input.toLowerCase().replace(/[^0-9a-z]/g, "");

function roomOf(ctx: Ctx, rawCode: string) {
  return ctx.db.room.code.find(normalizeCode(rawCode)) ?? fail("room_not_found");
}

function membersOf(ctx: Ctx, code: string) {
  return [...ctx.db.roomMember.roomCode.filter(code)];
}

function memberOf(ctx: Ctx, code: string, identity: Identity) {
  return membersOf(ctx, code).find((m) => m.identity.equals(identity));
}

function requireMember(ctx: Ctx, code: string) {
  return memberOf(ctx, code, ctx.sender) ?? fail("not_member");
}

function appendAction(ctx: Ctx, code: string, from: Identity, action: string) {
  const room = ctx.db.room.code.find(code)!;
  const seq = room.seq + 1n;
  ctx.db.room.code.update({ ...room, seq });
  ctx.db.roomAction.insert({ id: 0n, roomCode: code, seq, from, action, at: ctx.timestamp });
  const cutoff = seq - BigInt(ACTION_BACKLOG);
  if (cutoff > 0n && seq % 256n === 0n) {
    for (const row of [...ctx.db.roomAction.roomCode.filter(code)]) {
      if (row.seq <= cutoff) ctx.db.roomAction.id.delete(row.id);
    }
  }
  return seq;
}

function wipeHistory(ctx: Ctx, code: string) {
  for (const row of [...ctx.db.roomAction.roomCode.filter(code)]) ctx.db.roomAction.id.delete(row.id);
  for (const row of [...ctx.db.chatMessage.roomCode.filter(code)]) deleteMessage(ctx, row.id);
  ctx.db.roomSnapshot.roomCode.delete(code);
}

function deleteMessage(ctx: Ctx, id: bigint) {
  for (const tr of [...ctx.db.chatTranslation.messageId.filter(id)]) ctx.db.chatTranslation.id.delete(tr.id);
  ctx.db.chatMessage.id.delete(id);
}

/** Drops a room and everything hanging off it. */
export function destroyRoom(ctx: Ctx, code: string) {
  wipeHistory(ctx, code);
  for (const m of membersOf(ctx, code)) ctx.db.roomMember.id.delete(m.id);
  for (const ban of [...ctx.db.roomBan.roomCode.filter(code)]) ctx.db.roomBan.id.delete(ban.id);
  ctx.db.room.code.delete(code);
}

function giveBaton(ctx: Ctx, code: string, to: Identity) {
  for (const m of membersOf(ctx, code)) {
    const holds = m.identity.equals(to);
    if (m.baton !== holds) ctx.db.roomMember.id.update({ ...m, baton: holds });
  }
}

/** Takes someone out of a room: baton falls back to the host, and a leaving host hands over to the longest-standing member. */
function removeMember(ctx: Ctx, code: string, identity: Identity) {
  const room = ctx.db.room.code.find(code);
  const gone = memberOf(ctx, code, identity);
  if (!room || !gone) return;
  ctx.db.roomMember.id.delete(gone.id);
  const rest = membersOf(ctx, code).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (rest.length === 0) {
    ctx.db.room.code.update({ ...room, emptySince: ctx.timestamp });
    return;
  }
  if (room.host.equals(identity)) {
    const next = rest[0]!;
    ctx.db.room.code.update({ ...room, host: next.identity });
    ctx.db.roomMember.id.update({ ...next, role: "host" });
    if (gone.baton) giveBaton(ctx, code, next.identity);
  } else if (gone.baton) {
    giveBaton(ctx, code, room.host);
  }
}

export function leaveEveryRoom(ctx: Ctx, identity: Identity) {
  for (const m of [...ctx.db.roomMember.identity.filter(identity)]) removeMember(ctx, m.roomCode, identity);
}

function secretOf(ctx: Ctx): string {
  try {
    return (ctx.env.WORKER_SECRET as string | undefined) ?? "";
  } catch {
    // The in-memory test host has no environment; the published module always does.
    return "";
  }
}

/**
 * ctx.random is seeded from the timestamp, so on its own a code could be predicted. The digits come from a hash of
 * that randomness and the database's WORKER_SECRET, which no client knows; 31^8 codes is also too many to guess.
 */
function newCode(ctx: Ctx): string {
  const secret = secretOf(ctx);
  for (let attempt = 0; attempt < 30; attempt++) {
    const seed = `${secret}:room:${ctx.timestamp.microsSinceUnixEpoch}:${ctx.sender.toHexString()}:${ctx.random.uint32()}:${attempt}`;
    const digest = sha256(new TextEncoder().encode(seed));
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[digest[i]! % ROOM_ALPHABET.length];
    if (!ctx.db.room.code.find(code)) return code;
  }
  return fail("could not find a free room code, try again");
}

function requireLab(lab: string, itemId: string) {
  if (!(LABS as readonly string[]).includes(lab)) fail("unknown lab");
  if (!ITEM_ID.test(itemId)) fail("bad item id");
}

function newTopic(ctx: Ctx): string {
  const digest = sha256(new TextEncoder().encode(`${secretOf(ctx)}:topic:${ctx.timestamp.microsSinceUnixEpoch}:${ctx.sender.toHexString()}:${ctx.random.uint32()}`));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const createRoom = spacetimedb.reducer({ lab: t.string(), itemId: t.string() }, (ctx, { lab, itemId }) => {
  limit(ctx, "create_room", 5, 0.1);
  limitGlobal(ctx, "create_room", 30, 2);
  requireLab(lab, itemId);
  if (ctx.db.room.count() >= BigInt(MAX_ROOMS)) fail("busy: too many rooms open right now");
  const player = requirePlayer(ctx);
  if ([...ctx.db.roomMember.identity.filter(ctx.sender)].length >= MAX_ROOMS_PER_IDENTITY) fail("you are in too many rooms");
  const code = newCode(ctx);
  ctx.db.room.insert({
    code,
    topic: newTopic(ctx),
    lab,
    itemId,
    host: ctx.sender,
    epoch: 1,
    seq: 0n,
    createdAt: ctx.timestamp,
    emptySince: undefined,
  });
  ctx.db.roomMember.insert({
    id: 0n,
    roomCode: code,
    identity: ctx.sender,
    name: player.name,
    color: player.color,
    role: "host",
    labRole: undefined,
    status: "",
    baton: true,
    done: "[]",
    joinedAt: ctx.timestamp,
  });
  bumpActivity(ctx, "room.join");
});

export const joinRoom = spacetimedb.reducer(
  { code: t.string(), lab: t.option(t.string()), itemId: t.option(t.string()) },
  (ctx, { code: rawCode, lab, itemId }) => {
    limit(ctx, "join_room", 10, 0.5);
    limitGlobal(ctx, "join_room", 100, 30);
    const player = requirePlayer(ctx);
    let room = roomOf(ctx, rawCode);
    const code = room.code;
    if ([...ctx.db.roomBan.roomCode.filter(code)].some((b) => b.identity.equals(ctx.sender))) fail("kicked");
    const members = membersOf(ctx, code);
    if (members.some((m) => m.identity.equals(ctx.sender))) return;
    if (members.length >= MAX_MEMBERS) fail("room_full");
    if (lab != null && itemId != null && (room.lab !== lab || room.itemId !== itemId)) {
      if (members.length > 0) fail("wrong_item");
      requireLab(lab, itemId);
      wipeHistory(ctx, code);
      room = { ...room, lab, itemId, epoch: room.epoch + 1, seq: 0n };
      ctx.db.room.code.update(room);
    }
    const first = members.length === 0;
    if (first) ctx.db.room.code.update({ ...room, host: ctx.sender, emptySince: undefined });
    ctx.db.roomMember.insert({
      id: 0n,
      roomCode: code,
      identity: ctx.sender,
      name: player.name,
      color: player.color,
      role: first ? "host" : "builder",
      labRole: undefined,
      status: "",
      baton: first,
      done: "[]",
      joinedAt: ctx.timestamp,
    });
    bumpActivity(ctx, "room.join");
  },
);

export const leaveRoom = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  removeMember(ctx, normalizeCode(code), ctx.sender);
});

export const submitAction = spacetimedb.reducer({ code: t.string(), action: t.string() }, (ctx, { code: rawCode, action }) => {
  limit(ctx, "action", 60, 40);
  const room = roomOf(ctx, rawCode);
  const member = requireMember(ctx, room.code);
  const parsed = requireJson(action, MAX_ACTION_BYTES, "action");
  const type = typeof parsed === "object" && parsed !== null ? (parsed as { type?: unknown }).type : undefined;
  if (typeof type !== "string" || type.length === 0 || type.length > 64) fail("action needs a type");
  const kind = type as string;

  if (kind.startsWith("room/")) {
    // The keyboard moves through pass_baton; asking for it is open to every member.
    if (kind !== "room/baton-request") fail("not_shared");
  } else {
    const sync = labSync(room.lab as (typeof LABS)[number]);
    if (!sync.isShared(kind)) fail("not_shared");
    if (!sync.isFree(kind) && (!member.baton || member.role === "spectator")) fail("no_baton");
  }
  appendAction(ctx, room.code, ctx.sender, action);
  bumpActivity(ctx, "room.action");
});

export const postSnapshot = spacetimedb.reducer(
  { code: t.string(), seq: t.u64(), state: t.string() },
  (ctx, { code: rawCode, seq, state }) => {
    limit(ctx, "snapshot", 4, 1);
    const room = roomOf(ctx, rawCode);
    if (!room.host.equals(ctx.sender)) fail("not_host");
    requireJson(state, MAX_SNAPSHOT_BYTES, "snapshot");
    if (seq > room.seq) fail("seq is ahead of the room");
    const old = ctx.db.roomSnapshot.roomCode.find(room.code);
    if (old && old.seq > seq) fail("snapshot_stale");
    const row = { roomCode: room.code, seq, state, by: ctx.sender, at: ctx.timestamp };
    if (old) ctx.db.roomSnapshot.roomCode.update(row);
    else ctx.db.roomSnapshot.insert(row);
  },
);

export const sendChat = spacetimedb.reducer(
  { code: t.string(), text: t.string(), lang: t.string(), kind: t.string() },
  (ctx, { code: rawCode, text, lang, kind }) => {
    limit(ctx, "chat", 10, 2);
    const room = roomOf(ctx, rawCode);
    const member = requireMember(ctx, room.code);
    const clean = text.trim();
    if (!clean) fail("empty message");
    if (Array.from(clean).length > MAX_CHAT_LENGTH) fail("message is over 500 characters");
    if (kind !== "text" && kind !== "voice" && kind !== "ai") fail("bad chat kind");
    ctx.db.chatMessage.insert({
      id: 0n,
      roomCode: room.code,
      from: ctx.sender,
      name: member.name,
      text: clean,
      lang: lang.slice(0, 12),
      kind,
      at: ctx.timestamp,
    });
    const all = [...ctx.db.chatMessage.roomCode.filter(room.code)];
    if (all.length > CHAT_BACKLOG) {
      all.sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const old of all.slice(0, all.length - CHAT_BACKLOG)) deleteMessage(ctx, old.id);
    }
  },
);

export const setPresence = spacetimedb.reducer(
  {
    code: t.string(),
    role: t.option(t.string()),
    labRole: t.option(t.string()),
    status: t.option(t.string()),
    name: t.option(t.string()),
    done: t.option(t.string()),
  },
  (ctx, { code: rawCode, role, labRole, status, name, done }) => {
    limit(ctx, "presence", 20, 4);
    const room = roomOf(ctx, rawCode);
    let member = requireMember(ctx, room.code);
    if (role != null) {
      if (role !== "builder" && role !== "spectator") fail("role must be builder or spectator");
      if (member.role === "host") fail("the host stays a builder");
      member = { ...member, role };
      if (role === "spectator" && member.baton) giveBaton(ctx, room.code, room.host);
    }
    if (labRole != null) {
      if (!["wirer", "coder", "pilot", "watcher"].includes(labRole)) fail("unknown lab role");
      member = { ...member, labRole };
    }
    if (status != null) {
      if (status.length > 32) fail("status is over 32 characters");
      member = { ...member, status };
    }
    if (name != null) member = { ...member, name: requireName(name) };
    if (done != null) {
      requireStringArray(done, 64, 96, "done");
      member = { ...member, done };
    }
    const fresh = ctx.db.roomMember.id.find(member.id)!;
    ctx.db.roomMember.id.update({ ...member, baton: fresh.baton });
  },
);

export const passBaton = spacetimedb.reducer({ code: t.string(), to: t.option(t.identity()) }, (ctx, { code: rawCode, to }) => {
  limit(ctx, "baton", 10, 2);
  const room = roomOf(ctx, rawCode);
  const me = requireMember(ctx, room.code);
  if (!me.baton && !room.host.equals(ctx.sender)) fail("no_baton");
  const target = to == null ? room.host : to;
  const dest = memberOf(ctx, room.code, target) ?? fail("that person is not in the room");
  if (dest.role === "spectator") fail("spectators cannot hold the keyboard");
  giveBaton(ctx, room.code, target);
  appendAction(
    ctx,
    room.code,
    ctx.sender,
    JSON.stringify({ type: "room/baton", to: to == null ? null : target.toHexString(), byName: me.name, name: dest.name }),
  );
});

export const kick = spacetimedb.reducer({ code: t.string(), target: t.identity() }, (ctx, { code: rawCode, target }) => {
  limit(ctx, "kick", 10, 1);
  const room = roomOf(ctx, rawCode);
  if (!room.host.equals(ctx.sender)) fail("not_host");
  if (target.equals(ctx.sender)) fail("bad_target");
  if (!memberOf(ctx, room.code, target)) fail("bad_target");
  ctx.db.roomBan.insert({ id: 0n, roomCode: room.code, identity: target });
  removeMember(ctx, room.code, target);
});

export const sendCursor = spacetimedb.reducer(
  { code: t.string(), x: t.f64(), y: t.f64() },
  (ctx, { code: rawCode, x, y }) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const code = normalizeCode(rawCode);
    if (!memberOf(ctx, code, ctx.sender)) return;
    if (!take(ctx, `${ctx.sender.toHexString()}:cursor`, 3, 20)) return;
    const topic = ctx.db.room.code.find(code)?.topic;
    if (topic) ctx.db.cursorEvt.insert({ topic, from: ctx.sender, x, y });
  },
);

export const sendPose = spacetimedb.reducer(
  { code: t.string(), p: t.string(), q: t.string(), v: t.option(t.string()), gate: t.option(t.string()) },
  (ctx, { code: rawCode, p, q, v, gate }) => {
    const code = normalizeCode(rawCode);
    if (!memberOf(ctx, code, ctx.sender)) return;
    if (byteLength(p) > 128 || byteLength(q) > 160 || (v != null && byteLength(v) > 1024) || (gate != null && byteLength(gate) > 1024)) {
      fail("pose is too large");
    }
    if (!take(ctx, `${ctx.sender.toHexString()}:pose`, 3, 20)) return;
    const topic = ctx.db.room.code.find(code)?.topic;
    if (topic) ctx.db.poseEvt.insert({ topic, from: ctx.sender, p, q, v, gate });
  },
);
