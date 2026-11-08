import { z } from "zod";
import { DRONE_IDS } from "@/content/ids";
import { droneCalc as droneCalcTool, droneDesign } from "@/lib/server/mcp/tools/drone";
import { droneBom, offerParts, type BomLine, type Slot } from "@/lib/search/bom";
import { lineCost } from "@/lib/search/cost";
import { optimize, priceLines, type Candidate } from "@/lib/search/optimize";
import type { PartOffers } from "@/lib/search/types";
import { features } from "@/lib/server/env";
import { offers as fetchOffers } from "@/lib/server/search/serpapi";
import { callMcp } from "./mcp";
import { defineAgentTool } from "./types";


const droneId = z.enum(DRONE_IDS);

export const droneCalc = defineAgentTool({
  name: "drone_calc",
  description:
    "Run iynk's drone design calculator for one drone and one battery/motor/prop choice: all-up weight, thrust-to-weight, hover throttle, flight minutes, current draw, parts cost and design problems (checks with danger/warn levels). Leave options out for the default build.",
  input: z.object({
    drone: droneId.describe("Drone id, e.g. quad5 (5-inch freestyle), whoop, longrange."),
    battery: z.string().optional().describe('Battery option key, e.g. "6s1100".'),
    motor: z.string().optional(),
    prop: z.string().optional(),
  }),
  run: (args) => callMcp(droneCalcTool, args),
});

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

const summarize = (c: Candidate) => ({
  pick: { battery: c.pick.batt, motor: c.pick.motor, prop: c.pick.prop },
  costUsd: round(c.cost),
  thrustToWeight: round(c.tw),
  flightMinutes: round(c.flyMin, 1),
  allUpWeightG: Math.round(c.auw),
  hoverThrottle: round(c.hoverThr, 3),
  problems: c.checks.map((check) => check.code),
  fails: c.fails,
});

type Priced = { line: BomLine; cost: number; source: "live" | "estimate"; title?: string; url?: string };

/** One line's price the way priceLines does it: the best live offer for the quantity, else the catalogue estimate. */
function priceLine(line: BomLine, found: ReadonlyMap<string, PartOffers>): Priced {
  const entry = found.get(line.key);
  const offer = entry?.best !== undefined ? entry.offers[entry.best] : undefined;
  if (offer) return { line, cost: lineCost(offer, line.qty, line.pack), source: "live", title: offer.title, url: offer.url };
  return { line, cost: line.estimate ?? 0, source: "estimate" };
}

export const droneOptimize = defineAgentTool({
  name: "drone_optimize",
  description:
    "Find the battery, motor and prop combination for a drone that meets a minimum thrust-to-weight and flight time within a parts budget (it runs the calculator on all 27 combinations and prices them). Returns the best pick, what it trades against the default, the bill of materials, and why nothing fits when nothing does. Prices are the catalogue's estimates unless live_prices is true and SerpApi is set up.",
  input: z.object({
    drone: droneId,
    budget_usd: z.number().min(10).max(5000).describe("Most to spend on the whole parts list."),
    min_thrust_to_weight: z.number().min(0).max(20).default(2.5).describe("Lowest acceptable thrust-to-weight ratio."),
    min_flight_minutes: z.number().min(0).max(120).default(0).describe("Lowest acceptable flight minutes."),
    live_prices: z.boolean().default(false),
  }),
  async run({ drone, budget_usd, min_thrust_to_weight, min_flight_minutes, live_prices }, ctx) {
    const { design, pick: current } = await droneDesign(drone, {});
    const bom = droneBom(drone, design, current);
    const found = new Map<string, PartOffers>();
    let priceSource = "catalogue estimates";
    if (live_prices && features.search) {
      try {
        const live = await fetchOffers(offerParts(bom), ctx.signal);
        for (const part of live.parts) found.set(part.key, part);
        priceSource = live.partial ? "live prices (some missing, estimates used)" : "live prices";
      } catch {
        priceSource = "catalogue estimates (live search failed)";
      }
    }
    const result = optimize({
      design,
      ...priceLines(bom, found),
      budget: budget_usd,
      constraints: { minTW: min_thrust_to_weight, minFlightMin: min_flight_minutes },
      current,
    });
    const pickedBom = (pick: Candidate["pick"] | null) =>
      pick === null
        ? []
        : bom
            .filter((line) => (line.slot ? pick[line.slot as Slot] === line.option : line.inBuild))
            .map((line) => priceLine(line, found))
            .map(({ line, cost, source, title, url }) => ({
              part: "literal" in line.label ? line.label.literal : line.query,
              qty: line.qty,
              lineUsd: round(cost),
              source,
              ...(title ? { listing: title, url } : {}),
            }));
    return {
      drone,
      priceSource,
      constraints: { budgetUsd: budget_usd, minThrustToWeight: min_thrust_to_weight, minFlightMinutes: min_flight_minutes },
      considered: result.considered,
      best: result.best ? summarize(result.best) : null,
      reason: result.reason,
      defaultBuild: summarize(result.current),
      swaps: result.swaps,
      cheapestThatWorks: result.cheapest ? summarize(result.cheapest) : null,
      upgradeOverBudget: result.upgrade ? summarize(result.upgrade) : null,
      bom: pickedBom(result.best?.pick ?? null),
    };
  },
});
