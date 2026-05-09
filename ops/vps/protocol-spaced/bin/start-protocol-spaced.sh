#!/usr/bin/env bash
set -euo pipefail

: "${SPACED_BIN:?SPACED_BIN is required}"
: "${SPACED_DATA_DIR:?SPACED_DATA_DIR is required}"
: "${BITCOIN_RPC_URL:?BITCOIN_RPC_URL is required}"

cmd=("$SPACED_BIN" --chain "${SPACED_CHAIN:-mainnet}" --data-dir "$SPACED_DATA_DIR" --bitcoin-rpc-url "$BITCOIN_RPC_URL")

if [ -n "${BITCOIN_RPC_USER:-}" ] && [ -n "${BITCOIN_RPC_PASS:-}" ]; then
  cmd+=(--bitcoin-rpc-user "$BITCOIN_RPC_USER" --bitcoin-rpc-password "$BITCOIN_RPC_PASS")
fi

if [ -n "${SPACED_RPC_USER:-}" ] && [ -n "${SPACED_RPC_PASSWORD:-}" ]; then
  cmd+=(--rpc-user "$SPACED_RPC_USER" --rpc-password "$SPACED_RPC_PASSWORD")
fi

if [ -n "${SPACED_RPC_PORT:-}" ]; then
  cmd+=(--rpc-port "$SPACED_RPC_PORT")
fi

if [ -n "${SPACED_RPC_BIND:-}" ]; then
  read -r -a binds <<< "$SPACED_RPC_BIND"
  for bind in "${binds[@]}"; do
    cmd+=(--rpc-bind "$bind")
  done
fi

exec "${cmd[@]}"
