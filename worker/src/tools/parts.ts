import { z } from "zod";
import { priceParts } from "@/lib/server/mcp/tools/market";
import { features } from "@/lib/server/env";
import { SearchError, web } from "@/lib/server/search/serpapi";
import { callMcp } from "./mcp";
import { defineAgentTool } from "./types";

export const partsPrice = defineAgentTool({
  name: "parts_price",
  description:
    "Live shopping prices (Google Shopping, Amazon, eBay) for an item's parts list, or for a list of your own parts. Returns the cheapest in-stock listing per part and the total. Needs SerpApi; when it is not set up the answer says so and you should use catalogue estimates from drone_optimize instead.",
  input: z.object({
    lab: z.enum(["board", "robotics", "drone"]),
    id: z.string().min(1).max(64),
    battery: z.string().optional().describe("Drones only: battery option key."),
    motor: z.string().optional().describe("Drones only: motor option key."),
    prop: z.string().optional().describe("Drones only: prop option key."),
    parts: z
      .array(z.object({ name: z.string().min(2).max(160), qty: z.number().int().min(1).max(100) }))
      .max(25)
      .optional()
      .describe("Price this list instead of the item's own parts list."),
  }),
  run({ lab, id, battery, motor, prop, parts }) {
    const hasPick = Boolean(battery || motor || prop);
    return callMcp(priceParts, {
      lab,
      id,
      locale: "en",
      ...(hasPick ? { pick: { battery, motor, prop } } : {}),
      ...(parts ? { parts } : {}),
    });
  },
});

export const datasheetSearch = defineAgentTool({
  name: "datasheet_search",
  description:
    "Search the web for a component's datasheet or specification (for example 'TB6612FNG absolute maximum ratings') and read the top pages. Use it to check voltage and current limits before you trust a design. Needs SerpApi.",
  input: z.object({
    query: z.string().min(3).max(200),
    read_pages: z.boolean().default(true).describe("Also return the text of the top results."),
  }),
  async run({ query, read_pages }, ctx) {
    if (!features.search) return { error: "not_configured", message: "Web search (SerpApi) is not set up on this deployment." };
    try {
      const found = await web({ q: query.toLowerCase().includes("datasheet") ? query : `${query} datasheet`, extract: read_pages }, ctx.signal);
      return {
        results: found.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
        pages: (found.extracts ?? []).map((p) => ({ url: p.url, title: p.title, text: p.text.slice(0, 2500) })),
      };
    } catch (error) {
      if (error instanceof SearchError) return { error: error.code, message: error.message };
      throw error;
    }
  },
});
