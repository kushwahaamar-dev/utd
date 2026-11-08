import type { NextConfig } from "next";
import { DEFAULT_LOCALE, LANG_COOKIE, LOCALES, acceptLanguagePattern } from "./src/i18n/config";

const isDev = process.env.NODE_ENV !== "production";

/** An http(s)/ws(s) endpoint as both its https and wss forms (SpacetimeDB and Solana RPC speak both). */
function origins(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const u = new URL(url);
    const secure = u.protocol === "https:" || u.protocol === "wss:";
    return secure ? [`https://${u.host}`, `wss://${u.host}`] : [`http://${u.host}`, `ws://${u.host}`];
  } catch {
    return [];
  }
}

// The browser talks to: this origin, SpacetimeDB (wss for the socket, https for the identity call; Maincloud or the
// self-hosted domain), and the Solana RPC. The NVIDIA, SerpApi and chain-signing calls all happen server-side.
const connectSrc = [
  "'self'",
  "https://maincloud.spacetimedb.com",
  "wss://maincloud.spacetimedb.com",
  ...origins(process.env.NEXT_PUBLIC_STDB_URI),
  ...origins(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com"),
  ...(isDev ? ["ws://127.0.0.1:3100", "http://127.0.0.1:3100", "ws://localhost:3100", "http://localhost:3100"] : []),
];

// Next injects inline scripts for hydration, so script-src keeps 'unsafe-inline'; everything else is locked down.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""} blob:`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  `connect-src ${connectSrc.join(" ")}`,
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The labs use the microphone (voice), the camera (vision), location (nearby search) and Web Serial (real boards).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), serial=(self), usb=(), bluetooth=(), payment=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Agents build side by side with NEXT_DIST_DIR=.next-<label>.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Vultr image runs `node server.js` from a standalone build (deploy/core/Dockerfile.web).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // While ~40 agents share one tree, IYNK_BUILD_SKIP_TYPECHECK=1 lets one of
  // them build its routes past another's half-written file; they type-check
  // with `npm run typecheck` instead. Deploy builds always type-check.
  typescript: { ignoreBuildErrors: process.env.IYNK_BUILD_SKIP_TYPECHECK === "1" && !process.env.VERCEL },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Figures are same-origin iframes: short cache, no framing by other sites.
        source: "/figures/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async redirects() {
    // A path with no language ("/", "/boards/uno-r3" from a pitch or a shared link): the saved language cookie, then
    // the browser's languages, then English. The query (a room link's ?room=) comes along.
    const toLanguage = (source: string, path: string) => [
      {
        source,
        has: [{ type: "cookie" as const, key: LANG_COOKIE, value: `(?<lang>${LOCALES.join("|")})` }],
        destination: `/:lang${path}`,
        permanent: false,
      },
      {
        source,
        has: [{ type: "header" as const, key: "accept-language", value: acceptLanguagePattern() }],
        destination: `/:lang${path}`,
        permanent: false,
      },
      { source, destination: `/${DEFAULT_LOCALE}${path}`, permanent: false },
    ];
    return [
      ...toLanguage("/", ""),
      ...toLanguage("/:section(boards|robotics|drones|about|together|passport|verify)/:rest*", "/:section/:rest*"),
    ];
  },
};

export default nextConfig;
