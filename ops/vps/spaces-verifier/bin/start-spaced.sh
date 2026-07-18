#!/usr/bin/env bash
set -euo pipefail

: "${SPACED_BIN:?SPACED_BIN is required}"
: "${SPACED_DATA_DIR:?SPACED_DATA_DIR is required}"
: "${BITCOIN_RPC_URL:?BITCOIN_RPC_URL is required}"
: "${SPACED_RPC_USER:?SPACED_RPC_USER is required}"
: "${SPACED_RPC_PASS:?SPACED_RPC_PASS is required}"

cmd=(
  "$SPACED_BIN"
  --chain "${SPACED_CHAIN:-mainnet}"
  --data-dir "$SPACED_DATA_DIR"
  --bitcoin-rpc-url "$BITCOIN_RPC_URL"
  --rpc-user "$SPACED_RPC_USER"
  --rpc-password "$SPACED_RPC_PASS"
  --rpc-bind 127.0.0.1
  --rpc-port "${SPACED_RPC_PORT:-7225}"
  --jobs "${SPACED_JOBS:-4}"
)

if [[ -n "${BITCOIN_RPC_USER:-}" ]]; then
  : "${BITCOIN_RPC_PASS:?BITCOIN_RPC_PASS is required when BITCOIN_RPC_USER is set}"
  cmd+=(--bitcoin-rpc-user "$BITCOIN_RPC_USER" --bitcoin-rpc-password "$BITCOIN_RPC_PASS")
fi

exec "${cmd[@]}"
