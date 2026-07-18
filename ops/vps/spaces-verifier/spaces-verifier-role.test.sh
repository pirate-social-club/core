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
grep -Fq 'User=pirate-spaces' "$role_dir/systemd/pirate-spaced.service"
grep -Fq 'ReadWritePaths=/srv/pirate-spaces/data/spaced' "$role_dir/systemd/pirate-spaced.service"
grep -Fq 'After=network-online.target pirate-spaced.service' "$role_dir/systemd/pirate-spaces-verifier.service"

echo "spaces verification role checks passed"
