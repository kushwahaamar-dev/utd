// The offer and web-result mappers from src/lib/server/search/normalize.ts,
// copied because that file imports "server-only", which the module bundle
// cannot resolve. Upstream JSON is untrusted: every field is checked.

type Json = Record<string, unknown>;
export type OfferSource = "google_shopping" | "amazon" | "ebay" | "walmart";
export type Offer = {
  source: OfferSource;
  title: string;
  price: number;
  currency: string;
  url: string;
  seller?: string;
  rating?: number;
  inStock?: boolean;
  thumbnail?: string;
  pack?: number;
};
export type WebResult = { title: string; url: string; snippet: string };

const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const defined = <T>(list: (T | undefined)[]): T[] => list.filter((x): x is T => x !== undefined);

function safeUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parsePrice(v: unknown): number | undefined {
  const direct = num(v);
  if (direct !== undefined) return direct > 0 ? direct : undefined;
  const s = str(v);
  if (!s) return undefined;
  const match = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(s);
  if (!match) return undefined;
  const value = Number(`${match[1]!.replace(/,/g, "")}.${match[2] ?? "0"}`);
  return value > 0 ? value : undefined;
}

const SYMBOLS: [string, string][] = [
  ["US$", "USD"],
  ["CA$", "CAD"],
  ["A$", "AUD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["₹", "INR"],
  ["¥", "JPY"],
  ["$", "USD"],
];

function currencyOf(price: unknown): string {
  const s = str(price);
  if (!s) return "USD";
  return SYMBOLS.find(([symbol]) => s.includes(symbol))?.[1] ?? "USD";
}

function packSize(title: string): number | undefined {
  const t = title.toLowerCase();
  const pairs = /(\d{1,2})\s*(?:pairs|pair|prs)\b/.exec(t);
  if (pairs) return Number(pairs[1]) * 2;
  const pack =
    /(\d{1,3})\s*(?:pcs|pc|pieces|piece|pack|pk|count|ct|sets?)\b/.exec(t) ??
    /\b(?:pack|set|lot)\s+of\s+(\d{1,3})\b/.exec(t) ??
    /(?:^|\s)x\s?(\d{1,2})\b|\b(\d{1,2})\s?x(?:\s|$)/.exec(t);
  const n = pack ? Number(pack[1] ?? pack[2]) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= 200 ? n : undefined;
}

function offer(
  source: OfferSource,
  f: { title: unknown; price: unknown; priceText?: unknown; url: unknown; seller?: unknown; rating?: unknown; inStock?: boolean; thumbnail?: unknown },
): Offer | undefined {
  const title = str(f.title);
  const price = parsePrice(f.price) ?? parsePrice(f.priceText);
  const url = safeUrl(f.url);
  if (!title || price === undefined || !url) return undefined;
  const out: Offer = { source, title, price, currency: currencyOf(f.priceText), url };
  const seller = str(f.seller);
  if (seller) out.seller = seller;
  const rating = num(f.rating);
  if (rating !== undefined && rating >= 0 && rating <= 5) out.rating = rating;
  if (f.inStock !== undefined) out.inStock = f.inStock;
  const thumbnail = safeUrl(f.thumbnail);
  if (thumbnail) out.thumbnail = thumbnail;
  const pack = packSize(title);
  if (pack) out.pack = pack;
  return out;
}

const each = <T>(raw: unknown, key: string, map: (o: Json) => T | undefined): T[] =>
  defined(arr(obj(raw)?.[key]).map((r) => { const o = obj(r); return o ? map(o) : undefined; }));

export const OFFER_NORMALIZERS: Record<OfferSource, (raw: unknown) => Offer[]> = {
  google_shopping: (raw) =>
    each(raw, "shopping_results", (o) =>
      offer("google_shopping", { title: o.title, price: o.extracted_price, priceText: o.price, url: o.link ?? o.product_link, seller: o.source, rating: o.rating, thumbnail: o.thumbnail }),
    ),
  amazon: (raw) =>
    each(raw, "organic_results", (o) =>
      offer("amazon", { title: o.title, price: o.extracted_price, priceText: o.price, url: o.link_clean ?? o.link, seller: "Amazon", rating: o.rating, thumbnail: o.thumbnail }),
    ),
  ebay: (raw) =>
    each(raw, "organic_results", (o) => {
      const price = obj(o.price);
      const from = obj(price?.from);
      return offer("ebay", { title: o.title, price: price?.extracted ?? from?.extracted, priceText: price?.raw ?? from?.raw, url: o.link, seller: obj(o.seller)?.username, thumbnail: o.thumbnail });
    }),
  walmart: (raw) =>
    each(raw, "organic_results", (o) =>
      offer("walmart", {
        title: o.title,
        price: obj(o.primary_offer)?.offer_price,
        url: o.product_page_url,
        seller: o.seller_name,
        rating: o.rating,
        inStock: typeof o.out_of_stock === "boolean" ? !o.out_of_stock : undefined,
        thumbnail: o.thumbnail,
      }),
    ),
};

export function webResults(raw: unknown): WebResult[] {
  return each(raw, "organic_results", (o) => {
    const title = str(o.title);
    const url = safeUrl(o.link);
    return title && url ? { title, url, snippet: str(o.snippet) ?? "" } : undefined;
  });
}
