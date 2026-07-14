#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose --project-directory "$here" --project-name pirate-hns-backup-test --profile backup)

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 ]]; then
    echo "local backup round-trip failed; service logs follow" >&2
    "${compose[@]}" logs primary minio restore-primary >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

for command in docker grep openssl sed sleep; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "required command not found: $command" >&2
    exit 1
  fi
done

export PDNS_API_KEY=local-pdns-api-key
"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
"${compose[@]}" up --detach --build primary minio

for _ in $(seq 1 60); do
  if "${compose[@]}" exec -T primary pdns_control rping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
"${compose[@]}" exec -T primary pdns_control rping >/dev/null

"${compose[@]}" run --rm minio-setup

tsig_secret="$(openssl rand -base64 32 | tr -d '\n')"
"${compose[@]}" exec -T primary \
  pdnsutil tsigkey import pirate-axfr hmac-sha256 "$tsig_secret" >/dev/null
"${compose[@]}" exec -T primary pdns_control rediscover >/dev/null

"${compose[@]}" run --rm --no-deps provisioner \
  /workspace/ops/vps/hns-local-test/provision-zone.ts initial

"${compose[@]}" run --rm --no-deps --build \
  --entrypoint /workspace/ops/vps/hns-local-test/backup-roundtrip-inner.sh \
  backup-tools

object_name="$("${compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-client \
  -lc 'cat /test/archive-object-name')"
if [[ -z "$object_name" ]]; then
  echo "backup harness did not record an uploaded object name" >&2
  exit 1
fi

retention_info="$("${compose[@]}" run --rm --no-deps minio-client \
  retention info --json "local/hns-backups/$object_name")"
if ! grep -qi 'compliance' <<< "$retention_info"; then
  echo "uploaded object did not inherit COMPLIANCE retention" >&2
  echo "$retention_info" >&2
  exit 1
fi

stat_json="$("${compose[@]}" run --rm --no-deps minio-client \
  stat --json "local/hns-backups/$object_name")"
version_id="$(sed -nE 's/.*"versionI[Dd]":"([^"]+)".*/\1/p' <<< "$stat_json" | head -n 1)"
if [[ -z "$version_id" ]]; then
  echo "could not read locked object version id" >&2
  echo "$stat_json" >&2
  exit 1
fi

if "${compose[@]}" run --rm --no-deps minio-client \
  rm --version-id "$version_id" "local/hns-backups/$object_name" >/dev/null 2>&1; then
  echo "COMPLIANCE-locked object version was deletable" >&2
  exit 1
fi
"${compose[@]}" run --rm --no-deps minio-client \
  stat "local/hns-backups/$object_name" >/dev/null

"${compose[@]}" up --detach restore-primary
for _ in $(seq 1 30); do
  if "${compose[@]}" exec -T restore-primary pdns_control rping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
"${compose[@]}" exec -T restore-primary pdns_control rping >/dev/null

"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh dns-tools -lc \
  'dig @restore-primary crew. DNSKEY +short +tries=1 +time=2 | sort | diff -u /test/original-dnskey -'
"${compose[@]}" run --rm --no-deps --entrypoint delv dns-tools \
  -a /test/crew.keys +root=crew @restore-primary crew. A +short >/dev/null

restored_txt="$("${compose[@]}" run --rm --no-deps --entrypoint dig dns-tools \
  @restore-primary _pirate.crew. TXT +short +tries=1 +time=2)"
if [[ "$restored_txt" != '"local-replication=initial"' ]]; then
  echo "restored authority returned unexpected TXT data" >&2
  exit 1
fi

echo "local encrypted backup + Object Lock + restored PowerDNS test passed"
