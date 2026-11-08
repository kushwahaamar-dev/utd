import { z } from "zod";
import { getItem, searchCatalog } from "@/lib/server/mcp/tools/catalog";
import { callMcp } from "./mcp";
import { defineAgentTool } from "./types";

const lab = z.enum(["board", "robotics", "drone"]);

export const catalogSearch = defineAgentTool({
  name: "catalog_search",
  description:
    "Search iynk's catalogue of boards (Arduino, ESP32, Pi, FPGA), robotics benches and drones by words. Returns ids to pass to catalog_get, drone_calc, bench_check or sim_run.",
  input: z.object({
    query: z.string().min(1).max(200).describe('Words to look for, e.g. "5 inch freestyle drone", "motor driver", "esp32 wifi".'),
    lab: lab.optional().describe("Only search one lab."),
    limit: z.number().int().min(1).max(12).default(6),
  }),
  run: (args) => callMcp(searchCatalog, { ...args, locale: "en" }),
});

export const catalogGet = defineAgentTool({
  name: "catalog_get",
  description:
    "Details of one catalogue item: for a drone its battery, motor and prop option keys and parts; for a robotics bench its modules, practice task ids and parts; for a board its lessons (ids to pass to sim_run).",
  input: z.object({ lab, id: z.string().min(1).max(64).describe("Item id from catalog_search, e.g. quad5, led-resistor, uno-r3.") }),
  run: (args) => callMcp(getItem, { ...args, locale: "en" }),
});
