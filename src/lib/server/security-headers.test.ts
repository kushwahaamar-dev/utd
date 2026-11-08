import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("security headers", () => {
  it("send a CSP that allows Maincloud and nothing remote for scripts", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers;
    const get = (key: string) => all.find((h) => h.key === key)?.value ?? "";
    const csp = get("Content-Security-Policy");
    expect(csp).toContain("connect-src");
    expect(csp).toContain("wss://maincloud.spacetimedb.com");
    expect(csp).toContain("https://maincloud.spacetimedb.com");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src 'self'[^;]*(?!https:)/);
    expect(csp.match(/script-src [^;]*/)![0]).not.toMatch(/https?:/);
    expect(get("Strict-Transport-Security")).toContain("max-age=");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBeTruthy();
    expect(get("Permissions-Policy")).toContain("usb=()");
  });
});
