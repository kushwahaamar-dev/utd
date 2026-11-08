import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, parseReply } from "./json";

describe("extractJson", () => {
  it("reads a bare object, a fenced one, and one after prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":{"b":[1,2]}}\n```')).toEqual({ a: { b: [1, 2] } });
    expect(extractJson('Thinking... the plan is {"a":"x } y"} and that is all.')).toEqual({ a: "x } y" });
  });

  it("throws when there is nothing to read", () => {
    expect(() => extractJson("no braces here")).toThrow();
    expect(() => extractJson("{broken")).toThrow();
  });
});

describe("parseReply", () => {
  const schema = z.object({ n: z.number() });
  it("names the field that failed", () => {
    const bad = parseReply(schema, '{"n":"three"}');
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok === false && bad.problem).toContain("n:");
  });

  it("runs the semantic check", () => {
    expect(parseReply(schema, '{"n":-1}', (d) => (d.n < 0 ? "n must not be negative" : null))).toEqual({ ok: false, problem: "n must not be negative" });
    expect(parseReply(schema, '{"n":2}')).toEqual({ ok: true, data: { n: 2 } });
  });
});
