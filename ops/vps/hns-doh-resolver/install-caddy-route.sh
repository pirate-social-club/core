#!/usr/bin/env bash
#
# Install the dns.pirate.sc DoH route into the LIVE Caddy JSON config.
#
# The production unit runs:
#   /usr/local/bin/pirate-caddy run --config /etc/caddy/caddy.json
# so editing /etc/caddy/Caddyfile does nothing. This patches the JSON that is
# actually loaded, validates it with the same custom binary, backs up the
# previous config, reloads, and smoke-tests. Idempotent: re-running replaces the
# existing dns.pirate.sc route rather than appending a duplicate.
set -euo pipefail

CADDY_BIN="${CADDY_BIN:-/usr/local/bin/pirate-caddy}"
CADDY_JSON="${CADDY_JSON:-/etc/caddy/caddy.json}"
ROUTE_JSON="${ROUTE_JSON:-$(dirname "$0")/caddy-route.json}"
HOSTNAME_MATCH="${HOSTNAME_MATCH:-dns.pirate.sc}"
SERVER_KEY="${SERVER_KEY:-srv0}"

for f in "$CADDY_BIN" "$CADDY_JSON" "$ROUTE_JSON"; do
  [ -e "$f" ] || { echo "missing required path: $f" >&2; exit 1; }
done

stamp="$(date -u +%Y%m%d%H%M%S)"
backup="${CADDY_JSON}.pre-doh-route-${stamp}"
work="$(mktemp)"
trap 'rm -f "$work"' EXIT

echo "==> backing up $CADDY_JSON -> $backup"
sudo cp -a "$CADDY_JSON" "$backup"

echo "==> patching route for $HOSTNAME_MATCH into $SERVER_KEY"
sudo python3 - "$CADDY_JSON" "$ROUTE_JSON" "$HOSTNAME_MATCH" "$SERVER_KEY" > "$work" <<'PY'
import json, sys

cfg_path, route_path, host, server_key = sys.argv[1:5]
cfg = json.load(open(cfg_path))
route = json.load(open(route_path))

servers = cfg["apps"]["http"]["servers"]
if server_key not in servers:
    sys.exit(f"server {server_key!r} not found; have {list(servers)}")
server = servers[server_key]
routes = server.setdefault("routes", [])

def matches_host(r):
    return any(host in m.get("host", []) for m in r.get("match", []))

# Idempotent: drop any existing route for this host before inserting.
routes[:] = [r for r in routes if not matches_host(r)]

# Insert ahead of catch-all routes (those with no host matcher), which would
# otherwise swallow the request. Host-matched routes keep their relative order.
insert_at = len(routes)
for i, r in enumerate(routes):
    if not any(m.get("host") for m in r.get("match", [])):
        insert_at = i
        break
routes.insert(insert_at, route)

# A route alone is not enough. This host's TLS config ends with a catch-all
# connection policy that selects the self-signed DANE gateway certificate, so a
# new hostname inherits that instead of getting an ACME-issued one, and clients
# see a self-signed cert for dns.pirate.sc. Insert an SNI-matched policy with no
# certificate_selection -- which is how verifier.pirate.sc already works -- ahead
# of any policy that has no matcher.
policies = server.setdefault("tls_connection_policies", [])

def matches_sni(p):
    return host in (p.get("match", {}) or {}).get("sni", [])

policies[:] = [p for p in policies if not matches_sni(p)]
policy_at = len(policies)
for i, p in enumerate(policies):
    if not (p.get("match", {}) or {}).get("sni"):
        policy_at = i
        break
policies.insert(policy_at, {"match": {"sni": [host]}})

json.dump(cfg, sys.stdout, indent=2)
PY

echo "==> validating with $CADDY_BIN"
sudo "$CADDY_BIN" validate --config "$work" --adapter "" >/dev/null

echo "==> installing and reloading"
sudo install -m 0644 -o root -g root "$work" "$CADDY_JSON"
sudo "$CADDY_BIN" reload --config "$CADDY_JSON" --adapter "" \
  || { echo "reload FAILED; restoring $backup" >&2; sudo install -m 0644 "$backup" "$CADDY_JSON"; sudo "$CADDY_BIN" reload --config "$CADDY_JSON" --adapter "" || true; exit 1; }

echo "==> smoke test"
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${HOSTNAME_MATCH}/" || echo 000)"
echo "GET https://${HOSTNAME_MATCH}/ -> $code"
if [ "$code" != "200" ]; then
  echo "WARNING: endpoint not answering 200 yet." >&2
  echo "If this is the first install, ACME may still be issuing; confirm the" >&2
  echo "A record for ${HOSTNAME_MATCH} exists and is DNS-only (grey cloud)." >&2
  echo "Previous config preserved at $backup" >&2
  exit 1
fi

echo "OK. Previous config preserved at $backup"
