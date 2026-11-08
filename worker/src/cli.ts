import "./boot";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runJob } from "./agent/run";
import { createModel } from "./model";
import { printEvent } from "./sinks/console";
import { MemorySink } from "./sinks/memory";
import { JOB_KINDS, type AgentJob, type JobKind } from "./types";

const USAGE = `usage: npm --prefix worker run job -- --kind <${JOB_KINDS.join("|")}> [--context '<json>' | --context-file <path>] [--fake] "<goal>"`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    kind: { type: "string", default: "build" },
    context: { type: "string" },
    "context-file": { type: "string" },
    fake: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const kind = values.kind as JobKind;
const goal = positionals.join(" ").trim();
if (!JOB_KINDS.includes(kind) || !goal) {
  console.error(USAGE);
  process.exit(2);
}

let context: Record<string, unknown> = {};
try {
  const raw = values["context-file"] ? readFileSync(values["context-file"], "utf8") : values.context;
  if (raw) context = JSON.parse(raw) as Record<string, unknown>;
} catch (error) {
  console.error(`context is not valid JSON: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const job: AgentJob = { id: "cli", kind, goal, context };
const sink = new MemorySink(job, values.json ? undefined : (event) => printEvent(event));

try {
  const model = createModel({ fake: values.fake || undefined });
  const { result } = await runJob(job, { model, sink });
  if (values.json) console.log(JSON.stringify({ result, steps: sink.steps, proposals: sink.proposals }, null, 2));
  else console.log(`\n${JSON.stringify(result, null, 2)}`);
} catch (error) {
  console.error(`\njob failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
