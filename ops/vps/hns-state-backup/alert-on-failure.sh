#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1090
source "${BACKUP_ALERT_LIBRARY:-$script_dir/../lib/backup-alert.sh}"
send_backup_failure_alert hns-edge "${1:-unknown-unit}"
