# HNS Authoritative DNS Deployment

This directory contains the tracked deployment config for Pirate-managed HNS authoritative DNS.

Goals:

- keep the main Pirate app on Cloudflare-hosted ordinary domains
- run lightweight authoritative DNS for HNS roots on a small VPS
- avoid local Docker builds on a weak developer machine
- avoid running a full Handshake node on the DNS host

## Stack

- CoreDNS in Docker
- zone files mounted from this directory

Why this stack:

- lightweight
- no local image build required
- easy to track zone changes in git
- suitable for many HNS zones on one box once zone provisioning is automated

Important:

- the current checked-in `file` plugin setup is a bootstrap proof of concept
- the static sample zones only prove that the VPS can serve delegated child zones
- they are not sufficient for arbitrary HNS roots created at runtime

## What This Serves

This stack serves authoritative DNS for delegated Handshake roots such as:

- `infinity.`
- future Pirate-managed HNS roots after Pirate provisions those child zones

Once the Handshake root delegates to this server's nameservers, ordinary subdomains in the zone work here:

- `profile.infinity`
- `*.infinity`

What this stack does not do yet:

- auto-create a new `<root>.` zone when a creator delegates `kanye/` or another HNS root to Pirate
- publish `_pirate.<root>` TXT challenges dynamically for verification sessions
- expose a canonical backing store shared by DNS serving, `/inspect`, and `/verify-txt`

## Files

- `compose.yaml`
  Docker Compose deployment for CoreDNS.
- `Corefile`
  CoreDNS config.
- `deploy.sh`
  Remote-first sync and restart helper for the VPS.
- `zones/db.infinity`
  Initial example zone for `infinity.`
- `zones/db.pirate-dns.invalid`
  Placeholder internal test zone.

## Deployment Model

The intended workflow is remote-first:

1. edit tracked config here
2. copy this directory to the VPS
3. run `docker compose pull`
4. run `docker compose up -d`

This avoids local builds entirely.

## First Production Tasks

Before `infinity.` can resolve in HNS-aware environments, you still need:

1. stable public IPv4 for the VPS
2. Handshake `NS` delegation for `infinity`
3. a second nameserver later for redundancy
4. real apex and subdomain IP targets in `zones/db.infinity`

Before arbitrary delegated HNS roots can be supported, Pirate also needs:

1. a canonical zone backing model for Pirate-managed HNS roots
2. automated zone provisioning for each delegated `<root>.`
3. `_pirate.<root>` challenge publication tied to the verification session lifecycle
4. `/verify-txt` to read from the same authoritative source the DNS server uses

Recommended model:

1. Handshake parent data is used only to inspect delegation posture such as `NS` and glue.
2. Pirate authoritative DNS serves the delegated child zone.
3. Session challenge publication writes into Pirate's authoritative child-zone backing store.
4. DNS serving and verification both read from that same backing store.

Do not rely on parent-side TXT data in ShakeStation after `NS` delegation. Once the child zone is
delegated, `_pirate.<root>` must be served by the delegated authoritative DNS path.

## Notes

- This stack is authoritative DNS only.
- It does not run `hsd`.
- It does not run `hnsd`.
- It does not publish Handshake root updates by itself.
- The VPS must allow `53/udp` and `53/tcp`.
