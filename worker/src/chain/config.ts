import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

/** A secret key as a JSON array of 64 bytes (the `solana-keygen` file format) or base58. */
export function parseKeypair(raw: string): Keypair {
  const text = raw.trim();
  let bytes: Uint8Array;
  if (text.startsWith("[")) {
    const list: unknown = JSON.parse(text);
    if (!Array.isArray(list) || !list.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new Error("SOLANA_ISSUER_KEYPAIR is not a byte array");
    }
    bytes = Uint8Array.from(list as number[]);
  } else {
    bytes = bs58.decode(text);
  }
  if (bytes.length !== 64) throw new Error("SOLANA_ISSUER_KEYPAIR must be a 64-byte secret key");
  return Keypair.fromSecretKey(bytes);
}

/** The signer is a hot key: it only ever talks to devnet or a local validator. */
export function isDevnetUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.includes("devnet") || host === "localhost" || host === "127.0.0.1";
}

export type ChainConfig = {
  rpcUrl: string;
  programId: PublicKey;
  signer: Keypair;
};

type Env = Record<string, string | undefined>;

/** Reads the chain settings from the environment. Throws a message naming what is missing, never a value. */
export function loadChainConfig(env: Env = process.env): ChainConfig {
  const key = env.SOLANA_ISSUER_KEYPAIR;
  if (!key) throw new Error("SOLANA_ISSUER_KEYPAIR is not set");
  const program = env.SOLANA_PROGRAM_ID || env.NEXT_PUBLIC_SOLANA_PROGRAM_ID;
  if (!program) throw new Error("SOLANA_PROGRAM_ID (or NEXT_PUBLIC_SOLANA_PROGRAM_ID) is not set");
  let programId: PublicKey;
  try {
    programId = new PublicKey(program);
  } catch {
    throw new Error("the Solana program id is not a valid address");
  }
  let signer: Keypair;
  try {
    signer = parseKeypair(key);
  } catch (error) {
    throw new Error(error instanceof Error && error.message.startsWith("SOLANA") ? error.message : "SOLANA_ISSUER_KEYPAIR could not be read");
  }
  const rpcUrl = env.SOLANA_RPC_URL || DEFAULT_RPC_URL;
  if (!isDevnetUrl(rpcUrl) && env.IYNK_ALLOW_NON_DEVNET !== "1") {
    throw new Error("SOLANA_RPC_URL is not a devnet or local endpoint; the issuer key signs on devnet only");
  }
  return { rpcUrl, programId, signer };
}
