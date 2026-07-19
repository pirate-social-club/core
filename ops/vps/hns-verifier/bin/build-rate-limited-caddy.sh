#!/usr/bin/env bash
set -euo pipefail

caddy_version="v2.11.4"
xcaddy_version="v0.4.5"
rate_limit_module="github.com/mholt/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db"
output="${1:?usage: build-rate-limited-caddy.sh OUTPUT_PATH}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

GOBIN="$work/bin" go install "github.com/caddyserver/xcaddy/cmd/xcaddy@${xcaddy_version}"
"$work/bin/xcaddy" build "$caddy_version" \
  --with "$rate_limit_module" \
  --output "$output"

"$output" list-modules | grep -Fxq 'http.handlers.rate_limit'
"$output" version
sha256sum "$output"
