import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Imported first by every entry point, so the app's env module (which reads process.env once at import)
// sees the values from .env.local. Variables already in the environment win.
for (const file of ["../.env.local", ".env.local", "../.env"]) {
  const path = fileURLToPath(new URL(file, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
