import { z } from "zod";
import type { BoardContent, Check, Language, PracticeTask, RoboticsContent } from "@/content/schema";
import { lessonJob, runChecks, taskJob, type CheckJob } from "@/lib/interp";
import { loadContent, proseOf } from "@/lib/server/mcp/content";
import { defineAgentTool } from "./types";

const MAX_SERIAL_LINES = 24;
const MAX_NETS = 14;

const round = (n: number) => Math.round(n * 1000) / 1000;

function describeCheck(check: Check): string {
  const { kind, label, ...rest } = check as Check & Record<string, unknown>;
  void label;
  return `${kind} ${JSON.stringify(rest)}`;
}

export const simRun = defineAgentTool({
  name: "sim_run",
  description:
    "Run Arduino C++ / MicroPython / Python code in iynk's real interpreter on a board and see what it does: serial output, pin activity and runtime errors. Give lesson_id (a board lesson) or task_id (a robotics practice task) to run against that exercise's simulated world and get its pass/fail checks; otherwise give board and language for a free run with no external inputs.",
  input: z.object({
    code: z.string().min(1).max(20_000).describe("The full program."),
    lab: z.enum(["board", "robotics"]).optional().describe("With lesson_id (board) or task_id (robotics)."),
    id: z.string().max(64).optional().describe("The board id (for lesson_id) or bench id (for task_id)."),
    lesson_id: z.string().max(64).optional(),
    task_id: z.string().max(64).optional(),
    board: z.string().max(40).optional().describe("Free run: board id such as uno-r3, esp32-devkitc, pico."),
    language: z.enum(["arduino-cpp", "micropython", "python", "verilog"]).optional().describe("Free run: the language of the code."),
    run_ms: z.number().int().min(100).max(30_000).default(3000).describe("Free run: virtual milliseconds to simulate."),
  }),
  async run({ code, lab, id, lesson_id, task_id, board, language, run_ms }) {
    let job: CheckJob;
    let prose: Awaited<ReturnType<typeof proseOf>> | null = null;
    if (lesson_id) {
      if (lab !== "board" || !id) return { error: "bad_input", message: "lesson_id needs lab=board and id=<board id>." };
      const content = (await loadContent("board", id)) as BoardContent | null;
      const lesson = content?.lessons.find((l) => l.id === lesson_id);
      if (!content || !lesson) return { error: "not_found", message: `No lesson ${lesson_id} on ${id}. catalog_get lists the lesson ids.` };
      job = lessonJob(content, lesson, code);
      prose = await proseOf("en", "board", id);
    } else if (task_id) {
      if (lab !== "robotics" || !id) return { error: "bad_input", message: "task_id needs lab=robotics and id=<bench id>." };
      const content = (await loadContent("robotics", id)) as RoboticsContent | null;
      const task = content?.tasks.find((t: PracticeTask) => t.id === task_id);
      if (!content || !task) return { error: "not_found", message: `No task ${task_id} on ${id}. catalog_get lists the task ids.` };
      job = taskJob(task, code);
      prose = await proseOf("en", "robotics", id);
    } else {
      if (!board || !language) return { error: "bad_input", message: "A free run needs board and language, or give lesson_id / task_id." };
      job = { board, language: language as Language, source: code, world: { inputs: [], script: [] }, runMs: run_ms, checks: [] };
    }

    const { trace, results } = runChecks(job);
    const nets = Object.entries(trace.pins).slice(0, MAX_NETS);
    return {
      simulatedMs: trace.ms,
      error: trace.error,
      serial: trace.serial.slice(0, MAX_SERIAL_LINES).map((line) => `${line.t}ms ${line.text}`),
      serialLines: trace.serial.length,
      pins: Object.fromEntries(
        nets.map(([net, events]) => [net, { changes: events.length, last: { mode: events.at(-1)?.mode, value: round(events.at(-1)?.v ?? 0) } }]),
      ),
      checks: job.checks.map((check, i) => ({
        what: prose?.(check.label) ?? describeCheck(check),
        ok: results[i].ok,
        ...(results[i].detail ? { detail: results[i].detail } : {}),
      })),
      passed: results.filter((r) => r.ok).length,
      total: results.length,
    };
  },
});
