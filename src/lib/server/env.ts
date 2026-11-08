import "server-only";
import { z } from "zod";

/**
 * Every server setting from HX-CONTRACT H1, parsed once. A missing or malformed
 * variable never throws: it falls back to its default (or stays unset) and the
 * feature that needs it reports false, so the static core keeps working with
 * no keys at all. `envIssues` names the variables that were set but invalid;
 * it never holds a value.
 */

const text = z.string().trim().min(1);
const url = z.url({ protocol: /^https?$/ });
const wsUrl = z.url({ protocol: /^wss?$/ });
const pgUrl = z.url({ protocol: /^postgres(ql)?$/ });
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

const keypair = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.int().min(0).max(255)).length(64))
  .transform((bytes) => Uint8Array.from(bytes));

const schema = {
  NVIDIA_API_KEY: text.optional(),
  NEMOTRON_BASE_URL: url.optional(),
  NEMOTRON_FAST_MODEL: text.default("nvidia/nemotron-3.5-lightning-30b-a3b"),
  NEMOTRON_PLANNER_MODEL: text.default("nvidia/nemotron-3-super-120b-a12b"),
  NEMOTRON_VISION_MODEL: text.default("nvidia/nemotron-3.5-super-vl-120b-a12b"),
  SERPAPI_KEY: text.optional(),
  SERPAPI_MONTHLY_BUDGET: z.coerce.number().int().min(0).default(200),
  SOLANA_RPC_URL: url.default("https://api.devnet.solana.com"),
  SOLANA_ISSUER_KEYPAIR: keypair.optional(),
  NEXT_PUBLIC_SOLANA_CLUSTER: z.literal("devnet").default("devnet"),
  NEXT_PUBLIC_SOLANA_RPC_URL: url.default("https://api.devnet.solana.com"),
  NEXT_PUBLIC_SOLANA_PROGRAM_ID: base58.optional(),
  DATABASE_URL: pgUrl.optional(),
  NEXT_PUBLIC_REALTIME_URL: wsUrl.optional(),
  NEXT_PUBLIC_SITE_URL: url.default("http://localhost:3000"),
} as const;

type Schema = typeof schema;
export type Env = { readonly [K in keyof Schema]: z.output<Schema[K]> };
export type EnvName = keyof Schema;

export type Features = {
  ai: boolean;
  image: boolean;
  voice: boolean;
  search: boolean;
  solana: boolean;
  db: boolean;
  realtime: boolean;
};

const URL_VARS = new Set<EnvName>(["NEMOTRON_BASE_URL", "SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL", "NEXT_PUBLIC_SITE_URL"]);

export function readEnv(source: Record<string, string | undefined>): { env: Env; issues: EnvName[] } {
  const out: Record<string, unknown> = {};
  const issues: EnvName[] = [];
  for (const name of Object.keys(schema) as EnvName[]) {
    const field = schema[name];
    const raw = source[name]?.trim();
    // An empty line in .env.local means "unset", not "invalid".
    const value = raw ? raw : undefined;
    let parsed = field.safeParse(value);
    if (!parsed.success) {
      issues.push(name);
      parsed = field.safeParse(undefined);
    }
    let result = parsed.success ? parsed.data : undefined;
    if (typeof result === "string" && URL_VARS.has(name)) result = result.replace(/\/+$/, "");
    out[name] = result;
  }
  return { env: Object.freeze(out) as Env, issues };
}

export function featuresOf(e: Env): Features {
  return {
    ai: Boolean(e.NVIDIA_API_KEY || e.NEMOTRON_BASE_URL),
    // Nemotron has no image generation or speech-to-text model; both stay off.
    image: false,
    voice: false,
    search: Boolean(e.SERPAPI_KEY),
    solana: Boolean(e.SOLANA_ISSUER_KEYPAIR && e.NEXT_PUBLIC_SOLANA_PROGRAM_ID),
    db: Boolean(e.DATABASE_URL),
    realtime: Boolean(e.NEXT_PUBLIC_REALTIME_URL),
  };
}

const parsed = readEnv(process.env);

export const env: Env = parsed.env;
export const envIssues: readonly EnvName[] = Object.freeze(parsed.issues);
export const features: Readonly<Features> = Object.freeze(featuresOf(env));
