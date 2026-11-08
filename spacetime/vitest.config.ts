import { defineConfig, type Plugin } from "vitest/config";
import { spacetimedbModuleTestPlugin } from "spacetimedb/server/test-utils/vitest";

// Module tests run against the in-memory datastore; the plugin swaps the host imports for it.
export default defineConfig({
  plugins: [spacetimedbModuleTestPlugin() as unknown as Plugin],
  resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["src/**/*.test.ts", "live.test.ts"], testTimeout: 30_000 },
});
