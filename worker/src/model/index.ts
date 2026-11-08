import { features } from "@/lib/server/env";
import { config } from "../config";
import { FakeModel } from "./fake";
import { NemotronModel } from "./nemotron";
import type { ModelClient } from "./types";

export { FakeModel, NemotronModel };

export function createModel(opts: { fake?: boolean; fakeDelayMs?: number } = {}): ModelClient {
  if (opts.fake ?? config.fake) return new FakeModel({ delayMs: opts.fakeDelayMs ?? config.fakeDelayMs });
  if (!features.ai) throw new Error("Nemotron is not configured: set NVIDIA_API_KEY (or NEMOTRON_BASE_URL), or run with NEMOTRON_FAKE=1.");
  return new NemotronModel();
}
