import { schema, table, t } from "spacetimedb/server";

// Tables follow docs/ARCHITECTURE.md. Keys here are camelCase; the SDK stores
// them as snake_case (roomCode is room_code), and the generated client
// bindings use the camelCase names again.

const player = table(
  { name: "player", public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    color: t.string(),
    lang: t.string(),
    wallet: t.option(t.string()),
    online: t.bool(),
    lastSeen: t.timestamp(),
    createdAt: t.timestamp(),
  },
);

const room = table(
  { name: "room", public: true },
  {
    code: t.string().primaryKey(),
    lab: t.string(),
    itemId: t.string(),
    host: t.identity(),
    epoch: t.u32(),
    seq: t.u64(),
    createdAt: t.timestamp(),
    emptySince: t.option(t.timestamp()),
  },
);

const roomMember = table(
  { name: "room_member", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index("btree"),
    identity: t.identity().index("btree"),
    name: t.string(),
    color: t.string(),
    role: t.string(),
    labRole: t.option(t.string()),
    status: t.string(),
    baton: t.bool(),
    done: t.string(),
    joinedAt: t.timestamp(),
  },
);

const roomAction = table(
  { name: "room_action", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index("btree"),
    seq: t.u64(),
    from: t.identity(),
    action: t.string(),
    at: t.timestamp(),
  },
);

const roomSnapshot = table(
  { name: "room_snapshot", public: true },
  {
    roomCode: t.string().primaryKey(),
    seq: t.u64(),
    state: t.string(),
    by: t.identity(),
    at: t.timestamp(),
  },
);

const chatMessage = table(
  { name: "chat_message", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index("btree"),
    from: t.identity(),
    name: t.string(),
    text: t.string(),
    lang: t.string(),
    kind: t.string(),
    at: t.timestamp(),
  },
);

const chatTranslation = table(
  { name: "chat_translation", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    messageId: t.u64().index("btree"),
    roomCode: t.string().index("btree"),
    lang: t.string(),
    text: t.string(),
  },
);

const cursorEvt = table(
  { name: "cursor_evt", public: true, event: true },
  { roomCode: t.string(), from: t.identity(), x: t.f64(), y: t.f64() },
);

const poseEvt = table(
  { name: "pose_evt", public: true, event: true },
  {
    roomCode: t.string(),
    from: t.identity(),
    p: t.string(),
    q: t.string(),
    v: t.option(t.string()),
    gate: t.option(t.string()),
  },
);

// Private: clients read their own rows through the my_progress view.
const progress = table(
  { name: "progress" },
  {
    id: t.u64().primaryKey().autoInc(),
    identity: t.identity().index("btree"),
    key: t.string(),
    at: t.timestamp(),
  },
);

const lap = table(
  { name: "lap", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    identity: t.identity().index("btree"),
    name: t.string(),
    course: t.string().index("btree"),
    timeMs: t.u32(),
    inputs: t.string(),
    verified: t.bool(),
    at: t.timestamp(),
  },
);

