import type { z } from "zod";

/** The first balanced JSON object in a model reply, which may sit inside a code fence or after some prose. */
export function extractJson(text: string): unknown {
  const body = text.replace(/```(?:json)?/gi, "");
  for (let start = body.indexOf("{"); start !== -1; start = body.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < body.length; i++) {
      const ch = body[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("no JSON object in the reply");
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; problem: string };

export function parseReply<S extends z.ZodType>(schema: S, text: string, check?: (data: z.output<S>) => string | null): Parsed<z.output<S>> {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : "unreadable reply" };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, problem: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "reply"}: ${i.message}`).join("; ") };
  }
  const problem = check?.(parsed.data);
  return problem ? { ok: false, problem } : { ok: true, data: parsed.data };
}
