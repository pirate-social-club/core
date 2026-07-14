# HNS Secondary Authoritative DNS

This role is the independent `ns2` for Pirate-managed Handshake zones. Run it
on a different provider and in a different region from the primary edge. It
serves transferred, already-signed zone data only; it has no PowerDNS API,
wallet, verifier, gateway, or local DNSSEC signing role.

PowerDNS 5.1 is pinned to the same reviewed digest as the primary. New zones are
created through PowerDNS autosecondary after a TSIG-signed NOTIFY from the one
registered primary, then retrieved using TSIG-authenticated AXFR. Unsigned
autoprimary notifications are rejected.

## Security model

- `allow-notify-from` is restricted to `PRIMARY_DNS_IP`.
- the primary must also be registered in the secondary's autoprimary table
- unknown-zone provisioning requires signed NOTIFY
- the shared TSIG key must already exist on both servers
- AXFR serving from this secondary is disabled
- the HTTP API and webserver are disabled

The IP allowlist is defense in depth, not authentication. TSIG authenticates
the NOTIFY and AXFR relationship. Keep port 53 UDP/TCP public; keep SSH limited
to the operator network.

PowerDNS stores and compares the autoprimary nameserver in canonical SQL form
without a trailing dot. Register `ns2.pirate`, even though zone NS RDATA is
rendered as `ns2.pirate.`. A trailing dot in the autoprimary row causes valid
NOTIFY processing to fail with "no backend willing to host".

## One-time bootstrap

Copy this directory to the secondary host and create a real environment file
outside version control from `env/pdns-secondary.env.example`.

Initialize the SQLite schema with the same uid used by the image:

```bash
mkdir -p data
sudo chown -R 953:953 data
docker run --rm --user 953:953 -v "$PWD/data:/var/lib/powerdns" \
  --entrypoint /bin/sh \
  powerdns/pdns-auth-51@sha256:f976e753a1de8ec62636203ecb12ae5fa3d1055601be167de53f1f673e0abe59 \
  -c 'sqlite3 /var/lib/powerdns/pdns.sqlite3 < /usr/local/share/doc/pdns/schema.sqlite3.sql'
```

Import the **same** key generated on the primary. Load the non-secret operator
configuration, then read the secret without putting it directly in shell
history and register the primary:

```bash
set -a
source /srv/pirate-hns-secondary/config/pdns-secondary.env
set +a
read -rsp 'AXFR TSIG secret: ' PDNS_AXFR_TSIG_SECRET; printf '\n'
export PDNS_AXFR_TSIG_SECRET
docker compose --env-file /srv/pirate-hns-secondary/config/pdns-secondary.env up -d
docker compose --env-file /srv/pirate-hns-secondary/config/pdns-secondary.env exec -T \
  -e PDNS_AXFR_TSIG_SECRET powerdns-secondary /bin/sh -lc \
  'pdnsutil tsigkey import pirate-axfr hmac-sha256 "$PDNS_AXFR_TSIG_SECRET"'
unset PDNS_AXFR_TSIG_SECRET

docker compose --env-file /srv/pirate-hns-secondary/config/pdns-secondary.env exec -T \
  powerdns-secondary pdnsutil autoprimary add \
  "$PRIMARY_DNS_IP" "$PDNS_AUTOPRIMARY_NAMESERVER" "$PDNS_AUTOPRIMARY_ACCOUNT"
```

Do not commit or retain `PDNS_AXFR_TSIG_SECRET` in an env file after import.

## Primary requirements

The primary must:

- run with `primary=yes`
- create zones as `Master`
- include `ns2.pirate.` in each zone's NS set
- set `TSIG-ALLOW-AXFR=pirate-axfr` on every zone
- rectify signed zones after API writes
- notify the secondary IP

The canonical verifier's `ensureZone` path converges the TSIG metadata on every
call, including recovered zones and create races. PowerDNS signs NOTIFY when a
zone has the TSIG relationship, allowing the secondary to assign the same key
as its `AXFR-MASTER-TSIG` consumer metadata.

## Acceptance test

Do not count the secondary as live until all of these pass for a signed test
zone and, after transfer, for `pirate.`:

1. an unsigned AXFR against the primary is refused
2. a TSIG-authenticated AXFR against the primary succeeds
3. a newly created primary zone appears automatically on the secondary
4. primary and secondary return the same SOA serial, DNSKEY set, TXT data, and
   RRSIG-covered answers over public UDP and TCP
5. a subsequent primary API update advances the serial and reaches the
   secondary after NOTIFY without manual provisioning
6. an unsigned NOTIFY for an unknown zone does not create it

Zone deletion does not replicate through AXFR. Removing a managed zone is a
separate, explicit operation on both authorities.

## Backup

Back up this SQLite database for fast recovery, but treat the primary backup as
the canonical source because it contains the writable zone and DNSSEC-key
lifecycle. Test rebuilding this secondary from the primary plus the TSIG key.

References:

- PowerDNS secondary operation: https://doc.powerdns.com/authoritative/modes-of-operation.html
- Generic SQL autoprimary: https://doc.powerdns.com/authoritative/backends/generic-sql.html
- TSIG metadata: https://doc.powerdns.com/authoritative/tsig.html
