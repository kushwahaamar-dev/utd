// What a room is made of on the client: room codes, limits, and the shapes
// the labs share. The wire itself is the SpacetimeDB module (src/lib/stdb).

export type Role = "wirer" | "coder" | "pilot" | "watcher";
export const ROLES: readonly Role[] = ["wirer", "coder", "pilot", "watcher"];

export type ChatKind = "text" | "voice" | "ai" | "system";

export type Action = { type: string; [key: string]: unknown };

export const ROOM_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const ROOM_ID_LENGTH = 6;
export const MAX_PEERS = 8;
export const MAX_NAME_LENGTH = 24;
export const MAX_CHAT_LENGTH = 500;
/** Cursor and pose frames go out at most this often (the module caps them at 20 Hz too). */
export const STREAM_INTERVAL_MS = 50;

/** ?room=new asks the page to open a fresh room and swap in its code. */
export const NEW_ROOM = "new";

const ROOM_ID = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_ID_LENGTH}}$`);

export function isRoomId(value: unknown): value is string {
  return typeof value === "string" && ROOM_ID.test(value);
}

/** Lower-cases and strips what people type around a code ("ABC 23x", "abc-23x"). */
export function normalizeRoomId(input: string): string {
  return input.toLowerCase().replace(/[^0-9a-z]/g, "");
}

function randomFrom(alphabet: string, length: number): string {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

export function newRoomId(): string {
  return randomFrom(ROOM_ALPHABET, ROOM_ID_LENGTH);
}

export function newId(length = 12): string {
  return randomFrom("0123456789abcdefghijklmnopqrstuvwxyz", length);
}

/** What ?room= holds: a room code, "new", or nothing usable (null). */
export function parseRoomParam(raw: string | null): string | null {
  if (!raw) return null;
  const id = normalizeRoomId(raw);
  return id === NEW_ROOM || isRoomId(id) ? id : null;
}
