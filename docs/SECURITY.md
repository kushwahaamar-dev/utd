# Security

iynk runs on SpacetimeDB Maincloud, where anyone can connect under their own identity, subscribe to any public table,
run `spacetime sql` against it and call any reducer or procedure with any arguments. So the module treats every client as
hostile: **the module is the only trusted code, and everything it accepts is checked there.** The web app, the worker
and the CLI are all just clients.

## Threat model

| Asset | Threat | Control | Where |
|---|---|---|---|
| What people say in a room (chat, actions, snapshots) | A stranger subscribes to every room, or guesses a code | The tables are private. Members read them through semijoin views on their own seat. Codes are 8 characters (31^8), hashed with a server secret so `ctx.random`'s timestamp seed cannot predict them. Join is rate limited per identity and globally | `spacetime/src/schema.ts`, `views.ts`, `rooms.ts` (`newCode`) |
| Who is in which room | Reading `room_member` leaks the room codes | Private. The roster of your own rooms comes from `my_room_members` | `views.ts` |
| Cursor and pose events | Reading another room's positions | Public event tables, keyed by an opaque `topic` that says nothing about the join code. Positions only, no content | `schema.ts` (`cursor_evt`, `pose_evt`), `rooms.ts` |
| Agent goals, context, tool output | Reading someone else's job | `agent_job` has a visibility filter `owner = :sender`. Steps and proposals are private with owner-only views | `visibility.ts`, `views.ts` |
| Chain job payloads (identity, wallet, score) | Anyone reads the queue | `chain_job` is private. A user reads their own through `my_chain_jobs`; the worker through `worker_chain_jobs` | `views.ts`, `chain.ts` |
| Wallet to identity link | Reading `player.wallet`; claiming someone else's address to take their race result | Wallets live in the private `player_wallet`. `link_wallet` needs the wallet's ed25519 signature over `iynk: link this wallet to identity <hex>`, so it cannot be claimed or replayed for another identity | `profile.ts`, `src/lib/stdb/link-message.ts` |
| Leaderboards and race results | A client reports a 1 ms lap | `submit_lap` runs `checkLap`; only verified laps reach `leaderboard` or `race_entry` (see "Laps and credentials") | `lapcheck.ts`, `progress.ts` |
| Credentials | A fake bench run earns a credential | `submit_run` re-runs the run log in the module and rejects anything that does not replay clean; the payload carries the replay hash | `verify.ts`, `chain.ts` |
| Worker-only reducers | A client writes job results, chain results or races | Every `worker_*` reducer checks `ctx.sender` against the registered worker row | `util.ts` (`requireWorker`), `agents.ts`, `chain.ts` |
| Scheduled reducers (`sweep`, `close_race`) | A client calls them directly | Not callable from clients, and each also refuses any sender but the database itself | `util.ts` (`requireScheduler`) |
| Reducer abuse | Floods, huge payloads, unbounded rows | Token buckets per identity and per action, plus global buckets, size caps, per-room and per-identity row caps, sweeps | `util.ts` (`limit`, `limitGlobal`), each reducer |
| The NVIDIA and SerpApi quota | One user drains it | Per identity and global buckets, a 6 hour search cache, response size caps; the API keys live in module env and never appear in errors | `procedures.ts` |
| Translation | A chat message tells the model to do something | The message is wrapped in `<message>` tags and the system prompt says it is data, not instructions | `procedures.ts` |
| Agent worker | A goal tells the model to leak or misuse tools | Goal and context are wrapped in tags and declared untrusted in every prompt; tools only read the catalogue and run the in-process simulators (no filesystem, no network of their own); `sim_run` has a 3 s budget; proposals stay `pending` until the owner accepts; step output is scrubbed of keys before it is stored | `worker/src/agent/prompts.ts`, `tools/`, `sinks/redact.ts` |
| The Solana issuer key | A payload makes the worker sign something harmful | Payloads are zod-checked, stakes and seeds are capped at 1 SOL, the close date at 30 days, the program id is fixed by config, and the worker refuses an RPC URL that is not devnet or local | `worker/src/chain/payloads.ts`, `config.ts` |
| Next API routes | Scraping, quota drain, cross-site calls | Origin check, per-IP limits, instance-wide hourly budgets, JSON-only bodies with size caps, errors that carry a code and a fixed hint | `src/lib/server/http.ts`, `ratelimit.ts`, `ai/guard.ts`, `search/route.ts` |
| MCP `create_room` | Fills the database with rooms | 5 per caller per 10 minutes, 120 per hour overall, 400 rooms in total in the module | `src/lib/server/mcp/tools/together.ts`, `rooms.ts` |
| The browser | XSS, clickjacking, mixed content | CSP (own scripts, no remote script hosts, `wss` only to Maincloud, the configured SpacetimeDB and the Solana RPC), HSTS, `nosniff`, `frame-ancestors 'self'`, Referrer-Policy, Permissions-Policy | `next.config.ts` |
| Secrets | Keys in git or logs | `.env*`, keypairs and `spacetime/.data` are ignored; history was scanned and is clean; module secrets are set at publish time and never read back by clients | `.gitignore`, `scripts/publish-maincloud.sh` |

