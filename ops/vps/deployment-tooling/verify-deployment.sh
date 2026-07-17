#!/usr/bin/env bash
# Drift check for systemd timers and scripted use: identical to
# deployment-status.sh but exits nonzero when any drift is detected.
set -euo pipefail
exec "$(dirname "$(readlink -f "$0")")/deployment-status.sh" --verify "$@"
