# Deploying

The database is the SpacetimeDB module on **Maincloud**. Everything else runs on **Vultr**: one VM for the
agent worker and the site, and an optional GPU for our own Nemotron endpoint.

| Piece | Where | How |
|---|---|---|
| SpacetimeDB module (the backend) | Maincloud, database `iynk-hackutd` | `npm run stdb:publish:maincloud` |
| Agent worker (Nemotron loop, Solana signer) | `iynk-core` VM, Docker | `worker/Dockerfile` |
| Next.js app | same VM, standalone server | `deploy/core/Dockerfile.web` |
| TLS and routing | Caddy on 80/443 | `deploy/core/Caddyfile` |
| Nemotron on our GPU (optional) | `iynk-gpu`, 1× L40S, vLLM | `scripts/deploy-vultr-gpu.sh` |
| Self-hosted SpacetimeDB (optional) | same VM, `clockworklabs/spacetime:v2.14.1` | `STDB_TARGET=vultr` |

Browsers and the worker connect to `wss://maincloud.spacetimedb.com`. With `STDB_TARGET=vultr` the VM runs
its own SpacetimeDB instead, and Caddy exposes only the parts a browser needs:
- `/v1/ping`
- `/v1/identity`
- `/v1/database/<db>/subscribe`
- `/v1/database/<db>/call/<fn>`
- `/v1/database/<db>/route/*`

Publishing and SQL stay inside the VM.

## Steps

```bash
# 0. Once per machine: log in to Maincloud
spacetime login

# 1. VM (spends money: about $20/month, or the MLH credit)
scripts/deploy-vultr-create.sh            # prints the IP

# 2. Server settings in .env.local (never committed):
#    WORKER_SECRET (openssl rand -hex 32), NVIDIA_API_KEY, SERPAPI_KEY, SOLANA_ISSUER_KEYPAIR,
#    SOLANA_RPC_URL, NEXT_PUBLIC_SOLANA_PROGRAM_ID, optional DOMAIN (default <ip>.sslip.io)

# 3. Deploy or redeploy: publishes the module to Maincloud, copies the repo, compose up
VULTR_HOST=<ip> scripts/deploy-vultr.sh
#    or keep the database on the VM too:
STDB_TARGET=vultr VULTR_HOST=<ip> scripts/deploy-vultr.sh

# Module only (e.g. after a reducer change); --clear wipes data after a breaking schema change
npm run stdb:publish:maincloud

# 4. Optional: our own Nemotron on a GPU (about $1.67/hour; destroy it after the demo)
scripts/deploy-vultr-gpu.sh up && scripts/deploy-vultr-gpu.sh status
#    then add NEMOTRON_BASE_URL=http://<gpu-ip>:8000/v1 to .env.local and redeploy
scripts/deploy-vultr-gpu.sh down
```