## What is public, and why

| Public | Why |
|---|---|
| `player` (name, colour, language, online) | Shown beside chat and leaderboards. No wallet |
| `leaderboard`, `lap` (with the input log) | Boards are public, and anyone can replay a lap. Inputs are capped at 64 KiB and 40 laps per identity are kept |
| `race`, `race_entry`, `credential` | These mirror a public chain; the wallet is on-chain anyway |
| `buddy_profile` | The user opted in. It holds only what they typed, expires in 24 hours, and can be deleted |
| `activity_minute` | Anonymous counters |
| `cursor_evt`, `pose_evt` | Event tables, cleared right after delivery. Opaque topic, positions only |
| Views `my_*`, `worker_*` | Public in the schema sense (clients may subscribe to them) but each returns only the caller's rows |

Everything else is private: `room`, `room_member`, `room_action`, `room_snapshot`, `chat_message`, `chat_translation`,
`agent_step`, `agent_proposal`, `chain_job`, `chain_job_owner`, `player_wallet`, `progress`, `rate_bucket`,
`search_cache`, `config`, `connection`, `room_ban` and the timer tables. Try it: `spacetime sql iynk-hackutd "select * from chat_message"`
answers `no such table ... may be marked private`.

## Worker authentication

The worker is an ordinary client with one extra power. It connects, calls `worker_register(secret)`, and the module
compares the secret with `WORKER_SECRET` (a module env var set at publish time, never in the repo) in constant time. On
success the caller's identity is stored in the private `config` row `worker`; every `worker_*` reducer and the
`worker_*` views check against that row.

- **Fails closed.** If `WORKER_SECRET` is unset or shorter than 16 characters, registration fails for everyone. Nobody can
  register first on an unconfigured database. The deploy script refuses a secret under 32 characters.
- **Re-registration.** A correct secret re-binds the worker to the new caller and the old identity loses its rights
  immediately. That is how a restarted worker (which gets a new identity unless it keeps its token) takes over.
- **A second worker** is not a thing: there is one worker row. Anyone holding the secret can replace the worker, so the
  secret is the whole credential. Rotate it with `spacetime publish ... --env-only`.
- **Rate limits** on `worker_register`: 5 per identity, 10 per 20 s overall.
- The worker exits when its socket closes, so a restart policy brings it back and it registers again.

## Laps and credentials

**Credentials (`submit_run`)** are fully verified: the module imports the same pure verifier the client uses
(`src/lib/verify`), replays the recorded bench run, recomputes the score and the replay hash, refuses anything that does
not pass, then queues the issue. The client's own verdict is never read. The caller must hold a wallet that signed the
identity link, and one credential per skill per identity is allowed.

**Laps (`submit_lap`)** are checked, not replayed. The module cannot re-fly a lap because the craft design that flew it
comes from the client. `checkLap` therefore checks that the claim is consistent and physically possible:

- the craft and course exist, and the board name matches (`<craft>-<course>` or a daily board for yesterday, today or tomorrow);
- the time is not under the course's floor, the longer of the straight-line path through every gate at 45 m/s and half the
  gold par (`src/lib/verify/lap-floors.json`, regenerated and checked by a test against the content);
- the log header's time and step count agree with the claim, steps are ordered, every action is a known type, and the
  craft was armed.

