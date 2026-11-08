import { sha256 } from "@noble/hashes/sha2.js";
import { DRONES, isDroneId, type DroneId } from "../../src/content/ids";
import { replayDroneSafety, type DroneTestSet } from "../../src/lib/verify/drone-safety";
import { canonicalJson, toHex } from "../../src/lib/verify/hash";
import { runLogSchema, type RunKind, type RunLog } from "../../src/lib/verify/runlog";
import { skillIdFor } from "../../src/lib/verify/skill";

export type Verdict =
  | { ok: true; score: number; replayHash: string; skillId: string }
  | { ok: false; reason: string };

const encoder = new TextEncoder();

/** Same digest the web app computes with WebCrypto: sha256 of the canonical JSON of the inputs. */
export function replayHashOf(inputs: unknown): string {
  return toHex(sha256(encoder.encode(canonicalJson(inputs))));
}

/** The bench tests a craft has. The content modules agree with these defaults for every drone but the whoop (no smoke stopper). */
function testsFor(id: DroneId): DroneTestSet {
  return { smoke: id !== "whoop", motors: DRONES[id].motors > 0, calibrate: true };
}

export function parseRun(text: string): RunLog | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "run log is not valid JSON";
  }
  const parsed = runLogSchema.safeParse(raw);
  if (!parsed.success) return `bad run log: ${parsed.error.issues[0]?.message ?? "shape"} at ${parsed.error.issues[0]?.path.join(".") ?? "?"}`;
  return parsed.data;
}

/** Re-runs a lab run. Nothing the client says about the outcome is trusted: verdict and score come from the replay. */
export function verifyRun(kind: RunKind, itemId: string, sub: string | undefined, run: RunLog): Verdict {
  if (run.kind !== kind || run.itemId !== itemId || (run.sub ?? undefined) !== sub) {
    return { ok: false, reason: "The run log is for a different lab item." };
  }
  const skillId = skillIdFor(kind, itemId, sub);
  if (!skillId) return { ok: false, reason: "Unknown skill." };
  const hash = replayHashOf(run.inputs);

  if (kind !== "drone-safety") return { ok: false, reason: `The server cannot re-run "${kind}" runs yet.` };
  if (!isDroneId(itemId)) return { ok: false, reason: "Unknown drone." };
  const tests = testsFor(itemId);
  const report = replayDroneSafety(run.inputs, tests);
  if (!report) return { ok: false, reason: "The inputs are not a bench run." };
  if (!report.pass) {
    const why = report.violations.length ? `rule broken: ${report.violations.join(", ")}` : "not every safety test passed";
    return { ok: false, reason: `The replay did not pass (${why}).` };
  }
  return { ok: true, score: report.score, replayHash: hash, skillId };
}
