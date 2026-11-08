#!/usr/bin/env bash
# Starts (or destroys) a Vultr Cloud GPU that serves a Nemotron model with vLLM's OpenAI-compatible API,
# so the agents' executor runs on our own GPU instead of the shared hosted endpoint.
#
#   scripts/deploy-vultr-gpu.sh up       create the L40S instance (SPENDS MONEY: about $1.67/hour)
#   scripts/deploy-vultr-gpu.sh status   print its IP and whether vLLM answers
#   scripts/deploy-vultr-gpu.sh down     destroy it (stopped instances still bill, so destroy, don't stop)
#
#   VULTR_API_KEY       environment or .env.local; never printed
#   VLLM_API_KEY        the key clients must send (environment or .env.local; generate one with openssl rand -hex 24)
#   NEMOTRON_HF_MODEL   default nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8 (fits one 48 GB L40S in FP8)
#   VULTR_GPU_PLAN      default: the cheapest plan whose GPU is an L40S
#   VULTR_REGION        default dfw
#
# Then set NEMOTRON_BASE_URL=http://<ip>:8000/v1 and NEMOTRON_FAST_MODEL=<model> for the worker; it falls
# back to the hosted NVIDIA API when this endpoint fails.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
API="https://api.vultr.com/v2"
LABEL="iynk-gpu"
REGION="${VULTR_REGION:-dfw}"
OS_NAME="Ubuntu 24.04 LTS x64"

die() {
  echo "deploy-vultr-gpu: $*" >&2
  exit 1
}

env_local() {
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

command -v jq >/dev/null || die "needs jq."
KEY="${VULTR_API_KEY:-$(env_local VULTR_API_KEY)}"
[[ -n "$KEY" ]] || die "VULTR_API_KEY is not set (environment or .env.local)."
HEADERS="$(mktemp)"
trap 'rm -f "$HEADERS"' EXIT
chmod 600 "$HEADERS"
printf 'Authorization: Bearer %s\n' "$KEY" >"$HEADERS"
unset KEY

api() {
  local args=(-sS --max-time 30 -X "$1" -H @"$HEADERS" -H "Content-Type: application/json" -w $'\n%{http_code}')
  [[ $# -lt 3 ]] || args+=(--data "$3")
  local out status
  out="$(curl "${args[@]}" "$API$2")" || die "$1 $2: could not reach the Vultr API."
  status="${out##*$'\n'}"
  out="${out%$'\n'*}"
  [[ "$status" == 2* ]] || die "$1 $2 failed with HTTP $status: $out"
  printf '%s' "$out"
}

instance() {
  api GET "/instances?label=$LABEL&per_page=500" | jq -c --arg label "$LABEL" '[.instances[] | select(.label == $label)][0] // empty'
}

case "${1:-}" in
  up)
    [[ -z "$(instance)" ]] || die "an instance labelled $LABEL already exists; run status or down."
    VLLM_API_KEY="${VLLM_API_KEY:-$(env_local VLLM_API_KEY)}"
    [[ -n "$VLLM_API_KEY" ]] || die "set VLLM_API_KEY so the endpoint isn't open to the internet."
    MODEL="${NEMOTRON_HF_MODEL:-nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8}"
    PLAN="${VULTR_GPU_PLAN:-$(api GET "/plans?type=vcg&per_page=500" |
      jq -r '[.plans[] | select((.gpu_type // "") | test("L40S"; "i"))] | sort_by(.monthly_cost) | .[0].id // empty')}"
    [[ -n "$PLAN" ]] || die "no L40S plan found; set VULTR_GPU_PLAN (see GET /v2/plans?type=vcg)."
    OS_ID="$(api GET "/os?per_page=500" | jq -r --arg name "$OS_NAME" '[.os[] | select(.name == $name)][0].id // empty')"
    USER_DATA="$(cat <<CLOUD | base64 | tr -d '\n'
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -y -q docker.io curl gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list |
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' >/etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update -q && apt-get install -y -q nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
docker run -d --restart unless-stopped --gpus all --ipc=host -p 8000:8000 \
  -v /root/hf:/root/.cache/huggingface vllm/vllm-openai:latest \
  --model $MODEL --served-model-name $MODEL --api-key $VLLM_API_KEY \
  --max-model-len 65536 --enable-auto-tool-choice --tool-call-parser qwen3_coder --trust-remote-code
CLOUD
)"
    BODY="$(jq -nc --arg region "$REGION" --arg plan "$PLAN" --argjson os "$OS_ID" --arg label "$LABEL" --arg ud "$USER_DATA" \
      '{region: $region, plan: $plan, os_id: $os, label: $label, hostname: $label, user_data: $ud, tags: ["iynk"]}')"
    ID="$(api POST "/instances" "$BODY" | jq -r '.instance.id')"
    echo "Created $ID on $PLAN in $REGION. The model download takes a few minutes; check with: $0 status"
    ;;
  status)
    inst="$(instance)"
    [[ -n "$inst" ]] || die "no instance labelled $LABEL."
    ip="$(jq -r .main_ip <<<"$inst")"
    jq -r '"  id \(.id)\n  ip \(.main_ip)\n  plan \(.plan), status \(.status)/\(.server_status)"' <<<"$inst"
    if curl -fsS --max-time 5 "http://$ip:8000/health" >/dev/null 2>&1; then
      echo "  vLLM is up: NEMOTRON_BASE_URL=http://$ip:8000/v1"
    else
      echo "  vLLM is not answering yet."
    fi
    ;;
  down)
    inst="$(instance)"
    [[ -n "$inst" ]] || { echo "Nothing to destroy."; exit 0; }
    api DELETE "/instances/$(jq -r .id <<<"$inst")" >/dev/null
    echo "Destroyed $LABEL."
    ;;
  *)
    die "usage: $0 up|status|down"
    ;;
esac
