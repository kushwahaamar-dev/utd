import { toolMessage } from "../tools/clip";
import type { SinkEvent } from "./memory";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const color = { planner: "\x1b[35m", executor: "\x1b[36m", critic: "\x1b[33m", tool: "\x1b[32m", system: "\x1b[37m" } as const;

/** Prints a job's trace as it happens. */
export function printEvent(event: SinkEvent, log: (line: string) => void = console.log) {
  switch (event.type) {
    case "status":
      log(bold(`\n== ${event.status}${event.error ? `: ${event.error}` : ""}`));
      break;
    case "start": {
      const { role, title, tool } = event.step;
      if (role === "tool") log(`${color.tool}  tool${"\x1b[0m"} ${tool} ${dim(toolMessage(event.step.input, 300))}`);
      else log(`${color[role]}${role}\x1b[0m ${bold(title)}`);
      break;
    }
    case "finish": {
      const { role } = event.step;
      const out = toolMessage(event.end.output, role === "tool" ? 400 : 1200);
      log(`${role === "tool" ? "    " : "  "}${event.end.status === "ok" ? "ok" : "ERROR"} ${dim(`${event.end.ms}ms`)} ${dim(out)}`);
      break;
    }
    case "proposal":
      log(`  proposal ${event.kind} ${dim(toolMessage(event.payload, 300))}`);
      break;
  }
}
