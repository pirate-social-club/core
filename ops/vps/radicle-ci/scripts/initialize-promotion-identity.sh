#!/usr/bin/env bash
set -euo pipefail

[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 1; }
getent passwd promotion >/dev/null || { echo 'promotion user is missing' >&2; exit 1; }

home=/var/lib/promotion
socket="$home/identity-bootstrap-agent.sock"
key="$home/keys/radicle"
agent_pid=''

cleanup() {
  if [[ -n "$agent_pid" ]]; then
    kill "$agent_pid" 2>/dev/null || true
    wait "$agent_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -s "$key" ]]; then
  exec runuser -u promotion -- env HOME="$home" RAD_HOME="$home" rad self --did
fi

runuser -u promotion -- ssh-agent -D -a "$socket" >/dev/null 2>&1 &
agent_pid=$!
for _ in $(seq 1 50); do
  [[ -S "$socket" ]] && break
  sleep 0.1
done
[[ -S "$socket" ]] || { echo 'temporary signing agent did not start' >&2; exit 1; }

# An online controller key is intentionally passphrase-free so systemd can
# restart unattended. Filesystem isolation and the human-only escrowed recovery
# delegate are its controls. The key never leaves this host or enters escrow.
printf '\n' | runuser -u promotion -- env \
  HOME="$home" RAD_HOME="$home" SSH_AUTH_SOCK="$socket" \
  rad auth --stdin --alias promotion-controller
chmod 0600 "$key"
runuser -u promotion -- env HOME="$home" RAD_HOME="$home" rad self --did
