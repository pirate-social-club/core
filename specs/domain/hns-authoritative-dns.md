# HNS Authoritative DNS

Status: draft

Related docs:

- [namespace.md](./namespace.md)
- [namespace-root-control.md](./namespace-root-control.md)
- [hns-verification-flow.md](./hns-verification-flow.md)
- [handles.md](./handles.md)

## Purpose

This doc defines the operational deployment model required for Pirate-managed HNS roots to resolve in HNS-aware environments.

It exists to separate:

- proof that a creator controls an HNS root
- proof that Pirate currently has routing or DNS authority
- the actual infrastructure required for `infinity/`, `profile.infinity`, or `alice.infinity` to resolve

## Scope

This doc covers:

- what must exist for HNS-native resolution
- how `profile.infinity` and other subdomains resolve
- what infrastructure Pirate must run itself
- what Cloudflare can and cannot do in this model
- the minimum recommended deployment topology for public v0

This doc does not define:

- the exact user onboarding UX
- the exact Handshake wallet or registrar workflow used to publish root records
- the DANE or certificate hardening path for browser trust

## Core Distinction

Pirate must not treat these as the same thing:

- `root_control_verified`
- `routing_enabled`
- `pirate_dns_authority_verified`
- "a normal browser can open the HNS root without special resolver support"

Important:

- HNS verification proves root control and may classify routing or delegation posture
- HNS-aware resolution requires the root to delegate to real authoritative nameservers
- ordinary "normie" browser access should still use `pirate.sc/c/<label>` or another ICANN-domain gateway path
- native `https://infinity/` reachability is a separate DNS plus TLS problem and must not be implied by TXT proof alone

## Resolution Model

Handshake stores the root delegation for the TLD.

For a root such as `infinity`, Pirate or the root owner must publish Handshake records that direct HNS-aware resolvers to the authoritative DNS service for `infinity.`

That means:

- Handshake holds the referral for `infinity`
- Pirate's authoritative DNS servers hold the actual `infinity.` zone
- subdomains such as `profile.infinity.` resolve from that ordinary authoritative zone

## Delegation Boundary

The parent Handshake record set and the delegated child zone must not be conflated.

If the owner sets `NS` for `kanye/` in ShakeStation:

- Handshake stores the delegation for `kanye`
- HNS-aware resolvers follow that delegation to the named authoritative DNS service
- records inside the child zone, such as `_pirate.kanye.`, `kanye.`, or `profile.kanye.`, must then be served by that authoritative DNS service

Important:

- after `NS` delegation, `_pirate.<root>` TXT proof is no longer satisfied by a parent-side TXT value stored only in ShakeStation
- the delegated authoritative DNS host must actually serve the `<root>.` zone
- a static DNS server that only serves `infinity.` will not automatically answer for `kanye.` just because ShakeStation now points `kanye/` at that server

This is the operational source of confusion behind "the user added NS and TXT in ShakeStation but `_pirate.kanye` still does not resolve." The parent registry can publish delegation. It does not auto-host the delegated zone contents.

## Current Direction

The tracked deployment direction under `ops/vps/hns-authoritative-dns/` should be treated as
PowerDNS Authoritative with a writable backend.

Reason:

- Pirate expects many delegated Handshake roots
- each root becomes its own child zone
- verification sessions need dynamic `_pirate.<root>` TXT publication
- DNS serving and `/verify-txt` need one shared authoritative source of truth

Static zone files can demonstrate the delegation model, but they are not the recommended public-v0
architecture for multi-root operation.

Example:

- Handshake root: `infinity`
- native HNS hostname: `profile.infinity`
- normie gateway route: `pirate.sc/c/infinity`

## Required Components

For `infinity/` and `profile.infinity` to resolve in HNS-aware environments, Pirate needs all of:

- a registered Handshake root name such as `infinity`
- Handshake `NS` records for that root, or equivalent supported Handshake delegation records
- reachable authoritative nameservers for the `infinity.` zone
- zone records inside `infinity.` for:
  - the apex `infinity.`
  - `profile.infinity.`
  - any other explicitly supported subdomains
  - optional wildcard records when Pirate wants wildcard web routing

The authoritative nameserver is the key missing infrastructure. A recursive HNS resolver alone is not sufficient.

## What Pirate Must Run

