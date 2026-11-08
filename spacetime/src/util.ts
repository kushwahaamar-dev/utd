import { SenderError, type InferSchema, type ReducerCtx } from "spacetimedb/server";
import { Timestamp } from "spacetimedb";
import type spacetimedb from "./schema";

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

export const fail = (message: string): never => {
  throw new SenderError(message);
};

const encoder = new TextEncoder();
export const byteLength = (text: string) => encoder.encode(text).length;

export const MAX_NAME = 24;
export const SESSION_LANGS = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

/** Self-chosen names: no control, format or bidi characters, at most 24 code points. */
export function cleanName(raw: string): string {
  const cleaned = raw.normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, MAX_NAME).join("");
}

export function requireName(raw: string): string {
  const name = cleanName(raw);
  if (!name) fail("name is empty");
  return name;
}

export function requireColor(color: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail("color must look like #aabbcc");
  return color.toLowerCase();
}

export function requireLang(lang: string): string {
  if (!SESSION_LANGS.test(lang)) fail("lang must be a language code such as en or pt-BR");
  return lang;
}

/** A string column that holds JSON must parse and stay under a byte cap. */
export function requireJson(text: string, maxBytes: number, label: string): unknown {
  if (byteLength(text) > maxBytes) fail(`${label} is over ${maxBytes} bytes`);
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${label} is not valid JSON`);
  }
}

export function requireStringArray(text: string, maxItems: number, maxLen: number, label: string): string[] {
  const value = requireJson(text, 8 * 1024, label);
  if (!Array.isArray(value) || value.length > maxItems) return fail(`${label} must be a list of at most ${maxItems} strings`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > maxLen) return fail(`${label} has a bad entry`);
    out.push(item);
  }
  return out;
}

export const micros = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;
export const addMillis = (ts: Timestamp, ms: number) => new Timestamp(ts.microsSinceUnixEpoch + BigInt(ms) * 1000n);

/**
 * Token bucket per key. Returns false (without writing) when the bucket is
 * empty, so a flood of refused calls costs nothing but the call itself.
 */
export function take(ctx: Ctx, key: string, capacity: number, perSecond: number, cost = 1): boolean {
  const nowUs = micros(ctx);
  const row = ctx.db.rateBucket.key.find(key);
  if (!row) {
    if (cost > capacity) return false;
    ctx.db.rateBucket.insert({ key, tokens: capacity - cost, updatedUs: nowUs });
    return true;
  }
  const elapsed = Number(nowUs - row.updatedUs) / 1_000_000;
  const tokens = Math.min(capacity, row.tokens + Math.max(0, elapsed) * perSecond);
  if (tokens < cost) return false;
  ctx.db.rateBucket.key.update({ ...row, tokens: tokens - cost, updatedUs: nowUs });
  return true;
}

/** Same bucket, but refusing throws, which is what most reducers want. */
export function limit(ctx: Ctx, action: string, capacity: number, perSecond: number, cost = 1) {
  if (!take(ctx, `${ctx.sender.toHexString()}:${action}`, capacity, perSecond, cost)) {
    fail(`rate limited: slow down on ${action}`);
  }
}

export function bumpActivity(ctx: Ctx, kind: string, by = 1) {
  const minuteUs = (micros(ctx) / 60_000_000n) * 60_000_000n;
  const minute = new Timestamp(minuteUs);
  const row = ctx.db.activityMinute.byMinuteKind.filter([minute, kind]).next().value;
  if (row) ctx.db.activityMinute.id.update({ ...row, count: Math.min(0xffffffff, row.count + by) });
  else ctx.db.activityMinute.insert({ id: 0n, minute, kind, count: by });
}

const PALETTE = ["#ef6a4c", "#f4b829", "#93d3b0", "#76a0e2", "#f3a6bb"];

/** The caller's player row; HTTP callers never trigger clientConnected, so it is created on first use. */
export function requirePlayer(ctx: Ctx) {
  const row = ctx.db.player.identity.find(ctx.sender);
  if (row) return row;
  return ctx.db.player.insert({
    identity: ctx.sender,
    name: `guest-${ctx.random.integerInRange(1000, 9999)}`,
    color: PALETTE[ctx.random.integerInRange(0, PALETTE.length - 1)]!,
    lang: "en",
    wallet: undefined,
    online: false,
    lastSeen: ctx.timestamp,
    createdAt: ctx.timestamp,
  });
}

function sameBytes(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function registerWorker(ctx: Ctx, secret: string) {
  const expected = ctx.env.WORKER_SECRET;
  if (!expected) fail("worker auth is not configured: set WORKER_SECRET on the database");
  if (!sameBytes(secret, expected as string)) fail("bad worker secret");
  const row = ctx.db.config.key.find("worker");
  const next = { key: "worker", value: "registered", identity: ctx.sender };
  if (row) ctx.db.config.key.update(next);
  else ctx.db.config.insert(next);
}

export function requireWorker(ctx: Ctx) {
  const row = ctx.db.config.key.find("worker");
  if (!row?.identity || !row.identity.equals(ctx.sender)) fail("worker only");
}