A lap that fails is stored with `verified = false` and **never** reaches `leaderboard` or a race entry. A client can still
lie plausibly (a fast but possible time with a made-up log). See "Known limits".

## Rate limits

Token buckets in `rate_bucket` (capacity, refill per second), per identity unless noted:

| Action | Limit |
|---|---|
| `create_room` | 5, 0.1/s; 30, 2/s overall; 400 rooms total |
| `join_room` | 10, 0.5/s; 100, 30/s overall |
| `send_chat` | 10, 2/s |
| `submit_action` | 60, 40/s |
| `post_snapshot` (host only) | 4, 1/s |
| `send_cursor`, `send_pose` | 3, 20/s (extra frames dropped) |
| `submit_lap` | 10, 0.2/s; 60, 10/s overall |
| `submit_run` | 5, 0.1/s; 20, 1/s overall; at most 200 queued chain jobs |
| `enter_race` | 5, 0.1/s; 500 entries per race |
| `start_agent_job` | 5, 0.05/s; 3 live per identity, 40 live overall, 100 kept per identity |
| `link_wallet` | 5, 0.1/s |
| `translate_message` | 10, 0.5/s; 120, 1/s overall |
| `search_*` | 6, 0.2/s; 60, 0.1/s overall; results cached 6 hours |
| New identities connecting | 120, 3/s overall |
| Next API | `/api/ai/*` 3 to 20 per minute per IP and 900 calls an hour overall; `/api/search/*` 30 per minute; faucet 5 per minute |

Limits are also enforced by size: chat 500 characters, action 64 KiB, snapshot 512 KiB, goal 2000 characters, job
context 32 KiB, run log 256 KiB, laps 64 KiB. Old jobs, chain jobs and idle anonymous players are swept.

## Known limits

- **Laps are not replayed.** A cheater can submit a plausible but invented time with a plausible log. The floors stop
  impossible laps, not clever ones. A full replay needs the client-chosen craft design to be re-derived from the build,
  which the module does not do yet. Prize races are settled on-chain from the module's verified laps only.
- **`enter_race` does not read the chain.** It records the transaction signature the client sends. The on-chain program
  is the authority for who entered and who is paid; a fake entry can show in the table but cannot be paid.
- **Failed calls are not rate limited.** A reducer that throws rolls back its transaction, including the bucket write,
  so a stream of invalid calls costs only the call. Maincloud's own connection limits apply on top.
- **Free identities.** Anyone can make as many identities as they like. Per-identity buckets do not stop that, so the
  global buckets and row caps above carry the load.
- **Cursor and pose events are public** (positions with an identity, no content, no room code).
- **Chat text goes to NVIDIA** when a member asks for a translation. Do not put secrets in chat.
- **CSP keeps `'unsafe-inline'` for scripts** because Next injects inline hydration scripts; no remote script origin is allowed.
- **CSP allows `'unsafe-eval'`** because the SpacetimeDB client SDK builds its row decoders with `new Function()`.
  The generated code comes from the module's schema, never from user input, and no remote script origin is allowed.
- **Next API limits are in memory,** per instance, and use the proxy's client IP header. Behind Caddy that header is
  overwritten, directly exposed it is only a hint.
- **Dependencies:** `npm audit --omit=dev` reports 15 findings (2 high, 13 moderate), all inside the Solana tooling
  (`@coral-xyz/anchor` via `toml`, `@solana/web3.js` and the wallet adapters, `uuid`) with no upstream fix. None parse
  untrusted input in this app.

## Reporting a vulnerability

Open a private security advisory on the repository
(`github.com/kushwahaamar-dev/utd` > Security > Report a vulnerability). Please do not file public issues for
vulnerabilities, and do not test against other people's data; two of your own identities are enough to reproduce
everything above. We aim to answer within two days.

## Tests

- Module authorization and validation: `npm run stdb:test` (`spacetime/src/module.test.ts`).
- Live negative tests with several real identities (an outsider reading a room, a stranger on the worker feed, a forged
  wallet link, a faked lap, worker-only reducers): `STDB_LIVE=1 npm run stdb:test` against a local database.
- Headers: `src/lib/server/security-headers.test.ts`. Chain limits: `worker/src/chain/chain.test.ts`. Key scrubbing: `worker/src/sinks/redact.test.ts`.
