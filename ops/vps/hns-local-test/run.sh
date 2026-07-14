#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose --project-directory "$here" --project-name pirate-hns-local-test)
test_run_dir="$(mktemp -d)"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 ]]; then
    echo "local HNS integration test failed; PowerDNS logs follow" >&2
    "${compose[@]}" logs primary secondary >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$test_run_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

for command in awk diff docker grep openssl seq sleep sort tr; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "required command not found: $command" >&2
    exit 1
  fi
done

export PDNS_API_KEY="${PDNS_API_KEY:-local-pdns-api-key}"

"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
"${compose[@]}" up --detach --build primary secondary

for _ in $(seq 1 60); do
  if "${compose[@]}" exec -T primary pdns_control rping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
"${compose[@]}" exec -T primary pdns_control rping >/dev/null

tsig_secret="$(openssl rand -base64 32 | tr -d '\n')"
"${compose[@]}" exec -T primary \
  pdnsutil tsigkey import pirate-axfr hmac-sha256 "$tsig_secret" >/dev/null
"${compose[@]}" exec -T secondary \
  pdnsutil tsigkey import pirate-axfr hmac-sha256 "$tsig_secret" >/dev/null
"${compose[@]}" exec -T secondary \
  pdnsutil autoprimary add 172.30.53.10 ns2.pirate pirate-local >/dev/null
"${compose[@]}" exec -T primary pdns_control rediscover >/dev/null
"${compose[@]}" exec -T secondary pdns_control rediscover >/dev/null

# An unsigned NOTIFY from an untrusted tools container must not provision an
# unknown zone. This is defense in depth around signed autoprimary.
"${compose[@]}" run --rm --no-deps --entrypoint dig dns-tools \
  @secondary refused-test. SOA +opcode=notify +tries=1 +time=1 >/dev/null 2>&1 || true
if "${compose[@]}" exec -T secondary pdnsutil zone show refused-test. >/dev/null 2>&1; then
  echo "unsigned unknown-zone NOTIFY was accepted" >&2
  exit 1
fi

"${compose[@]}" run --rm --no-deps provisioner \
  /workspace/ops/vps/hns-local-test/provision-zone.ts initial

# The secondary zone must be absent before signed NOTIFY and then appear
# automatically; the test never creates it directly.
for _ in $(seq 1 30); do
  if "${compose[@]}" exec -T secondary pdnsutil zone show crew. >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
"${compose[@]}" exec -T secondary pdnsutil zone show crew. >/dev/null

dig_in_tools() {
  "${compose[@]}" run --rm --no-deps --entrypoint dig dns-tools "$@"
}

unsigned_axfr="$(dig_in_tools @primary crew. AXFR +tries=1 +time=2 2>&1 || true)"
if grep -q 'XFR size' <<< "$unsigned_axfr"; then
  echo "unsigned AXFR unexpectedly succeeded" >&2
  exit 1
fi

signed_axfr="$(dig_in_tools -y "hmac-sha256:pirate-axfr:$tsig_secret" @primary crew. AXFR +tries=1 +time=2 2>&1)"
if ! grep -q 'XFR size' <<< "$signed_axfr"; then
  echo "TSIG-authenticated AXFR did not succeed" >&2
  echo "$signed_axfr" >&2
  exit 1
fi
if ! grep -q ' RRSIG ' <<< "$signed_axfr"; then
  echo "authenticated AXFR contained no transferred signatures" >&2
  exit 1
fi

query_sorted() {
  local server="$1"
  local type="$2"
  dig_in_tools "@$server" crew. "$type" +short +tries=1 +time=2 | sort
}

for type in SOA DNSKEY; do
  primary_answer="$(query_sorted primary "$type")"
  secondary_answer="$(query_sorted secondary "$type")"
  if [[ -z "$primary_answer" || "$primary_answer" != "$secondary_answer" ]]; then
    echo "$type differs between primary and secondary" >&2
    diff -u <(printf '%s\n' "$primary_answer") <(printf '%s\n' "$secondary_answer") || true
    exit 1
  fi
done

secondary_key_count="$("${compose[@]}" exec -T secondary sqlite3 \
  /var/lib/powerdns/pdns.sqlite3 'SELECT COUNT(*) FROM cryptokeys;')"
if [[ "$secondary_key_count" != "0" ]]; then
  echo "secondary unexpectedly contains DNSSEC private keys" >&2
  exit 1
fi

trust_anchor="$test_run_dir/crew.keys"
{
  echo 'trust-anchors {'
  while read -r flags protocol algorithm public_key; do
    printf '  crew. static-key %s %s %s "%s";\n' \
      "$flags" "$protocol" "$algorithm" "$public_key"
  done < <(query_sorted primary DNSKEY)
  echo '};'
} > "$trust_anchor"

for server in primary secondary; do
  "${compose[@]}" run --rm --no-deps \
    --volume "$test_run_dir:/anchors:ro" \
    --entrypoint delv dns-tools \
    -a /anchors/crew.keys +root=crew "@$server" crew. A +short >/dev/null
done

initial_serial="$(query_sorted primary SOA | awk '{print $3}')"
"${compose[@]}" run --rm --no-deps provisioner \
  /workspace/ops/vps/hns-local-test/provision-zone.ts update

for _ in $(seq 1 30); do
  primary_serial="$(query_sorted primary SOA | awk '{print $3}')"
  secondary_serial="$(query_sorted secondary SOA | awk '{print $3}')"
  if [[ "$primary_serial" == "$secondary_serial" && "$primary_serial" -gt "$initial_serial" ]]; then
    break
  fi
  sleep 1
done

primary_serial="$(query_sorted primary SOA | awk '{print $3}')"
secondary_serial="$(query_sorted secondary SOA | awk '{print $3}')"
if [[ "$primary_serial" != "$secondary_serial" || "$primary_serial" -le "$initial_serial" ]]; then
  echo "serial update did not propagate through NOTIFY/AXFR" >&2
  exit 1
fi

primary_txt="$(dig_in_tools @primary _pirate.crew. TXT +short +tries=1 +time=2)"
secondary_txt="$(dig_in_tools @secondary _pirate.crew. TXT +short +tries=1 +time=2)"
if [[ "$primary_txt" != '"local-replication=update"' || "$secondary_txt" != "$primary_txt" ]]; then
  echo "updated TXT did not replicate" >&2
  exit 1
fi

echo "local HNS primary/secondary DNSSEC + TSIG replication test passed"
