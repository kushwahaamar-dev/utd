# iynk agent worker

Node 24 service that runs Mission Control: Nemotron agents that plan, call tools backed by iynk's real
simulators, get checked by a critic, and write every step into SpacetimeDB so the UI can stream it. It also
works the `chain_job` queue by calling the Solana signer in `src/chain/`.

```
agent_job (queued) ──► planner ──► executor ⇄ tools ──► critic ──► result
   SpacetimeDB          super 120B   lightning 30B       super 120B   (revise up to 3 times)
```

- **Planner** (planner model, thinking on) turns the goal and context into `{steps, success_criteria, budget?, target_item?}`.
- **Executor** (fast model, thinking off) works each step with tool calls, one per turn, up to 6 rounds.
- **Critic** (planner model) checks the tool evidence against the criteria: `approve` or `revise` with concrete fixes.
  A revision runs the executor again with those fixes, then the critic looks again.
- The final result is `{summary, design, verification, bom, total_usd, within_budget, load_into_lab}`.
- Job kinds: `build`, `diagnose` (the showcases), `plan` (Build Night roles), `match` (buddies), `partner`.

## Tools

Each wraps code from `../src`, so results are the same ones the lab shows.

| Tool | Runs |
|---|---|
| `catalog_search`, `catalog_get` | the content index (MCP catalog tools) |
| `drone_calc` | `src/lib/drone/calc.ts` through the MCP tool: thrust-to-weight, hover throttle, flight minutes, design checks |
| `drone_optimize` | `src/lib/search/optimize.ts` over all battery/motor/prop combinations, priced from the catalogue or live |
| `parts_price` | SerpApi shopping search (`not_configured` without `SERPAPI_KEY`) |
| `sim_run` | `src/lib/interp`: Arduino C++ / MicroPython on a board profile; lesson or task checks when given |
| `bench_check` | the robotics fault model: supply current against limits, active faults, known faults ranked against a symptom |
| `datasheet_search` | SerpApi web search plus page extracts |
| `propose_change`, `ask_peer`, `highlight_part` | write an `agent_proposal` the user accepts or rejects |

Tool results are clipped before they go back to the model, and bad arguments come back as an `invalid_args`
message so the model fixes its call.

## Run it

```bash
npm --prefix worker install

# No key needed: a scripted model plays planner, executor and critic against the real tools.
NEMOTRON_FAKE=1 npm --prefix worker run job -- --kind build "5-inch drone, 8 minutes flight, under \$500"
NEMOTRON_FAKE=1 npm --prefix worker run job -- --kind diagnose \
  --context '{"itemId":"led-resistor","faults":["led-backwards"],"symptom":"LED stays dark"}' "My LED trainer is dark"

# Real Nemotron (NVIDIA_API_KEY in the environment or in ../.env.local)
npm --prefix worker run job -- --kind build "5-inch drone, 8 minutes flight, under \$500"

# Against a local SpacetimeDB (npm run stdb:start && npm run stdb:publish at the repo root)
STDB_WORKER_SECRET=dev-worker-secret NEMOTRON_FAKE=1 npm --prefix worker start
```

`job` accepts `--context '<json>'` or `--context-file`, and `--json` for the whole trace. The worker is bundled
with esbuild (`build.mjs`) because the app's engines use the `@/` alias and `server-only`.

## Environment

| Variable | Meaning |
|---|---|
| `NVIDIA_API_KEY` | hosted Nemotron (`https://integrate.api.nvidia.com/v1`) |
| `NEMOTRON_BASE_URL` | self-hosted vLLM (`--enable-auto-tool-choice --tool-call-parser qwen3_coder`); tried first, the hosted API is the fallback |
| `NEMOTRON_FAST_MODEL`, `NEMOTRON_PLANNER_MODEL`, `NEMOTRON_VISION_MODEL` | model ids |
| `NEMOTRON_RPM` | hosted calls per minute shared by all jobs (default 30; the free tier allows about 40) |
| `NEMOTRON_FAKE=1` | use the scripted model; `NEMOTRON_FAKE_DELAY_MS` slows it down for a demo |
| `SERPAPI_KEY` | live prices and datasheet search |
| `STDB_WORKER_SECRET` (or `WORKER_SECRET`) | the secret the module was published with; registers the worker |
| `STDB_URI`, `STDB_DB` (or `STDB_DATABASE`) | default `ws://127.0.0.1:3100` and `iynk` |
| `JOB_CONCURRENCY` | jobs at once (default 2) |
| `SOLANA_ISSUER_KEYPAIR`, `SOLANA_PROGRAM_ID` | turn on the chain queue; without both, `chain_job` rows stay queued |

The worker reads `../.env.local` and `.env.local` first; variables already set win.

## SpacetimeDB

`src/stdb.ts` connects with the generated bindings, calls `worker_register`, subscribes to `agent_job` and
`chain_job`, claims queued jobs with `worker_job_status`, streams steps with `worker_step_start` and
`worker_step_finish`, adds proposals with `worker_add_proposal`, and reports chain work with `worker_chain_result`.
A job cancelled in the UI stops between model calls. Jobs left running by a previous worker are marked failed on
start. `src/stdb.e2e.test.ts` runs the whole path against a live server (`STDB_E2E=1`, see the file header).

## Tests

```bash
npm --prefix worker test        # loop, critic revise path, every tool, the Nemotron request shapes
npm --prefix worker run typecheck
```

## Docker

```bash
docker build -f worker/Dockerfile -t iynk-worker .   # from the repo root
docker run --env-file .env iynk-worker
```
