import { z } from "zod";
import type { FailureMode, FigureState, RoboticsContent } from "@/content/schema";
import { ROBOTICS_IDS } from "@/content/ids";
import { currentDraw } from "@/lib/robotics/current";
import { loadContent, proseOf, type Prose } from "@/lib/server/mcp/content";
import { defineAgentTool } from "./types";

const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));

function describeTrigger(trigger: FailureMode["trigger"]): string {
  const { by, ...rest } = trigger;
  return `${by} ${Object.values(rest).flat().join(" ")}`.trim();
}

function describeFault(fault: FailureMode, t: Prose) {
  return {
    id: fault.id,
    kind: fault.kind,
    title: t(fault.title),
    symptom: t(fault.symptom),
    cause: t(fault.explanation),
    fix: t(fault.fix),
    trigger: describeTrigger(fault.trigger),
    effect: {
      power: fault.effect.power,
      halts: fault.effect.halts,
      ...(fault.effect.damages ? { damages: fault.effect.damages } : {}),
      ...(fault.effect.extraMa ? { extraMa: fault.effect.extraMa } : {}),
      ...(fault.effect.pins ? { pins: fault.effect.pins } : {}),
    },
  };
}

function parseState(json: string | undefined): FigureState | string {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as FigureState) : "state_json must be a JSON object";
  } catch {
    return "state_json is not valid JSON";
  }
}

export const benchCheck = defineAgentTool({
  name: "bench_check",
  description:
    "Analyse a robotics bench's circuit with iynk's fault model: the supply current draw against each rail's limit (brownout risk), the effect of any active faults (burnt LED, reversed capacitor, brownout, shorts, cold joints), and, when you pass a symptom, the known faults ranked by how well they explain it with the cause and the fix for each.",
  input: z.object({
    id: z.enum(ROBOTICS_IDS).describe("Bench id, e.g. led-resistor, tb6612fng, lm2596."),
    faults: z.array(z.string()).max(10).optional().describe("Ids of faults currently active on the bench."),
    symptom: z.string().max(400).optional().describe('What the user sees, e.g. "LED is dark and the 5V rail reads 3.1V".'),
    state_json: z.string().max(4000).optional().describe("The bench's reported figure state as a JSON object, for the current model."),
  }),
  async run({ id, faults, symptom, state_json }) {
    const content = (await loadContent("robotics", id)) as RoboticsContent | null;
    if (!content) return { error: "not_found", message: `The ${id} bench data is not on this deployment.` };
    const state = parseState(state_json);
    if (typeof state === "string") return { error: "bad_input", message: state };
    const t = await proseOf("en", "robotics", id);

    const active = (faults ?? []).map((faultId) => content.faults.find((f) => f.id === faultId));
    const unknown = (faults ?? []).filter((_, i) => !active[i]);
    const activeFaults = active.filter((f): f is FailureMode => Boolean(f));
    const draw = currentDraw(content.current, state, activeFaults);

    const query = words(symptom ?? "");
    const ranked = content.faults
      .filter((f) => !activeFaults.includes(f))
      .map((fault) => {
        const text = words([t(fault.title), t(fault.symptom), t(fault.explanation), fault.kind].join(" "));
        const score = [...query].filter((w) => text.has(w)).length;
        return { fault, score };
      })
      .filter(({ score }) => query.size === 0 || score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      bench: id,
      title: t(content.title),
      supplies: draw.supplies.map((s) => ({
        id: s.id,
        volts: s.volts,
        limitMa: s.limitMa,
        drawMa: s.ma,
        headroomMa: s.headroomMa,
        overLimit: s.over,
        loads: s.loads.map((l) => `${l.id} ${l.ma} mA`),
      })),
      totalMa: draw.totalMa,
      overLimit: draw.over,
      activeFaults: activeFaults.map((f) => describeFault(f, t)),
      ...(unknown.length ? { unknownFaultIds: unknown, knownFaultIds: content.faults.map((f) => f.id) } : {}),
      candidates: ranked.map(({ fault, score }) => ({ ...describeFault(fault, t), matchScore: score })),
      knownFaults: content.faults.length,
    };
  },
});
