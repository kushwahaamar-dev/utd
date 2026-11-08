import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRONE_IDS } from "@/content/ids";
import { loadDrone } from "@/content/index.generated";
import { flightOf, parOf } from "@/lib/flight/registry";

// The shortest lap the module accepts per `<craft>-<course>`: the straight-line path from the pad through every
// gate (or checkpoint) at a speed no craft in the sim sustains, or half the gold par, whichever is longer: only an
// impossible time is refused. The
// SpacetimeDB module cannot load the content, so it reads this table. Regenerate: UPDATE_LAP_FLOORS=1 npx vitest run lap-floors

const FILE = "src/lib/verify/lap-floors.json";
const VMAX = 45;
const MIN_MS = 2000;

async function compute() {
  const floors: Record<string, number> = {};
  for (const id of DRONE_IDS) {
    const content = await loadDrone(id);
    const flight = content ? flightOf(content) : null;
    if (!flight) continue;
    for (const course of flight.courses) {
      const gold = parOf(content?.courses.find((c) => c.id === course.id) ?? { par: undefined, parS: undefined })?.gold ?? 0;
      const stops = course.gates.length ? course.gates : course.checkpoints;
      let at: [number, number] = course.pad;
      let length = 0;
      for (const s of stops) {
        length += Math.hypot(s.x - at[0], s.y - at[1]);
        at = [s.x, s.y];
      }
      floors[`${id}-${course.id}`] = Math.max(MIN_MS, Math.floor((length / VMAX) * 1000), Math.floor(gold * 500));
    }
  }
  return floors;
}

describe("lap floors", () => {
  it("match the content", async () => {
    const floors = await compute();
    if (process.env.UPDATE_LAP_FLOORS) writeFileSync(FILE, JSON.stringify(floors, null, 1) + "\n");
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(floors);
    expect(Object.keys(floors).length).toBeGreaterThan(5);
  });
});
