// @vitest-environment node
import { Buffer } from "buffer";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IssuerContext } from "@/lib/server/solana/context";
import { DISCRIMINATORS, credentialAddress, u64le } from "@/lib/solana/passport";
import { sha256 } from "@/lib/verify/hash";

vi.mock("next/server", () => ({ connection: async () => {} }));

const context = vi.hoisted(() => ({ current: null as IssuerContext | null }));
vi.mock("@/lib/server/solana/context", () => ({
  issuerContext: () => context.current,
  readContext: () => context.current,
}));

const { POST: faucetPOST } = await import("./faucet/route");
const { GET: credentialsGET } = await import("./credentials/route");

const programId = Keypair.generate().publicKey;
const issuer = Keypair.generate();
const learner = Keypair.generate().publicKey;

type Account = { pubkey: PublicKey; account: { data: Buffer; owner: PublicKey; lamports: number; executable: boolean } };

function fakeConnection() {
  const sent: Transaction[] = [];
  const state = {
    accounts: new Map<string, Account["account"]>(),
    programAccounts: [] as Account[],
    balances: new Map<string, number>([[issuer.publicKey.toBase58(), 5_000_000_000]]),
    failSend: null as Error | null,
  };
  const connection = {
    getAccountInfo: vi.fn(async (key: PublicKey) => state.accounts.get(key.toBase58()) ?? null),
    getProgramAccounts: vi.fn(async (_id: PublicKey, config: { filters: { memcmp: { offset: number; bytes: string } }[] }) => {
      // Applies the memcmp filters the way the RPC does.
      const bs58 = (await import("bs58")).default;
      return state.programAccounts.filter(({ account }) =>
        config.filters.every(({ memcmp }) => {
          const want = Buffer.from(bs58.decode(memcmp.bytes));
          return account.data.subarray(memcmp.offset, memcmp.offset + want.length).equals(want);
        }),
      );
    }),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 })),
    sendRawTransaction: vi.fn(async (raw: Buffer) => {
      if (state.failSend) throw state.failSend;
      const tx = Transaction.from(raw);
      sent.push(tx);
      return `sig${sent.length}`;
    }),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
    getBalance: vi.fn(async (key: PublicKey) => state.balances.get(key.toBase58()) ?? 0),
  };
  return { connection, sent, state };
}

function bountyData(sponsor: PublicKey, skillId: string, hash: Uint8Array, opts: { learner?: PublicKey; claimedBy?: PublicKey; lamports: number }) {
  const option = (key?: PublicKey) => (key ? Buffer.concat([Buffer.from([1]), key.toBuffer()]) : Buffer.from([0]));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(Buffer.byteLength(skillId));
  return Buffer.concat([
    Buffer.from(DISCRIMINATORS.Bounty),
    sponsor.toBuffer(),
    Buffer.from(hash),
    len,
    Buffer.from(skillId),
    option(opts.learner),
    u64le(BigInt(opts.lamports)),
    u64le(BigInt(1_700_000_000)),
    option(opts.claimedBy),
    u64le(BigInt(1)),
    Buffer.from([255]),
  ]);
}

const programAccount = (data: Buffer): Account => ({
  pubkey: Keypair.generate().publicKey,
  account: { data, owner: programId, lamports: 1, executable: false },
});

let ip = 0;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": `10.0.0.${++ip}`, ...headers },
    body: JSON.stringify(body),
  });

let fake: ReturnType<typeof fakeConnection>;
beforeEach(() => {
  fake = fakeConnection();
  context.current = { connection: fake.connection as never, programId, issuer };
});

describe("POST /api/solana/faucet", () => {
  test("drips 0.02 SOL once per address and once per IP per hour", async () => {
    const to = Keypair.generate().publicKey.toBase58();
    const first = await faucetPOST(post("/api/solana/faucet", { to }, { "x-real-ip": "192.168.1.1" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ signature: "sig1", lamports: 20_000_000 });
    expect(fake.sent[0].instructions[0].programId.toBase58()).toBe("11111111111111111111111111111111");

    const again = await faucetPOST(post("/api/solana/faucet", { to }, { "x-real-ip": "192.168.1.2" }));
    expect(again.status).toBe(429);
    const sameIp = await faucetPOST(post("/api/solana/faucet", { to: Keypair.generate().publicKey.toBase58() }, { "x-real-ip": "192.168.1.1" }));
    expect(sameIp.status).toBe(429);
  });

  test("a failed drip does not use up the hour", async () => {
    const to = Keypair.generate().publicKey.toBase58();
    fake.state.failSend = new Error("rpc down");
    expect((await faucetPOST(post("/api/solana/faucet", { to }))).status).toBe(502);
    fake.state.failSend = null;
    expect((await faucetPOST(post("/api/solana/faucet", { to }))).status).toBe(200);
  });

  test("skips wallets that already have devnet SOL", async () => {
    const to = Keypair.generate().publicKey;
    fake.state.balances.set(to.toBase58(), 1_000_000_000);
    const res = await faucetPOST(post("/api/solana/faucet", { to: to.toBase58() }));
    expect(res.status).toBe(409);
    expect(fake.sent).toHaveLength(0);
  });
});

describe("GET /api/solana/credentials", () => {
  test("lists a learner's credentials from the program accounts", async () => {
    const hash = await sha256("drone:quad5:safety");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(18);
    const score = Buffer.alloc(2);
    score.writeUInt16LE(90);
    const data = Buffer.concat([
      Buffer.from(DISCRIMINATORS.Credential),
      learner.toBuffer(),
      Buffer.from(hash),
      len,
      Buffer.from("drone:quad5:safety"),
      Buffer.alloc(32, 7),
      score,
      u64le(BigInt(1_761_300_000)),
      issuer.publicKey.toBuffer(),
      Buffer.from([254]),
    ]);
    fake.state.programAccounts.push(programAccount(data), programAccount(bountyData(learner, "x", hash, { lamports: 1 })));
    const res = await credentialsGET(new Request(`http://localhost/api/solana/credentials?learner=${learner.toBase58()}`));
    expect(res.status).toBe(200);
    const { credentials } = await res.json();
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ learner: learner.toBase58(), skillId: "drone:quad5:safety", score: 90, issuedAt: 1_761_300_000, issuer: issuer.publicKey.toBase58(), replayHash: "07".repeat(32) });
  });

  test("validates the learner", async () => {
    const res = await credentialsGET(new Request("http://localhost/api/solana/credentials?learner=nope"));
    expect(res.status).toBe(400);
  });
});
