// Browser-side search. Prices go through the SpacetimeDB searchOffers procedure; places, events and videos
// still use /api/search/*. Every failure becomes one of a few
// codes the panels have words for; nothing upstream is shown raw.

import { track } from "@/lib/telemetry";
import type { StdbActions } from "@/lib/stdb";
import { rankOffers } from "./rank";
import type { EventsInput, NearbyInput, OfferPartInput, VideosInput } from "./schema";
import type { EventsResponse, NearbyResponse, Offer, OffersResponse, OfferSource, VideosResponse } from "./types";

export type FailCode = "not_configured" | "rate_limited" | "failed";

export type Result<T> = { ok: true; data: T } | { ok: false; code: FailCode };

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Result<T>> {
  // which engine was asked, never what was searched for
  track("search.call", { engine: path.slice(path.lastIndexOf("/") + 1) });
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") throw error;
    return { ok: false, code: "failed" };
  }
  if (res.ok) {
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      return { ok: false, code: "failed" };
    }
  }
  const code = await res
    .json()
    .then((b: { error?: { code?: string } }) => b.error?.code)
    .catch(() => undefined);
  if (res.status === 503 && code === "not_configured") return { ok: false, code: "not_configured" };
  if (res.status === 429) return { ok: false, code: "rate_limited" };
  return { ok: false, code: "failed" };
}

export const fetchNearby = (input: NearbyInput, signal?: AbortSignal) => post<NearbyResponse>("/api/search/nearby", input, signal);
export const fetchEvents = (input: EventsInput, signal?: AbortSignal) => post<EventsResponse>("/api/search/events", input, signal);
export const fetchVideos = (input: VideosInput, signal?: AbortSignal) => post<VideosResponse>("/api/search/videos", input, signal);

const DEFAULT_SOURCES: readonly OfferSource[] = ["google_shopping", "amazon", "ebay"];

function failCode(error: string): FailCode {
  if (error.startsWith("not configured")) return "not_configured";
  if (error.startsWith("rate limited")) return "rate_limited";
  return "failed";
}

/**
 * Prices parts through the module: one cached search per part and store, ranked here the way the old route
 * did. Stores that fail leave the part with what the others found, and `partial` says why.
 */
export async function fetchOffers(
  searchOffers: StdbActions["searchOffers"],
  parts: readonly OfferPartInput[],
  signal?: AbortSignal,
): Promise<Result<OffersResponse>> {
  track("search.call", { engine: "offers" });
  const failures: FailCode[] = [];
  let quota = false;
  let calls = 0;
  const ranked = await Promise.all(
    parts.map(async (part) => {
      const lists = await Promise.all(
        (part.sources ?? DEFAULT_SOURCES).map(async (source) => {
          calls++;
          try {
            const out = await searchOffers(part.query, source);
            if (out.ok) return out.data as Offer[];
            failures.push(failCode(out.error));
            if (out.error.startsWith("quota_exhausted")) quota = true;
          } catch {
            failures.push("failed");
          }
          return [];
        }),
      );
      return rankOffers(part.key, part.query, part.qty, lists.flat(), part.pack);
    }),
  );
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (failures.length === calls && calls > 0) return { ok: false, code: failures.find((c) => c === "not_configured") ?? failures[0]! };
  const data: OffersResponse = { parts: ranked, fetchedAt: new Date().toISOString() };
  if (failures.length) data.partial = quota ? "quota" : "upstream";
  return { ok: true, data };
}
