import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

// Payload shapes of the chain_job rows. issue_credential, submit_result and
// settle_race are queued by the SpacetimeDB module (spacetime/src/chain.ts);
// create_race is queued by the worker or an operator. Numbers may arrive as
// JSON numbers or decimal strings (SpacetimeDB u64 ids are strings).

const wallet = z.string().refine((v) => {
  try {
    return PublicKey.isOnCurve(new PublicKey(v).toBytes());
  } catch {
    return false;
  }
}, "not a wallet address");

const address = z.string().refine((v) => {
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}, "not an address");

const u64 = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const hex32 = z.string().regex(/^[0-9a-fA-F]{64}$/);

export const issueCredentialPayload = z.object({
  wallet,
  skillId: z.string().min(1).max(64),
  score: z.number().int().min(0).max(65535),
  replayHash: hex32,
});

export const submitResultPayload = z.object({
  onchain: address,
  wallet,
  bestMs: z.number().int().min(1).max(4_294_967_295),
  /** Hash of the verified replay. Falls back to sha256 of the lap id and time when the module sends none. */
  runHash: hex32.optional(),
  lapId: z.union([z.string(), z.number()]).nullish(),
});

export const settleRacePayload = z.object({
  onchain: address,
  ranking: z
    .array(
      z.object({
        wallet,
        bestMs: z.number().int().min(1).max(4_294_967_295).nullish(),
        runHash: hex32.optional(),
        lapId: z.union([z.string(), z.number()]).nullish(),
      }),
    )
    .max(256)
    .default([]),
});

export const createRacePayload = z.object({
  /** On-chain race id; defaults to the current time in milliseconds. */
  chainRaceId: u64.optional(),
  /** Course name, hashed into the race's track_hash. */
  course: z.string().min(1).max(128),
  entryLamports: u64,
  /** Unix seconds. */
  closesAt: z.number().int().positive(),
  seedLamports: u64.default(BigInt(0)),
});

export type IssueCredentialPayload = z.infer<typeof issueCredentialPayload>;
export type SubmitResultPayload = z.infer<typeof submitResultPayload>;
export type SettleRacePayload = z.infer<typeof settleRacePayload>;
export type CreateRacePayload = z.infer<typeof createRacePayload>;

export function parsePayload<T>(schema: z.ZodType<T>, raw: unknown): { ok: true; data: T } | { ok: false; error: string } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "payload is not JSON" };
    }
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `bad payload: ${issue.path.join(".") || "(root)"} ${issue.message}` };
}
