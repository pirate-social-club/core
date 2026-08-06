#!/usr/bin/env bash
set -euo pipefail

role_dir="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat > "$work/spaced" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${SPACED_TEST_ARGS:?}"
EOF
chmod +x "$work/spaced"

export SPACED_TEST_ARGS="$work/args"
SPACED_BIN="$work/spaced" \
SPACED_DATA_DIR="$work/data" \
BITCOIN_RPC_URL="https://bitcoin.example/rpc" \
BITCOIN_RPC_USER="rpc-user" \
BITCOIN_RPC_PASS="rpc-pass" \
SPACED_RPC_USER="spaces-user" \
SPACED_RPC_PASS="spaces-pass" \
  bash "$role_dir/bin/start-spaced.sh"

grep -Fxq -- '--rpc-bind' "$work/args"
grep -Fxq -- '127.0.0.1' "$work/args"
grep -Fxq -- '--rpc-port' "$work/args"
grep -Fxq -- '7225' "$work/args"
grep -Fxq -- '--bitcoin-rpc-url' "$work/args"
grep -Fxq -- 'https://bitcoin.example/rpc' "$work/args"
grep -Fxq -- '--bitcoin-rpc-user' "$work/args"
grep -Fxq -- '--rpc-user' "$work/args"

if SPACED_BIN="$work/spaced" SPACED_DATA_DIR="$work/data" \
  SPACED_RPC_USER=user SPACED_RPC_PASS=pass \
  bash "$role_dir/bin/start-spaced.sh" >/dev/null 2>&1; then
  echo "start-spaced accepted missing Bitcoin RPC URL" >&2
  exit 1
fi

bash -n "$role_dir/bin/build-spaced.sh"
grep -Fq '9eb78628318ac1892a82c6275108e7de0cdc7403' "$role_dir/bin/build-spaced.sh"
grep -Fq "grep -Fq 'spaces_client 0.0.9'" "$role_dir/bin/build-spaced.sh"
grep -Fq 'User=pirate-spaces' "$role_dir/systemd/pirate-spaced.service"
grep -Fq 'ReadWritePaths=/srv/pirate-spaces/data/spaced' "$role_dir/systemd/pirate-spaced.service"
grep -Fq 'After=network-online.target pirate-spaced.service' "$role_dir/systemd/pirate-spaces-verifier.service"
grep -Fq 'cargo build --locked --release' "$role_dir/bin/stage-release-assets.sh"
grep -Fq 'spaces-verifier-native' "$role_dir/bin/stage-release-assets.sh"
grep -Fq 'SPACES_VERIFIER_NATIVE_BIN=/srv/pirate-spaces/current/bin/spaces-verifier-native' \
  "$role_dir/env/verifier.env.example"
grep -Fq 'SPACES_FABRIC_SEEDS=https://relay-cosmos.spacesprotocol.org,https://relay-atlas.spacesprotocol.org' \
  "$role_dir/env/verifier.env.example"
grep -Fq 'SPACES_BITCOIN_TIP_URL=https://mempool.space/api/blocks/tip/height' \
  "$role_dir/env/verifier.env.example"
grep -Fq 'SPACES_CHAIN_MAX_TIP_LAG_BLOCKS=6' "$role_dir/env/verifier.env.example"
grep -Fq 'SPACES_CHAIN_MAX_ANCHOR_LAG_BLOCKS=108' "$role_dir/env/verifier.env.example"
grep -Fq 'SPACES_VERIFIER_MAX_ANCHOR_AGE_BLOCKS=4032' "$role_dir/env/verifier.env.example"

cat > "$work/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${SPACES_HEALTH_TEST_JSON:?}"
EOF
chmod +x "$work/curl"

PATH="$work:$PATH" SPACES_HEALTH_TEST_JSON='{"ok":true,"fabric_record_reader_ready":true,"fallback_target_disagreements":0,"fabric_relay_disagreements":0,"chain_state_ready":true}' \
  bash "$role_dir/bin/check-verifier-health.sh" >/dev/null
if PATH="$work:$PATH" SPACES_HEALTH_TEST_JSON='{"ok":false,"fabric_record_reader_ready":false,"fabric_relay_disagreements":0}' \
  bash "$role_dir/bin/check-verifier-health.sh" >/dev/null 2>&1; then
  echo "health check accepted a degraded Fabric record reader" >&2
  exit 1
fi
if PATH="$work:$PATH" SPACES_HEALTH_TEST_JSON='{"ok":true,"fabric_relay_disagreements":0}' \
  bash "$role_dir/bin/check-verifier-health.sh" >/dev/null 2>&1; then
  echo "health check accepted a missing Fabric reader signal" >&2
  exit 1
fi
if PATH="$work:$PATH" SPACES_HEALTH_TEST_JSON='{"ok":true,"fabric_record_reader_ready":true,"fallback_target_disagreements":1,"fabric_relay_disagreements":0}' \
  bash "$role_dir/bin/check-verifier-health.sh" >/dev/null 2>&1; then
  echo "health check accepted a native/fallback target disagreement" >&2
  exit 1
fi
if PATH="$work:$PATH" SPACES_HEALTH_TEST_JSON='{"ok":true,"fabric_record_reader_ready":true,"fallback_target_disagreements":0,"fabric_relay_disagreements":1}' \
  bash "$role_dir/bin/check-verifier-health.sh" >/dev/null 2>&1; then
  echo "health check accepted a Fabric relay disagreement" >&2
  exit 1
fi
if PATH="$work:$PATH" SPACES_HEALTH_TEST_JSON='{"ok":false,"fabric_record_reader_ready":true,"fallback_target_disagreements":0,"fabric_relay_disagreements":0,"chain_state_ready":false}' \
  bash "$role_dir/bin/check-verifier-health.sh" >/dev/null 2>&1; then
  echo "health check accepted stale chain or anchor state" >&2
  exit 1
fi

grep -Fq 'OnFailure=pirate-spaces-verifier-health-alert.service' \
  "$role_dir/systemd/pirate-spaces-verifier-health.service"
grep -Fq 'OnUnitActiveSec=5m' "$role_dir/systemd/pirate-spaces-verifier-health.timer"
grep -Fq 'alert-on-failure.sh' "$role_dir/systemd/pirate-spaces-verifier-health-alert.service"

echo "spaces verification role checks passed"
