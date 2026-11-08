// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  vi.stubEnv("NVIDIA_API_KEY", "k");
  return (await import("./route")).POST;
}

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ai/image", () => {
  it("is not set up even with a Nemotron key, since Nemotron has no such model", async () => {
    const POST = await load();
    const res = await POST(new Request("http://localhost/api/ai/image", { method: "POST", headers: { "x-real-ip": "10.7.0.1" }, body: "{}" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("not_configured");
  });
});
