import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// The app's pure engines import "@/…" and some import "server-only", so the worker is bundled
// with the alias resolved and the react-server condition on (which makes server-only a no-op).
await build({
  entryPoints: { main: here("src/main.ts"), cli: here("src/cli.ts") },
  outdir: here("dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  conditions: ["react-server"],
  alias: { "@": here("../src") },
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  sourcemap: "inline",
  logLevel: "warning",
  loader: { ".json": "json" },
});
