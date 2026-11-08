# Deploying to Vultr

Everything runs on Vultr: one VM for the backend and site, and an optional GPU for our own Nemotron endpoint.

| Piece | Where | How |
|---|---|---|
| SpacetimeDB (the backend) | `iynk-core` VM, Docker (`clockworklabs/spacetime:v2.14.1`) | `deploy/core/compose.yaml` |
| Agent worker (Nemotron loop, Solana signer) | same VM | `worker/Dockerfile` |
| Next.js app | same VM, standalone server | `deploy/core/Dockerfile.web` |
| TLS and routing | Caddy on 80/443 | `deploy/core/Caddyfile` |
| Nemotron on our GPU (optional) | `iynk-gpu`, 1× L40S, vLLM | `scripts/deploy-vultr-gpu.sh` |
| Backup database | SpacetimeDB Maincloud | `npm run stdb:publish:maincloud` |

Caddy exposes only the parts of SpacetimeDB a browser needs:
- `/v1/ping`
- `/v1/identity`
- `/v1/database/<db>/subscribe`
- `/v1/database/<db>/call/<fn>`
- `/v1/database/<db>/route/*`

Publishing and SQL stay inside the VM.

## Steps

```bash
# 1. VM (spends money: about $20/month, or the MLH credit)
scripts/deploy-vultr-create.sh            # prints the IP

# 2. Server settings in .env.local (never committed):
#    NVIDIA_API_KEY, SERPAPI_KEY, WORKER_SECRET, SOLANA_ISSUER_KEYPAIR, SOLANA_RPC_URL,
#    NEXT_PUBLIC_SOLANA_PROGRAM_ID, optional DOMAIN (default <ip>.sslip.io)

# 3. Deploy or redeploy (builds the module, copies the repo, compose up, publishes the module)
VULTR_HOST=<ip> scripts/deploy-vultr.sh

# 4. Optional: our own Nemotron on a GPU (about $1.67/hour; destroy it after the demo)
scripts/deploy-vultr-gpu.sh up && scripts/deploy-vultr-gpu.sh status
#    then add NEMOTRON_BASE_URL=http://<gpu-ip>:8000/v1 to .env.local and redeploy
scripts/deploy-vultr-gpu.sh down
```
