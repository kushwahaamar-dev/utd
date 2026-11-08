# Architecture

iynk is a hardware lab in the browser. The labs, figures, interpreters and flight sim run on the client.
Everything shared, persistent or trusted runs on **SpacetimeDB**. **Nemotron** agents do multi-step work through
tools that run the real simulators. **Solana** holds credentials and race prize pools. The module runs on
SpacetimeDB **Maincloud**; the worker, the site and an optional Nemotron GPU run on **Vultr**.

```
Browser (Next.js 16) ── one WebSocket ──► SpacetimeDB module (spacetime/)
  labs, figures, sims                       tables · reducers · views · schedules · procedures (HTTP out)
  spacetimedb/react hooks                          ▲ subscribes to agent_job / chain_job
  wallet adapter                                   │ writes results through worker-only reducers
                                            Agent worker (worker/, Node)
                                              Nemotron planner → executor → critic, tools = real engines
                                              Solana oracle/issuer signer
                                                   │                       │
                                       NVIDIA / vLLM on Vultr GPU     Solana devnet (iynk_passport)
```

## Ownership

| Path | Owner | Notes |
|---|---|---|
| `spacetime/` | module | TypeScript SpacetimeDB module, 2.14.x |
| `src/lib/stdb/` | module | connection, token persistence, provider, generated bindings (`bindings/`), typed hooks |
| `worker/` | agents | Node service: Nemotron agent loop, tools, Solana signing (`worker/src/chain/` belongs to Solana) |
| `solana/`, `src/lib/solana/` | Solana | Anchor program `iynk_passport` v2 |
| `src/app/[lang]/page.tsx`, `src/components/shell/`, `src/components/editorial/`, `src/app/globals.css` | design | kshv-style editorial design system |
| `src/app/[lang]/mission/`, `src/components/mission/` | design | Mission Control (agent) UI |
| `deploy/`, `scripts/deploy-*`, `scripts/publish-maincloud.sh` | deploy | Maincloud publish; Vultr compose: worker, web, Caddy (SpacetimeDB standalone optional) |

## SpacetimeDB schema (contract)

Every table name is snake_case. "JSON" means a string column holding JSON. Times are `Timestamp`.

| Table | Visibility | Columns |
|---|---|---|
| `player` | public | `identity` pk, `name`, `color`, `lang`, `online`, `last_seen`, `created_at` |
| `player_wallet` | private (own row via view `my_wallet`) | `identity` pk, `wallet` btree. Written by `link_wallet`, which needs the wallet's ed25519 signature |
| `room` | private (members via view `my_rooms`) | `code` pk (8 chars), `topic` (opaque id for the public cursor/pose events), `lab`, `item_id`, `host` Identity, `epoch` u32, `seq` u64, `created_at`, `empty_since?` |
| `room_member` | private (roster of your rooms via view `my_room_members`) | `id` pk auto, `room_code` btree, `identity` btree, `name`, `color`, `role` (host\|builder\|spectator), `status`, `baton` bool, `done` JSON string[], `joined_at` |
| `room_action` | private (view `my_room_actions`) | `id` pk auto, `room_code` btree, `seq` u64 (per-room, assigned by the reducer: the total order), `from` Identity, `action` JSON, `at` |
| `room_snapshot` | private (view `my_room_snapshots`) | `room_code` pk, `seq`, `state` JSON, `by`, `at` |
| `chat_message` | private (view `my_chat`) | `id` pk auto, `room_code` btree, `from`, `name`, `text`, `lang`, `kind` (text\|voice\|ai\|system), `at` |
| `chat_translation` | private (view `my_chat_translations`) | `id` pk auto, `message_id` btree, `lang`, `text` |
| `cursor_evt` | event | `topic`, `from`, `x`, `y` |
| `pose_evt` | event | `topic`, `from`, `p` JSON [3], `q` JSON [4], `gate?` |
| `progress` | public (own rows via view `my_progress`) | `id` pk auto, `identity` btree, `key`, `at` |
| `lap` | public | `id` pk auto, `identity` btree, `name`, `course` btree, `time_ms` u32, `inputs` JSON (replay log), `verified` bool (passed `lapcheck`; only verified laps reach `leaderboard` and `race_entry`), `at` |
| `leaderboard` | public | `id` pk auto, `course` btree, `identity`, `name`, `best_ms`, `lap_id`, `at` (one row per course and identity, kept by `submit_lap`) |
| `activity_minute` | public | `id` pk auto, `minute` Timestamp, `kind`, `count` u32 |
| `buddy_profile` | public | `identity` pk, `name`, `lang`, `interests` JSON, `built` JSON, `wants`, `updated_at`, `expires_at` |
| `agent_job` | public, visibility filter `owner = :sender` | `id` pk auto, `owner` btree, `room_code?`, `kind` (build\|diagnose\|partner\|plan\|match), `goal`, `context` JSON, `status` (queued\|planning\|running\|reviewing\|done\|failed\|cancelled), `result?` JSON, `error?`, `created_at`, `updated_at` |
| `agent_step` | private (owner via view `my_agent_steps`) | `id` pk auto, `job_id` btree, `idx` u32, `role` (planner\|executor\|critic\|tool\|system), `title`, `tool?`, `input` JSON, `output` JSON, `status` (running\|ok\|error), `model?`, `ms` u32, `at` |
| `agent_proposal` | private (owner via view `my_agent_proposals`) | `id` pk auto, `job_id` btree, `kind`, `payload` JSON, `status` (pending\|accepted\|rejected), `at` |
| `race` | public | `id` pk auto, `onchain` (PDA), `course`, `entry_lamports` u64, `pot_lamports` u64, `closes_at`, `status` (open\|closed\|settled), `settle_sig?` |
| `race_entry` | public | `id` pk auto, `race_id` btree, `identity`, `wallet`, `enter_sig`, `best_ms?`, `lap_id?`, `verified` bool, `result_sig?`, `payout_lamports?` |
| `credential` | public | `id` pk auto, `identity`, `wallet`, `skill`, `pda`, `sig`, `at` |
| `chain_job` | private (own jobs via view `my_chain_jobs`; the worker reads `worker_chain_jobs`) | `id` pk auto, `kind` (issue_credential\|submit_result\|settle_race\|create_race), `payload` JSON, `status` (queued\|sent\|confirmed\|failed), `sig?`, `error?`, `created_at` |
| `rate_bucket`, `search_cache`, `config` | private | limits, cached SerpApi/translation responses, worker identity |

