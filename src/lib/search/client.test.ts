import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Offer } from "./types";

const tracked = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("@/lib/telemetry", () => ({ track: (kind: string, data: unknown) => tracked.push([kind, data]) }));

import { fetchNearby, fetchOffers } from "./client";

const offer = (title: string, price: number): Offer => ({ source: "google_shopping", title, price, currency: "USD", url: `https://shop.example/${title}` });
const part = { key: "motor", query: "2207 1750kv motor", qty: 4 };

beforeEach(() => {
  tracked.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "not_configured" } }, { status: 503 })));
});

describe("search client", () => {
  it("counts each call by its engine, never by what was searched for", async () => {
    const search = vi.fn(async () => ({ ok: false as const, error: "not configured: SERPAPI_KEY is not set on this database" }));
    expect(await fetchOffers(search, [part])).toEqual({ ok: false, code: "not_configured" });
    await fetchNearby({ kind: "makerspace", near: "Austin, TX" });
    expect(tracked).toEqual([
      ["search.call", { engine: "offers" }],
      ["search.call", { engine: "nearby" }],
    ]);
  });

  it("asks each store once per part and ranks what comes back", async () => {
    const search = vi.fn(async (_query: string, source?: string) => ({
      ok: true as const,
      data: source === "amazon" ? [offer("2207 1750KV motor", 9)] : [offer("2207 1750KV motor pro", 12)],
    }));
    const result = await fetchOffers(search, [part]);
    expect(search).toHaveBeenCalledTimes(3);
    expect(result.ok && result.data.parts[0]?.offers[0]?.price).toBe(9);
    expect(result.ok && result.data.partial).toBeUndefined();
  });

  it("keeps the stores that answered and says why prices are partial", async () => {
    const search = vi.fn(async (_query: string, source?: string) =>
      source === "ebay" ? { ok: false as const, error: "quota_exhausted: search budget is used up for now" } : { ok: true as const, data: [offer("2207 1750KV motor", 9)] },
    );
    const result = await fetchOffers(search, [part]);
    expect(result.ok && result.data.partial).toBe("quota");
  });
});
