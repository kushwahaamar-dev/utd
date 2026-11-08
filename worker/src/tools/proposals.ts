import { z } from "zod";
import { defineAgentTool } from "./types";

const queued = (what: string) => ({ ok: true, status: "pending", note: `${what} was sent to the user as a proposal. Nothing changes until they accept it.` });

export const proposeChange = defineAgentTool({
  name: "propose_change",
  description:
    "Suggest a concrete change to the user's project (a code fix, a wiring change, a different part, a config value). It appears in their Mission Control as a proposal they can accept or reject; nothing is applied automatically.",
  input: z.object({
    target: z.enum(["code", "wiring", "part", "config"]),
    title: z.string().min(3).max(120).describe("One line saying what changes."),
    detail: z.string().min(3).max(1200).describe("Why, and exactly what to do."),
    code: z.string().max(8000).optional().describe("Replacement code, for target=code."),
  }),
  async run(args, ctx) {
    await ctx.sink.addProposal("propose_change", args);
    return queued("The change");
  },
});

export const askPeer = defineAgentTool({
  name: "ask_peer",
  description: "Suggest asking another person in the room (a peer who has passed the same lesson, or the host) a specific question. The user sees it as a proposal.",
  input: z.object({
    question: z.string().min(3).max(400),
    peer: z.string().max(40).optional().describe("A name from the room context, if one fits."),
  }),
  async run(args, ctx) {
    await ctx.sink.addProposal("ask_peer", args);
    return queued("The question");
  },
});

export const highlightPart = defineAgentTool({
  name: "highlight_part",
  description: "Point at a part, pin or wire in the user's figure and say why it matters. The user sees the highlight as a proposal.",
  input: z.object({
    part: z.string().min(1).max(60).describe("A part id such as D1, R1, U1, or a net name such as 5V."),
    reason: z.string().min(3).max(300),
  }),
  async run(args, ctx) {
    await ctx.sink.addProposal("highlight_part", args);
    return queued("The highlight");
  },
});