Public v0 should assume Pirate runs, or contracts for, authoritative DNS for the HNS roots it wants to route through Pirate-managed infrastructure.

Minimum requirement:

- one always-on authoritative DNS deployment

Recommended production posture:

- two authoritative nameservers
- distinct hosts, and ideally distinct failure domains

Authoritative DNS software may be any conventional DNS server that can host the `infinity.` zone,
but the recommended choice for Pirate is:

- PowerDNS Authoritative

because it supports writable backends and an HTTP API that match Pirate's provisioning model.

Pirate may also run an HTTP reverse proxy on the same host if native HNS web traffic should be forwarded into the existing Pirate app stack.

One VPS may host multiple roles if that is the cheapest operational path:

- authoritative DNS for delegated HNS zones
- the Pirate reverse proxy for native HNS web routes
- the verification API and verifier workers
- the separate Spaces verifier runtime

That consolidation is acceptable for public v0 as long as the logical responsibilities stay separate:

- authoritative DNS serves delegated HNS child zones
- the HNS verifier reads those zones
- the Spaces verifier performs proof and signature checks unrelated to DNS

## What Pirate Does Not Need To Run

Pirate does not need a full archival Handshake node just to serve the `infinity.` zone.

Important:

- authoritative DNS for `infinity.` is cheap and lightweight
- a full-chain Handshake node is not required on the authoritative DNS server
- a recursive HNS resolver such as `hnsd` is optional and solves a different problem

Operationally:

- authoritative DNS answers questions about the `infinity.` zone
- recursive HNS resolvers help users look up Handshake names
- Handshake chain infrastructure is only needed to publish or update the root's on-chain delegation records

Recommended v0 posture:

- do not run a full Handshake node on the authoritative DNS host
- if Pirate self-hosts Handshake chain operations, use a separate pruned or otherwise lighter-weight chain setup for root-record updates
- Pirate may instead rely on an external registrar or operational provider for publishing Handshake root updates

## Cloudflare Posture

Cloudflare remains valid for the ordinary Pirate web product surface, but it is not the authoritative hosting path for the Handshake TLD itself.

Recommended interpretation:

- keep `pirate.sc` and other ordinary web surfaces on Cloudflare
- do not model Cloudflare zone onboarding as the way `infinity.` itself is hosted
- do not assume Cloudflare alone makes `infinity/` or `profile.infinity` resolve natively in HNS-aware environments

Cloudflare may still be part of the architecture for:

- `pirate.sc/c/infinity`
- `infinity.pirate.sc`
- other gateway or mirror routes on an ordinary ICANN domain

## Minimum Public V0 Topology

The minimum practical public v0 topology is:

1. one small always-on VPS
2. PowerDNS Authoritative serving one or more HNS zones such as `infinity.`
3. Handshake root records delegating each HNS root to those nameservers
4. optional reverse proxy on the same VPS forwarding native HNS web traffic into Pirate's existing app stack

This topology should support many communities because one authoritative DNS service can host many HNS zones at once.

Examples:

- `infinity.`
- `artist.`
- `label.`
- `festival.`

The cost driver is not community count. The cost driver is whether Pirate also chooses to run heavy Handshake chain infrastructure on the same machine, which public v0 should avoid.

## Canonical Backing Model

Pirate needs one canonical source of truth for Pirate-managed HNS child zones.

Three different functions must agree:

1. delegation inspection
2. DNS serving
3. TXT verification

The recommended split is:

1. delegation inspection reads Handshake parent data such as `NS` and glue posture
2. authoritative DNS serves the delegated `<root>.` child zone
3. challenge publication writes `_pirate.<root>` into Pirate's child-zone backing store
4. `/verify-txt` reads from that same authoritative child-zone backing store, either directly or by
   querying the authoritative server that serves it

Important:

- after `NS` delegation, parent-side TXT state in ShakeStation is not the authoritative `_pirate.<root>` source
- `spaced` or other Handshake-parent inspection can prove delegation posture
- it cannot replace the child-zone authoritative data path for delegated TXT verification

Recommended public-v0 implementation:

1. PowerDNS Authoritative
2. writable backend
3. HNS verifier/provisioner creates zones and records through the PowerDNS API

Alternative implementations are possible, but the chosen path should preserve the same
single-source-of-truth property.

## Recommended Zone Layout

If Pirate is operating `infinity.`, the authoritative zone should typically contain:

- apex records for `infinity.`
- explicit records for product subdomains such as `profile.infinity.`
- optional wildcard records for app routing when Pirate wants `*.infinity`

This means `profile.infinity` is not a special Handshake feature. It is an ordinary subdomain in the delegated `infinity.` zone.

## Verification Order

For the public v0 TXT proof model, authoritative DNS setup must happen before TXT verification at `_pirate.<root>` can succeed.

Recommended order:

1. the owner chooses whether the root will stay owner-managed or delegate to Pirate-managed authoritative DNS
2. if Pirate-managed DNS is chosen, the owner publishes Handshake `NS` and any required glue records that point at Pirate nameservers
3. Pirate detects that delegation posture and provisions the `<root>.` child zone on its authoritative DNS service
4. Pirate publishes `_pirate.<root>` with the session-bound TXT challenge value in that child-zone backing store
5. the authoritative DNS service serves `_pirate.<root>` from the same backing store
6. Pirate verifies creator-bound control against the delegated authoritative zone
7. the owner may keep the root on Pirate-managed nameservers or later move elsewhere subject to later revalidation

Alternative owner-managed path:

1. the owner keeps authoritative DNS elsewhere
2. the owner serves `_pirate.<root>` on that already-working authoritative DNS
3. Pirate verifies creator-bound control there

Important:

- owner-managed authoritative DNS is sufficient for TXT proof
- owner-managed authoritative DNS is also sufficient for HNS-native routing such as `profile.infinity`
- Pirate-managed nameserver delegation is a separate operational choice and should not be required just to verify club attachment eligibility
- but if Pirate chooses a public-v0 implementation that only automates Pirate-managed DNS first, the product must say that plainly in UX instead of implying that parent-side ShakeStation edits alone will populate the delegated child zone

## Verification Implications

The HNS verification flow must stay conservative about what it claims.

Rules:

- TXT proof alone must not imply native web reachability
- `routing_enabled` should mean Pirate has observed that the root currently routes to Pirate infrastructure, not that ordinary browsers can reach it without HNS support
- `pirate_dns_authority_verified` should mean Pirate has authoritative namespace control sufficient for subordinate record lifecycle, not merely that a gateway route exists
- `pirate_web_routing_allowed` should be interpreted as a technical HNS-native routing capability, not as a guarantee of normie browser compatibility

The verification flow may inspect:

- whether the Handshake root delegates to Pirate-operated nameservers
- whether the delegated zone currently serves expected apex or wildcard web records
- whether the current routing posture supports Pirate-hosted root or subdomain traffic

## Product Routing Consequences

Pirate should continue to distinguish:

- HNS-native routes for users with HNS-aware resolution
- normie routes on ordinary web domains

Recommended public v0 posture:

- canonical user-safe route: `pirate.sc/c/infinity`
- optional HNS-native mirror: `infinity/`
- optional HNS-native subdomain route: `profile.infinity`

Pirate should not block community creation on the absence of normie browser compatibility for the HNS root, because normie access is already covered by the ordinary Pirate web route.

## Operational Recommendation

Public v0 should optimize for boring infrastructure.

Recommended sequence:

1. keep the main product on Cloudflare-hosted ordinary domains
2. buy one or two small VPS instances
3. run authoritative DNS there for all Pirate-managed HNS roots
4. publish Handshake root delegation records that point to those nameservers
5. add native HNS web proxying only where needed

This is the simplest deployment model that makes `infinity/` and `profile.infinity` genuinely resolvable in HNS-aware environments without requiring Pirate to run a large archival Handshake node.

## Public V0 Delivery Plan

To get HNS working end-to-end with the least ambiguity:

1. Ship one supported HNS path first: Pirate-managed authoritative DNS on a single VPS.
2. In the frontend, ask the user to update only the Handshake parent delegation records in ShakeStation:
   - `NS`
   - any needed glue records
3. After delegation is published, Pirate provisions the `<root>.` zone in PowerDNS.
4. Pirate serves `_pirate.<root>` from that delegated zone and verifies it through the HNS verifier.
5. Only after that path is stable should Pirate add the optional owner-managed authoritative-DNS variant.

This keeps the public-v0 message simple:

- HNS first
- one Pirate-operated VPS can host the authoritative DNS and verifier stack
- Spaces uses the same VPS later, but through a separate verifier path with no DNS delegation UX
