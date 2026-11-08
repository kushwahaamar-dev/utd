// @vitest-environment node
import { describe, expect, it } from "vitest";
import { featuresOf, readEnv } from "./env";

const keypair = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));
const programId = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

describe("readEnv", () => {
  it("falls back to every default when nothing is set", () => {
    const { env, issues } = readEnv({});
    expect(issues).toEqual([]);
    expect(env.NVIDIA_API_KEY).toBeUndefined();
    expect(env.NEMOTRON_BASE_URL).toBeUndefined();
    expect(env.NEMOTRON_FAST_MODEL).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(env.NEMOTRON_PLANNER_MODEL).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(env.NEMOTRON_VISION_MODEL).toBe("nvidia/nemotron-3.5-super-vl-120b-a12b");
    expect(env.SERPAPI_MONTHLY_BUDGET).toBe(200);
    expect(env.NEXT_PUBLIC_SOLANA_CLUSTER).toBe("devnet");
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("http://localhost:3000");
    expect(featuresOf(env)).toEqual({
      ai: false,
      image: false,
      voice: false,
      search: false,
      solana: false,
      realtime: false,
    });
  });

  it("treats blank values as unset", () => {
    const { env, issues } = readEnv({ NVIDIA_API_KEY: "   ", NEMOTRON_FAST_MODEL: "" });
    expect(issues).toEqual([]);
    expect(env.NVIDIA_API_KEY).toBeUndefined();
    expect(env.NEMOTRON_FAST_MODEL).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it("keeps going past malformed values and names them without their values", () => {
    const { env, issues } = readEnv({
      NEMOTRON_BASE_URL: "ftp://nope",
      SERPAPI_MONTHLY_BUDGET: "lots",
      SOLANA_ISSUER_KEYPAIR: "[1,2,3]",
      NEXT_PUBLIC_REALTIME_URL: "https://not-a-socket.example",
      NEXT_PUBLIC_SOLANA_CLUSTER: "mainnet-beta",
    });
    expect(issues.sort()).toEqual(
      [
        "NEMOTRON_BASE_URL",
        "NEXT_PUBLIC_REALTIME_URL",
        "NEXT_PUBLIC_SOLANA_CLUSTER",
        "SERPAPI_MONTHLY_BUDGET",
        "SOLANA_ISSUER_KEYPAIR",
      ].sort(),
    );
    expect(env.NEMOTRON_BASE_URL).toBeUndefined();
    expect(env.SERPAPI_MONTHLY_BUDGET).toBe(200);
    expect(env.SOLANA_ISSUER_KEYPAIR).toBeUndefined();
    expect(env.NEXT_PUBLIC_SOLANA_CLUSTER).toBe("devnet");
  });

  it("parses keys, numbers, the issuer keypair and trims trailing slashes", () => {
    const { env, issues } = readEnv({
      NVIDIA_API_KEY: "k",
      NEMOTRON_BASE_URL: "https://proxy.example/v1/",
      SERPAPI_KEY: "s",
      SERPAPI_MONTHLY_BUDGET: "50",
      SOLANA_ISSUER_KEYPAIR: keypair,
      NEXT_PUBLIC_SOLANA_PROGRAM_ID: programId,
      NEXT_PUBLIC_REALTIME_URL: "wss://rt.example/ws",
    });
    expect(issues).toEqual([]);
    expect(env.NEMOTRON_BASE_URL).toBe("https://proxy.example/v1");
    expect(env.SERPAPI_MONTHLY_BUDGET).toBe(50);
    expect(env.SOLANA_ISSUER_KEYPAIR).toBeInstanceOf(Uint8Array);
    expect(env.SOLANA_ISSUER_KEYPAIR?.length).toBe(64);
    expect(featuresOf(env)).toEqual({
      ai: true,
      image: false,
      voice: false,
      search: true,
      solana: true,
      realtime: true,
    });
  });

  it("turns AI on for a hosted key or a self-hosted endpoint, never image or voice", () => {
    expect(featuresOf(readEnv({ NVIDIA_API_KEY: "k" }).env)).toMatchObject({ ai: true, image: false, voice: false });
    expect(featuresOf(readEnv({ NEMOTRON_BASE_URL: "http://gpu:8000/v1" }).env)).toMatchObject({ ai: true, image: false, voice: false });
  });

  it("needs both the issuer and the program id for solana", () => {
    expect(featuresOf(readEnv({ SOLANA_ISSUER_KEYPAIR: keypair }).env).solana).toBe(false);
    expect(featuresOf(readEnv({ NEXT_PUBLIC_SOLANA_PROGRAM_ID: programId }).env).solana).toBe(false);
  });
});