const leaderboard = table(
  {
    name: "leaderboard",
    public: true,
    indexes: [{ accessor: "byCourseIdentity", algorithm: "btree", columns: ["course", "identity"] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    course: t.string().index("btree"),
    identity: t.identity(),
    name: t.string(),
    bestMs: t.u32(),
    lapId: t.u64(),
    at: t.timestamp(),
  },
);

const activityMinute = table(
  {
    name: "activity_minute",
    public: true,
    indexes: [{ accessor: "byMinuteKind", algorithm: "btree", columns: ["minute", "kind"] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    minute: t.timestamp().index("btree"),
    kind: t.string(),
    count: t.u32(),
  },
);

const buddyProfile = table(
  { name: "buddy_profile", public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    lang: t.string(),
    interests: t.string(),
    built: t.string(),
    wants: t.string(),
    updatedAt: t.timestamp(),
    expiresAt: t.timestamp().index("btree"),
  },
);

const agentJob = table(
  { name: "agent_job", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity().index("btree"),
    roomCode: t.option(t.string()),
    kind: t.string(),
    goal: t.string(),
    context: t.string(),
    status: t.string().index("btree"),
    result: t.option(t.string()),
    error: t.option(t.string()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const agentStep = table(
  {
    name: "agent_step",
    public: true,
    indexes: [{ accessor: "byJobIdx", algorithm: "btree", columns: ["jobId", "idx"] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    jobId: t.u64().index("btree"),
    idx: t.u32(),
    role: t.string(),
    title: t.string(),
    tool: t.option(t.string()),
    input: t.string(),
    output: t.string(),
    status: t.string(),
    model: t.option(t.string()),
    ms: t.u32(),
    at: t.timestamp(),
  },
);

const agentProposal = table(
  { name: "agent_proposal", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    jobId: t.u64().index("btree"),
    kind: t.string(),
    payload: t.string(),
    status: t.string(),
    at: t.timestamp(),
  },
);

const race = table(
  { name: "race", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    onchain: t.string().unique(),
    course: t.string(),
    entryLamports: t.u64(),
    potLamports: t.u64(),
    closesAt: t.timestamp(),
    status: t.string(),
    settleSig: t.option(t.string()),
  },
);

const raceEntry = table(
  { name: "race_entry", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    raceId: t.u64().index("btree"),
    identity: t.identity().index("btree"),
    wallet: t.string(),
    enterSig: t.string(),
    bestMs: t.option(t.u32()),
    lapId: t.option(t.u64()),
    verified: t.bool(),
    resultSig: t.option(t.string()),
    payoutLamports: t.option(t.u64()),
  },
);

const credential = table(
  { name: "credential", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    identity: t.identity().index("btree"),
    wallet: t.string().index("btree"),
    skill: t.string(),
    pda: t.string(),
    sig: t.string(),
    at: t.timestamp(),
  },
);

const chainJob = table(
  { name: "chain_job", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(),
    payload: t.string(),
    status: t.string().index("btree"),
    sig: t.option(t.string()),
    error: t.option(t.string()),
    createdAt: t.timestamp(),
  },
);

// Who a queued credential is for; chain_job itself carries no identity column.
const chainJobOwner = table(
  { name: "chain_job_owner" },
  { jobId: t.u64().primaryKey(), identity: t.identity() },
);

const rateBucket = table(
  { name: "rate_bucket" },
  { key: t.string().primaryKey(), tokens: t.f64(), updatedUs: t.u64() },
);

const searchCache = table(
  { name: "search_cache" },
  { key: t.string().primaryKey(), value: t.string(), expiresAt: t.timestamp() },
);

const config = table(
  { name: "config" },
  { key: t.string().primaryKey(), value: t.string(), identity: t.option(t.identity()) },
);

// One row per live socket, so an identity with two tabs only goes offline
// when the last one closes.
const connection = table(
  { name: "connection" },
  { id: t.string().primaryKey(), identity: t.identity().index("btree") },
);

const roomBan = table(
  { name: "room_ban" },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index("btree"),
    identity: t.identity().index("btree"),
  },
);

const sweepTimer = table(
  { name: "sweep_timer" },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), job: t.string() },
);

const raceCloseTimer = table(
  { name: "race_close_timer" },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), raceId: t.u64() },
);

const spacetimedb = schema(
  {
    player,
    room,
    roomMember,
    roomAction,
    roomSnapshot,
    chatMessage,
    chatTranslation,
    cursorEvt,
    poseEvt,
    progress,
    lap,
    leaderboard,
    activityMinute,
    buddyProfile,
    agentJob,
    agentStep,
    agentProposal,
    race,
    raceEntry,
    credential,
    chainJob,
    chainJobOwner,
    rateBucket,
    searchCache,
    config,
    connection,
    roomBan,
    sweepTimer,
    raceCloseTimer,
  },
  {
    env: {
      WORKER_SECRET: t.string().optional(),
      NVIDIA_API_KEY: t.string().optional(),
      NEMOTRON_FAST_MODEL: t.string().optional(),
      SERPAPI_KEY: t.string().optional(),
    },
  },
);

export default spacetimedb;
export { sweepTimer, raceCloseTimer };
