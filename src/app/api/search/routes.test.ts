import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ search: true }));

vi.mock("@/lib/server/env", () => ({
  env: { SERPAPI_KEY: "route-test-key", SERPAPI_MONTHLY_BUDGET: 500 },
  features: flags,
}));
// connection() needs a request scope that a unit test doesn't have.
vi.mock("next/server", () => ({ connection: async () => {} }));

import * as eventsRoute from "./events/route";
import * as nearbyRoute from "./nearby/route";
import * as videosRoute from "./videos/route";

let counter = 0;
// A fresh IP per request keeps the per-IP rate limiter out of the way, except where a test wants it.
const get = (path: string, ip = `10.0.0.${++counter % 250}`) => new Request(`http://localhost${path}`, { headers: { "x-real-ip": ip } });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": `10.1.0.${++counter % 250}`, ...headers },
    body: JSON.stringify(body),
  });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  flags.search = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const engineOf = (input: string | URL | Request) => new URL(String(input)).searchParams;

describe("/api/search/nearby", () => {
  it("finds places around a point", async () => {
    fetchMock.mockResolvedValue(Response.json({ local_results: [{ title: "ATX Hackerspace", address: "9701 Dessau Rd", rating: 4.8, reviews: 120 }] }));
    const res = await nearbyRoute.GET(get("/api/search/nearby?kind=makerspace&ll=%4030.2672,-97.7431,13z&hl=es"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.places[0]).toMatchObject({ title: "ATX Hackerspace", rating: 4.8, mapsUrl: expect.stringContaining("google.com/maps") });
    expect(engineOf(fetchMock.mock.calls[0][0]).get("hl")).toBe("es");
  });

  it("needs a kind and a place or a point", async () => {
    for (const q of ["?near=Austin", "?kind=makerspace", "?kind=bakery&near=Austin", "?kind=hobby&ll=@200,0,13z"]) {
      expect((await nearbyRoute.GET(get(`/api/search/nearby${q}`))).status, q).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes POST bodies too", async () => {
    fetchMock.mockResolvedValue(Response.json({ local_results: [] }));
    const res = await nearbyRoute.POST(post("/api/search/nearby", { kind: "electronics", near: "Round Rock, TX" }));
    expect(await res.json()).toEqual({ places: [] });
  });
});

describe("/api/search/events and videos", () => {
  it("lists events near a place", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ events_results: [{ title: "Drone race night", date: { when: "Sat, Oct 31, 7 PM" }, venue: { name: "Hall" }, link: "https://e.example/1" }] }),
    );
    const res = await eventsRoute.GET(get("/api/search/events?near=Austin,+TX&q=drone+racing"));
    expect((await res.json()).events[0]).toMatchObject({ title: "Drone race night", venue: "Hall" });
    expect(engineOf(fetchMock.mock.calls[0][0]).get("q")).toBe("drone racing events in Austin, TX");
  });

  it("finds videos", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ video_results: [{ title: "Build a 5 inch quad", link: "https://www.youtube.com/watch?v=1", channel: { name: "Maker" }, thumbnail: { static: "https://i.ytimg.com/1.jpg" } }] }),
    );
    const res = await videosRoute.GET(get("/api/search/videos?q=build+5+inch+quad"));
    expect((await res.json()).videos).toHaveLength(1);
  });

  it("rate-limits one caller", async () => {
    fetchMock.mockResolvedValue(Response.json({ video_results: [] }));
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await videosRoute.GET(get("/api/search/videos?q=solder+tips", "10.9.9.9"))).status;
    expect(last).toBe(429);
  });
});
