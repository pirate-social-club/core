#!/usr/bin/env bash
set -euo pipefail

role_dir="$(cd "$(dirname "$0")" && pwd)"
unit="$role_dir/systemd/pirate-hns-verifier.service"
backup_readme="$role_dir/../hns-state-backup/README.md"

grep -Fxq 'WorkingDirectory=/srv/pirate-hns-verifier/app' "$unit"
grep -Fxq 'EnvironmentFile=/srv/pirate-hns-verifier/config/hns-verifier.env' "$unit"
if grep -Fq '/srv/pirate-hns/app' "$unit"; then
  echo "HNS verifier unit still shares the state-backup app root" >&2
  exit 1
fi
grep -Fq '/srv/pirate-hns-verifier/current' "$role_dir/README.md"
grep -Fq 'record-installed-files.sh' "$role_dir/README.md"
grep -Fq 'set -euo pipefail' "$backup_readme"
grep -Fq 'declared backup app metadata does not match' "$backup_readme"
grep -Fq 'declared backup app checksums failed' "$backup_readme"
grep -Fq '$backup_root/app.next' "$backup_readme"
grep -Fq -- '--deploy-root "$backup_root" --verify' "$backup_readme"

echo "all HNS verifier role checks passed"
