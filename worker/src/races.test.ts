import { describe, expect, it } from "vitest";
import { trackHashOf } from "./chain";
import { courseResolver, knownCourses } from "./races";

describe("race mirror courses", () => {
  it("lists the fly page's course ids", async () => {
    const courses = await knownCourses();
    expect(courses.length).toBeGreaterThan(0);
    for (const c of courses) expect(c).toMatch(/^[a-z0-9]+-[a-z0-9-]+$/);
  });

  it("maps a track hash back to its course", () => {
    const resolve = courseResolver(["quad5-gates", "racer-sprint"]);
    expect(resolve(Buffer.from(trackHashOf("racer-sprint")).toString("hex"))).toBe("racer-sprint");
    expect(resolve("ab".repeat(32))).toBe("track-abababab");
  });
});
