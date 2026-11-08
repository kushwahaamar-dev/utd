# iynk SpacetimeDB module

TypeScript module (SpacetimeDB 2.14) holding everything shared or trusted: rooms, laps, buddies, agent jobs, races,
credentials. Schema and ownership are in `docs/ARCHITECTURE.md`; the client is `src/lib/stdb/` (see its `READY.md`).

```
src/schema.ts      tables (contract tables plus a few private helpers) and the env declaration
src/rooms.ts       create/join/leave, ordered actions, baton, snapshots, chat, presence, kick, cursor/pose events
src/progress.ts    record_progress, track_activity, submit_lap, buddies
src/agents.ts      start/cancel/resolve for users, worker_* reducers for the agent worker
src/chain.ts       submit_run (replay + credential job), races, worker_chain_result, worker_upsert_race
src/procedures.ts  translate_message (Nemotron), search_offers / search_web (SerpApi) via ctx.http.fetch
src/schedules.ts   repeating sweeps: empty rooms (30 min), expired buddies, old activity/buckets/cache
src/verify.ts      run verification; imports the pure code from ../../src/lib/verify
```

## Commands (from the repo root)

| | |
|---|---|
| `npm run stdb:start` | local server on 127.0.0.1:3100, data in `spacetime/.data` |
| `npm run stdb:publish` | build and publish as `iynk` (add `stdb:reset` to wipe data) |
| `npm run stdb:generate` | rewrite `src/lib/stdb/bindings` after changing the module |
| `npm run stdb:test` | module unit tests (in-memory datastore); `STDB_LIVE=1 npm run stdb:test` also runs `live.test.ts` against the published local server with real WebSocket clients |
| `npm run stdb:publish:maincloud` | publish to Maincloud as `iynk-hackutd` (needs `spacetime login`) |

## Module env vars

Declared in `src/schema.ts` and read with `ctx.env`. All optional; a feature whose key is missing answers
`not configured: ...` instead of failing.

| Var | Used by |
|---|---|
| `WORKER_SECRET` | `worker_register` |
| `NVIDIA_API_KEY` | `translate_message` (base `https://integrate.api.nvidia.com/v1`) |
| `NEMOTRON_FAST_MODEL` | translation model, default `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `SERPAPI_KEY` | `search_offers`, `search_web` |

Values are not in the repo or in `.env`; they are supplied when publishing and stay on the database across later publishes:

```bash
WORKER_SECRET=... NVIDIA_API_KEY=... SERPAPI_KEY=... npm run stdb:publish            # local
WORKER_SECRET=... NVIDIA_API_KEY=... SERPAPI_KEY=... npm run stdb:publish:maincloud  # Maincloud
spacetime publish iynk-hackutd --server maincloud -p spacetime --env-only            # change keys only, no new module
spacetime env list iynk-hackutd --server maincloud                                   # inspect (prints secrets)
```

A shell variable wins over `env` in `spacetime/spacetime.local.json` (put secrets there instead if you prefer a file; do not commit it).
Self-hosted (Vultr): run `spacetime start --listen-addr 127.0.0.1:3100 --data-dir /var/lib/spacetime` behind Caddy for TLS,
then `spacetime publish iynk --server https://<host> -p spacetime` with the same shell variables, and point
`NEXT_PUBLIC_STDB_URI` at `wss://<host>`.

## Worker auth

The worker (a Node process, `worker/`) connects with the SDK like any client. Its first call is
`worker_register(secret)`; the module compares the secret with `WORKER_SECRET` in constant time and stores the
caller's identity in private `config` (key `worker`). Every `worker_*` reducer then checks `ctx.sender` against that row
and fails with `worker only` for anyone else. Registering again with the secret replaces the stored identity (a worker restart
that comes back with a new token just calls it again; the old identity loses its rights at once). The secret must be at least 16 characters; publish with 32+ random ones. If `WORKER_SECRET` is unset on the database, registration fails
with a message saying so. The worker should keep its token (persist it) so its identity is stable.

Worker reducers: `worker_register`, `worker_job_status`, `worker_step_start`, `worker_step_finish`, `worker_add_proposal`,
`worker_chain_result`, `worker_upsert_race`, `worker_race_entry_result`, `worker_set_translation`, and
`worker_queue_chain_job(kind, payload)` (extra: lets the worker enqueue `create_race` and friends).

How the worker drives the chain queue:

1. Subscribe to `chain_job` and `agent_job` (`status = 'queued'`), and to `race`.
2. For a chain job: sign and send, then `worker_chain_result(jobId, 'confirmed'|'failed', sig, error, pda)`. Confirmed
   `issue_credential` jobs create the `credential` row (pass the credential PDA); confirmed `settle_race` marks the race settled
   and stores `settle_sig`; confirmed `submit_result` stores `result_sig` on the entry.
3. After creating a race on-chain call `worker_upsert_race(onchain, course, entryLamports, potLamports, closesAt, 'open')`.
   That schedules the close: at `closes_at` the module sets the race `closed`, queues one `submit_result` job per ranked
   entry and then a `settle_race` job whose payload carries the ranking. Mirror later changes with the same reducer.
4. `worker_race_entry_result(entryId, verified, bestMs?, lapId?, resultSig?, payoutLamports?)` after confirming an entry's
   `enter_sig` on-chain (`verified: true`) or paying out. `submit_lap` already fills `best_ms` and `lap_id` for entries in open races.

`chain_job.payload` for `issue_credential`: `{ identity, wallet, skillId, kind, itemId, sub, score, replayHash }`.

## Notes and decisions

- Reducers in the module import `../../src/lib/verify` and `../../src/lib/realtime/shared-actions` directly; the module
  bundler follows relative imports (the `@/` alias is not available, `import type` is erased). So the replay logic and the
  free/gated action lists have one source of truth. `server-only` modules cannot be bundled, so the SerpApi mappers are
  copied into `src/search-normalize.ts`. `sha256` comes from `@noble/hashes` (no WebCrypto in the module runtime).
- `progress` is private; clients read their own rows through the public view `my_progress`.
- Laps are stored with `verified = false`: there is no flight-course replay yet, only the bounds in `src/lib/telemetry/kinds.ts`.
- Added to the contract (additive): `room_member.lab_role`, `pose_evt.v`, `chat_translation.room_code`, reducer
  `track_activity` (live counters), `worker_queue_chain_job`, and private `connection`, `room_ban`, `chain_job_owner`,
  `sweep_timer`, `race_close_timer`.
- Reducers that throw `SenderError` roll back and reach the caller as a rejected promise with the message.
- Handy SQL: `spacetime sql --server http://127.0.0.1:3100 iynk "SELECT code, lab, seq FROM room"`.
