#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
	echo "usage: $0 CADDYFILE OUTPUT_JSON" >&2
	exit 64
fi

input=$1
output=$2
temporary="${output}.tmp.$$"
caddy_bin=${CADDY_BIN:-caddy}
trap 'rm -f "$temporary"' EXIT HUP INT TERM

# A static certificate loaded by the HTTPS catchall causes the Caddyfile
# adapter to emit one unscoped certificate-selection policy. Split that into
# two ordered policies: the public verifier uses normal SNI selection (and its
# managed ACME certificate), while every other SNI uses the tagged DANE cert.
"$caddy_bin" adapt --adapter caddyfile --config "$input" --pretty \
	| jq '
		.apps.http.servers |= with_entries(
			.value |= if (.tls_connection_policies? | type) == "array"
			then .tls_connection_policies |=
				(if (length == 1 and .[0].certificate_selection.any_tag == ["cert0"])
				 then [
					{"match": {"sni": ["verifier.pirate.sc"]}},
					.[0]
				 ]
				 else error("expected one catchall cert0 TLS connection policy")
				 end)
			else .
			end
		)
	' >"$temporary"

"$caddy_bin" validate --config "$temporary"
chmod 0644 "$temporary"
mv "$temporary" "$output"
trap - EXIT HUP INT TERM
