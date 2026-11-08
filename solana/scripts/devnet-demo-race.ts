// Creates a demo prize race on the deployed program and prints its address.
//
//   node scripts/devnet-demo-race.ts [--entry <SOL>] [--seed <SOL>] [--closes-in <minutes>] [--course <name>]
//
// The deployer is the sponsor (it pays the rent and the seed); the config's
// issuer becomes the race's oracle. Same keys as devnet-setup.ts
// (IYNK_KEYS_DIR overrides ~/.config/solana/iynk). Nothing is airdropped:
// fund the deployer first if the balance check below stops the run.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import type * as AnchorModule from "@coral-xyz/anchor";
import type { Keypair } from "@solana/web3.js";

import type { IynkPassport } from "../../src/lib/solana/idl/iynk_passport";

const anchor = createRequire(import.meta.url)("@coral-xyz/anchor") as typeof AnchorModule;
const { BN, web3 } = anchor;

const { values: flags } = parseArgs({
  options: {
    entry: { type: "string", default: "0.01" },
    seed: { type: "string", default: "0.02" },
    "closes-in": { type: "string", default: "1440" },
    course: { type: "string", default: "neon-loop" },
  },
});

const sol = (text: string, name: string): number => {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} needs an amount of SOL, got "${text}"`);
  return Math.round(value * web3.LAMPORTS_PER_SOL);
};
const entryLamports = sol(flags.entry, "entry");
const seedLamports = sol(flags.seed, "seed");
const minutes = Number(flags["closes-in"]);
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("--closes-in needs a number of minutes");

const url = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const keys = process.env.IYNK_KEYS_DIR ?? join(homedir(), ".config", "solana", "iynk");
const deployer = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(keys, "deployer.json"), "utf8")))) as Keypair;

const connection = new web3.Connection(url, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(deployer), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync(new URL("../target/idl/iynk_passport.json", import.meta.url), "utf8"));
const program = new anchor.Program<IynkPassport>(idl, provider);

const [configAddress] = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const config = await program.account.config.fetchNullable(configAddress);
if (!config) {
  console.error("The program has no config yet. Run: node scripts/devnet-setup.ts");
  process.exit(1);
}

const raceId = new BN(Date.now());
const closesAt = Math.floor(Date.now() / 1000) + Math.round(minutes * 60);
const trackHash = [...createHash("sha256").update(`course:${flags.course}`, "utf8").digest()];
const [race] = web3.PublicKey.findProgramAddressSync([Buffer.from("race"), raceId.toArrayLike(Buffer, "le", 8)], program.programId);

const rent = await connection.getMinimumBalanceForRentExemption(8 + 354);
const need = rent + seedLamports + 20_000;
const have = await connection.getBalance(deployer.publicKey);
if (have < need) {
  console.error(`The deployer holds ${have} lamports and needs about ${need}. Fund ${deployer.publicKey.toBase58()} and rerun.`);
  process.exit(2);
}

const signature = await program.methods
  .createRace(raceId, new BN(entryLamports), trackHash, new BN(closesAt), new BN(seedLamports))
  .accounts({ creator: deployer.publicKey })
  .rpc();

const explorer = (kind: "tx" | "address", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
console.log(`race id   ${raceId.toString()}`);
console.log(`race      ${race.toBase58()}\n          ${explorer("address", race.toBase58())}`);
console.log(`oracle    ${config.issuer.toBase58()}`);
console.log(`course    ${flags.course}, entry ${entryLamports} lamports, seed ${seedLamports}, closes ${new Date(closesAt * 1000).toISOString()}`);
console.log(`tx        ${signature}\n          ${explorer("tx", signature)}`);
