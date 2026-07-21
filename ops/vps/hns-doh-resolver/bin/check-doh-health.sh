#!/usr/bin/env bash
set -euo pipefail

# End-to-end health check for the public DoH resolver.
#
# Deliberately queries the PUBLIC endpoint rather than the loopback backends, so
# it exercises the whole chain -- Caddy TLS termination, the reverse proxy hop,
# dnsdist, and hnsd -- in one probe. A container-level check would stay green
# while the published service was unreachable.
#
# The container healthcheck already gates hnsd's own sync state (Hesiod
# synced.chain.hnsd + tip age); this covers reachability and real resolution.

endpoint="${HNS_DOH_ENDPOINT:-}"
probe_name="${HNS_DOH_PROBE_NAME:-app.pirate}"
timeout_seconds="${HNS_DOH_TIMEOUT_SECONDS:-15}"
attempts="${HNS_DOH_ATTEMPTS:-3}"
base_delay="${HNS_DOH_BASE_DELAY_SECONDS:-2}"

[[ -n "$endpoint" ]] || { echo "HNS_DOH_ENDPOINT is required" >&2; exit 2; }
[[ "$attempts" =~ ^[0-9]+$ && "$attempts" -ge 1 ]] || { echo "invalid HNS_DOH_ATTEMPTS" >&2; exit 2; }

# Build a DNS wire query for the probe name and base64url-encode it, the same
# shape a real DoH client sends. Kept in awk/printf so the check has no runtime
# dependency beyond coreutils + curl.
wire_query() {
  local name="$1"
  local out=""
  local IFS='.'
  for label in $name; do
    [[ -n "$label" ]] || continue
    out+=$(printf '\\x%02x' "${#label}")
    out+=$(printf '%s' "$label" | od -An -tx1 -v | tr -d ' \n' | sed 's/../\\x&/g')
  done
  # header: id=0x2a2a, RD set, qdcount=1 | terminator + QTYPE=A QCLASS=IN
  printf '\\x2a\\x2a\\x01\\x00\\x00\\x01\\x00\\x00\\x00\\x00\\x00\\x00%s\\x00\\x00\\x01\\x00\\x01' "$out"
}

encoded="$(printf "$(wire_query "$probe_name")" | base64 -w0 | tr '+/' '-_' | tr -d '=')"

stderr_file="$(mktemp)"
trap 'rm -f "$stderr_file"' EXIT

# pipefail matters here: without it the `if` below would test od's exit status
# rather than curl's, so a failed request would look like a success carrying
# junk bytes. Keep curl's stderr out of the pipe too, or the error text gets
# hex-encoded along with the (absent) response body.
set -o pipefail

attempt=1
last_error=""
while (( attempt <= attempts )); do
  # --fail so an HTTP error status is a failure, not an empty success.
  if response="$(curl -sS --fail --max-time "$timeout_seconds" \
      -H 'accept: application/dns-message' \
      "${endpoint}?dns=${encoded}" 2>"$stderr_file" | od -An -tx1 -v | tr -d ' \n')"; then
    # Byte 3 low nibble is RCODE; bytes 6-7 are ANCOUNT.
    rcode=$(( 0x${response:6:2} & 0x0f ))
    ancount=$(( 0x${response:12:4} ))
    if (( rcode == 0 && ancount > 0 )); then
      printf 'ok: %s resolved %s (answers=%d)\n' "$endpoint" "$probe_name" "$ancount"
      exit 0
    fi
    last_error="rcode=$rcode ancount=$ancount"
  else
    last_error="$(tr -d '\n' < "$stderr_file")"
  fi
  if (( attempt < attempts )); then
    sleep "$(( base_delay * attempt ))"
  fi
  (( attempt++ ))
done

printf 'DoH health failure: %s could not resolve %s after %d attempts; last: %s\n' \
  "$endpoint" "$probe_name" "$attempts" "${last_error//$'\n'/ }" >&2
exit 1
