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
- suitable for many HNS zones on one box

## What This Serves

This stack serves authoritative DNS for delegated Handshake roots such as:

- `infinity.`
- future Pirate-managed HNS roots

Once the Handshake root delegates to this server's nameservers, ordinary subdomains in the zone work here:

- `profile.infinity`
- `*.infinity`

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

## Notes

- This stack is authoritative DNS only.
- It does not run `hsd`.
- It does not run `hnsd`.
- It does not publish Handshake root updates by itself.
- The VPS must allow `53/udp` and `53/tcp`.
