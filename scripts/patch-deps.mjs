// Next's prerender refuses Math.random() during render, and spacetimedb/react's provider
// picks a random placeholder ConnectionId in its first render. The placeholder is replaced
// as soon as the real connection opens, so a zero id is just as good and is deterministic.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["node_modules/spacetimedb/dist/react/index.mjs", "node_modules/spacetimedb/dist/react/index.cjs"];
const from = "connectionId: ConnectionId.random(),";
const to = "connectionId: new ConnectionId(0n),";

for (const rel of files) {
  const file = join(root, rel);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes(from)) {
    writeFileSync(file, text.replaceAll(from, to));
    console.log(`patched ${rel}`);
  }
}