Visibility is part of the contract: see `docs/SECURITY.md`. A client never reads a private table. It reads the
views above (`my_*`, all `public: true` views that return only the caller's rows), and the worker reads
`worker_agent_jobs` and `worker_chain_jobs`, which are empty for anyone but the registered worker.

**Client reducers:**
- Profile and rooms: `set_profile`, `link_wallet` (wallet address + signature of `iynk: link this wallet to identity <hex>`), `create_room`, `join_room`, `leave_room`.
- Room activity: `submit_action`, `post_snapshot`, `send_chat`, `set_presence`, `pass_baton`, `kick`, `send_cursor`,
  `send_pose`.
- Progress and laps: `record_progress`, `submit_lap`.
- Buddies: `upsert_buddy`, `delete_buddy`.
- Agents: `start_agent_job`, `cancel_agent_job`, `resolve_proposal`.
- Races and runs: `enter_race`, `submit_run`. `submit_run` re-verifies a run in the module, then queues a
  `chain_job`.

**Worker-only reducers** (the caller must be the registered worker): `worker_register`, `worker_job_status`,
`worker_step_start`, `worker_step_finish`, `worker_add_proposal`, `worker_chain_result`, `worker_upsert_race`,
`worker_race_entry_result`, `worker_set_translation`.

**Procedures** (`ctx.http.fetch`): `translate_message`, `search_offers`, `search_web`.

**Scheduled reducers:**
- Empty-room cleanup.
- Buddy expiry.
- Race close, which queues `settle_race`.
- The `activity_minute` rollup.

## Rules for contributors

- Next.js here is 16.4. Read `node_modules/next/dist/docs/` before using a Next API.
- `npm run typecheck`, `npx eslint . --quiet` and the tests for the paths you touched must pass before a commit.
- Secrets live only in `.env.local` and module env vars. Never commit them.

## What runs where

SpacetimeDB holds every piece of shared, persistent or trusted state. The rest are thin edges that need a
server-side secret or stream tokens to one browser, and none of them keep state of their own.

| Runs in the SpacetimeDB module | Runs outside it, and why |
|---|---|
| Profiles, wallet links, presence | `/api/ai/chat`: the lab partner streams Nemotron tokens to one browser (SSE) |
| Rooms: membership, action order, snapshots, baton, kicks | `/api/ai/plan`, `/api/ai/story`: one-shot Nemotron calls for one person |
| Chat and its translations (procedure → Nemotron) | `/api/search/{nearby,events,videos}`: SerpApi lookups that are not shared |
| Cursors and flight ghosts (event tables) | `/api/solana/faucet`: holds the devnet issuer key to top up a new wallet |
| Progress, laps, leaderboards, live activity | `/api/solana/credentials`: reads the chain for `/verify` |
| Buddy profiles and expiry | `/api/mcp`, `/api/openapi.json`: the MCP and REST surface for AI assistants |
| Agent jobs, steps, proposals (the worker writes through worker-only reducers) | `/api/status`: which features this deployment has |
| Part prices and web search (procedures, cached) | The worker: runs the Nemotron loop and signs Solana transactions, and reads and writes only through the module |
| Run verification before credentials, race entries, race close and settlement queue | |
| Rate limits, scheduled cleanup and rollups | |
