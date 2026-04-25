#!/usr/bin/env bash
set -euo pipefail

set -a
# shellcheck disable=SC1091
source /srv/pirate-spaces/config/community-provision-operator.env
set +a

exec /srv/pirate-spaces/.bun/bin/bun run scripts/turso/turso-control-plane-operator.ts
