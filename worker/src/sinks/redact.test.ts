import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("removes API keys, bearer tokens, private keys and secret-key arrays", () => {
    const bytes = JSON.stringify(Array.from({ length: 64 }, (_, i) => i * 3));
    const text = `key nvapi-abcdefghijklmnopqrstuvwxyz and Bearer abcdefghijklmnopqrstuvwxyz0123 and ${bytes} and "api_key": "abcdefghijklmnop1234"`;
    const out = redact(text);
    expect(out).not.toMatch(/nvapi-abc|abcdefghijklmnopqrstuvwxyz0123|abcdefghijklmnop1234/);
    expect(out).not.toContain("[0,3,6");
    expect(out.match(/\[redacted\]/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("leaves ordinary tool output alone", () => {
    const text = JSON.stringify({ thrust_to_weight: 4.2, parts: ["frame", "motor"], pda: "short" });
    expect(redact(text)).toBe(text);
  });
});
