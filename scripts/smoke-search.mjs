#!/usr/bin/env node
// Smoke test for the SerpApi features (BUILD-PLAN §6 step 7): one call per /api/search/* route of a running iynk,
// so the app's own path is tested (origin check, budget guard, cache, normalisers), not a private client.
// Each route costs at most one SerpApi search; a cached answer costs none. Prices and web search run in the SpacetimeDB module now (searchOffers, searchWeb).
// Reads SERPAPI_KEY from the environment or .env.local only to decide whether to run, and never prints it.
// Usage: node scripts/smoke-search.mjs --base http://127.0.0.1:3000 [--only nearby,events,videos]

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

loadEnvFile(join(root, ".env.local"));

const base = (arg("--base") ?? "").replace(/\/+$/, "");
if (!base) {
  console.log("Usage: node scripts/smoke-search.mjs --base http://127.0.0.1:3000 [--only nearby,events,videos]");
  process.exit(2);
}
if (!process.env.SERPAPI_KEY?.trim()) {
  console.log("SKIP smoke-search: SERPAPI_KEY is not set (environment or .env.local). Nothing was called.");
  process.exit(0);
}

const only = arg("--only")?.split(",");

// What a judge's demo asks for: places and events near Austin, a video.
const CALLS = [
  { route: "nearby", query: { kind: "makerspace", near: "Austin, TX" }, count: (b) => b.places?.length },
  { route: "events", query: { q: "maker meetup", near: "Austin, TX" }, count: (b) => b.events?.length },
  { route: "videos", query: { q: "how to solder header pins" }, count: (b) => b.videos?.length },
];

let failed = 0;
for (const call of CALLS) {
  if (only && !only.includes(call.route)) continue;
  const url = `${base}/api/search/${call.route}?${new URLSearchParams(call.query)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      failed++;
      const why = body.error?.code ?? body.error ?? "";
      console.log(`FAIL ${call.route}: HTTP ${res.status} ${typeof why === "string" ? why : ""}`.trim());
      continue;
    }
    const n = call.count(body) ?? 0;
    if (n === 0) {
      failed++;
      console.log(`FAIL ${call.route} (${seconds}s): 200 but no results`);
      continue;
    }
    console.log(`PASS ${call.route} (${seconds}s): ${n} results${call.best ? `, ${call.best(body)}` : ""}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${call.route}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
