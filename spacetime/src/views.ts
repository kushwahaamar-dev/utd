import { t } from "spacetimedb/server";
import spacetimedb, { agentJob, agentProposal, agentStep, chainJob, chatMessage, chatTranslation, playerWallet, room, roomAction, roomMember, roomSnapshot } from "./schema";

const LIVE = ["queued", "planning", "running", "reviewing"];

const isWorker = (ctx: { sender: { equals(o: unknown): boolean }; db: { config: { key: { find(k: string): { identity?: unknown } | null | undefined } } } }) => {
  const row = ctx.db.config.key.find("worker");
  return !!row?.identity && ctx.sender.equals(row.identity);
};

// progress is private; this is how a client reads its own rows.
export const myProgress = spacetimedb.view(
  { name: "my_progress", public: true },
  t.array(t.row("ProgressRow", { id: t.u64(), identity: t.identity(), key: t.string(), at: t.timestamp() })),
  (ctx) => [...ctx.db.progress.identity.filter(ctx.sender)],
);

// room_member is private: you see the roster of the rooms you are in, and nobody else's.
export const myRoomMembers = spacetimedb.view(
  { name: "my_room_members", public: true },
  t.array(roomMember.rowType),
  (ctx) => {
    const out = [];
    for (const mine of ctx.db.roomMember.identity.filter(ctx.sender)) out.push(...ctx.db.roomMember.roomCode.filter(mine.roomCode));
    return out;
  },
);

// player_wallet is private: you can read back your own link, nobody else's.
export const myWallet = spacetimedb.view(
  { name: "my_wallet", public: true },
  t.array(playerWallet.rowType),
  (ctx) => {
    const row = ctx.db.playerWallet.identity.find(ctx.sender);
    return row ? [row] : [];
  },
);

// chain_job is private (payloads carry identities and wallets): a client sees the jobs queued for its own identity.
export const myChainJobs = spacetimedb.view(
  { name: "my_chain_jobs", public: true },
  t.array(chainJob.rowType),
  (ctx) => {
    const out = [];
    for (const owner of ctx.db.chainJobOwner.identity.filter(ctx.sender)) {
      const job = ctx.db.chainJob.id.find(owner.jobId);
      if (job) out.push(job);
    }
    return out;
  },
);

// The worker's own feeds; empty for everybody else.
export const workerChainJobs = spacetimedb.view(
  { name: "worker_chain_jobs", public: true },
  t.array(chainJob.rowType),
  (ctx) => (isWorker(ctx) ? [...ctx.db.chainJob.status.filter("queued")] : []),
);

export const workerAgentJobs = spacetimedb.view(
  { name: "worker_agent_jobs", public: true },
  t.array(agentJob.rowType),
  (ctx) => {
    if (!isWorker(ctx)) return [];
    const out = [];
    for (const status of [...LIVE, "cancelled"]) out.push(...ctx.db.agentJob.status.filter(status));
    return out;
  },
);

// A room's contents reach its members only. Each view is a semijoin on the caller's seats, so it is kept up to date
// incrementally instead of being recomputed on every action.
export const myRooms = spacetimedb.view({ name: "my_rooms", public: true }, t.array(room.rowType), (ctx) =>
  ctx.from.roomMember.where((m) => m.identity.eq(ctx.sender)).rightSemijoin(ctx.from.room, (m, r) => m.roomCode.eq(r.code)),
);

export const myRoomActions = spacetimedb.view({ name: "my_room_actions", public: true }, t.array(roomAction.rowType), (ctx) =>
  ctx.from.roomMember.where((m) => m.identity.eq(ctx.sender)).rightSemijoin(ctx.from.roomAction, (m, a) => m.roomCode.eq(a.roomCode)),
);

export const myRoomSnapshots = spacetimedb.view({ name: "my_room_snapshots", public: true }, t.array(roomSnapshot.rowType), (ctx) =>
  ctx.from.roomMember.where((m) => m.identity.eq(ctx.sender)).rightSemijoin(ctx.from.roomSnapshot, (m, s) => m.roomCode.eq(s.roomCode)),
);

export const myChat = spacetimedb.view({ name: "my_chat", public: true }, t.array(chatMessage.rowType), (ctx) =>
  ctx.from.roomMember.where((m) => m.identity.eq(ctx.sender)).rightSemijoin(ctx.from.chatMessage, (m, c) => m.roomCode.eq(c.roomCode)),
);

export const myChatTranslations = spacetimedb.view({ name: "my_chat_translations", public: true }, t.array(chatTranslation.rowType), (ctx) =>
  ctx.from.roomMember.where((m) => m.identity.eq(ctx.sender)).rightSemijoin(ctx.from.chatTranslation, (m, c) => m.roomCode.eq(c.roomCode)),
);

// Steps hold the tool output and proposals the suggested changes: they belong to the job's owner.
export const myAgentSteps = spacetimedb.view({ name: "my_agent_steps", public: true }, t.array(agentStep.rowType), (ctx) =>
  ctx.from.agentJob.where((j) => j.owner.eq(ctx.sender)).rightSemijoin(ctx.from.agentStep, (j, s) => j.id.eq(s.jobId)),
);

export const myAgentProposals = spacetimedb.view({ name: "my_agent_proposals", public: true }, t.array(agentProposal.rowType), (ctx) =>
  ctx.from.agentJob.where((j) => j.owner.eq(ctx.sender)).rightSemijoin(ctx.from.agentProposal, (j, p) => j.id.eq(p.jobId)),
);
