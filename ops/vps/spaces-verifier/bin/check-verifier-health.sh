#!/usr/bin/env bash
set -euo pipefail

readonly HEALTH_URL="${SPACES_VERIFIER_HEALTH_URL:-http://127.0.0.1:4047/health}"
readonly INSPECT_URL="${SPACES_VERIFIER_INSPECT_URL:-http://127.0.0.1:4047/inspect?root_label=@pirate}"
readonly AUTH_TOKEN="${SPACES_VERIFIER_AUTH_TOKEN:?SPACES_VERIFIER_AUTH_TOKEN is required}"
body="$(curl --fail --silent --show-error --max-time 15 "$HEALTH_URL")"

if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<< "$body"; then
  echo "Spaces verifier health is degraded" >&2
  exit 1
fi

if ! grep -Eq '"fabric_record_reader_ready"[[:space:]]*:[[:space:]]*true' <<< "$body"; then
  echo "Spaces verifier Fabric record reader is not ready" >&2
  exit 1
fi
if ! grep -Eq '"fallback_target_disagreements"[[:space:]]*:[[:space:]]*0([,}])' <<< "$body"; then
  echo "Spaces verifier reports a native/fallback target disagreement" >&2
  exit 1
fi
if ! grep -Eq '"fabric_relay_disagreements"[[:space:]]*:[[:space:]]*0([,}])' <<< "$body"; then
  echo "Spaces verifier reports a verified Fabric relay disagreement" >&2
  exit 1
fi
if ! grep -Eq '"chain_state_ready"[[:space:]]*:[[:space:]]*true' <<< "$body"; then
  echo "Spaces verifier chain or anchor state is stale" >&2
  exit 1
fi

inspection="$(curl --fail --silent --show-error --max-time 30 \
  --header "Authorization: Bearer $AUTH_TOKEN" \
  "$INSPECT_URL")"

if ! grep -Eq '"root_key_proof_verified"[[:space:]]*:[[:space:]]*true' <<< "$inspection"; then
  echo "Spaces verifier authenticated inspection did not verify the root proof" >&2
  exit 1
fi
if ! grep -Eq '"root_pubkey"[[:space:]]*:[[:space:]]*"[0-9a-fA-F]{64}"' <<< "$inspection"; then
  echo "Spaces verifier authenticated inspection returned no root key" >&2
  exit 1
fi
if ! grep -Eq '"accepted_anchor_height"[[:space:]]*:[[:space:]]*[0-9]+' <<< "$inspection"; then
  echo "Spaces verifier authenticated inspection returned no accepted anchor" >&2
  exit 1
fi

echo "Spaces verifier Fabric, chain state, and authenticated inspection are ready"
