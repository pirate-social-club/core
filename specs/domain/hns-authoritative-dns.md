# HNS Authoritative DNS

Status: current working spec

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
- support guarantees for clients that do not implement DNSSEC+DANE

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

If the owner sets `NS` for `kanye/` in their HNS root-management tool:

- Handshake stores the delegation for `kanye`
- HNS-aware resolvers follow that delegation to the named authoritative DNS service
- records inside the child zone, such as `_pirate.kanye.`, `kanye.`, or `profile.kanye.`, must then be served by that authoritative DNS service

Important:

- after `NS` delegation, `_pirate.<root>` TXT proof is no longer satisfied by a parent-side TXT value stored only in the Handshake root resource
- the delegated authoritative DNS host must actually serve the `<root>.` zone
- a static DNS server that only serves `infinity.` will not automatically answer for `kanye.` just because the Handshake parent resource now points `kanye/` at that server

This is the operational source of confusion behind "the user added NS and TXT in the HNS root resource but `_pirate.kanye` still does not resolve." The parent registry can publish delegation. It does not auto-host the delegated zone contents.

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
- a DS record in the Handshake parent that authenticates the signed child zone
- TLSA records and a gateway certificate whose key matches them for native HTTPS
- a synced, authenticated Handshake chain observer for root existence and
  expiry-horizon enforcement
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
- one always-on Handshake chain observer

Recommended production posture:

- two authoritative nameservers
- distinct hosts, and ideally distinct failure domains

Authoritative DNS software may be any conventional DNS server that can host the `infinity.` zone,
but the recommended choice for Pirate is:

- PowerDNS Authoritative

because it supports writable backends and an HTTP API that match Pirate's provisioning model.

Pirate may also run an HTTP reverse proxy on the same host if native HNS web traffic should be forwarded into the existing Pirate app stack.

The initial chain observer is a keyless `hsd` node on mainnet with its wallet
plugin disabled. Its RPC API must be authenticated and bound to localhost or an
equivalently private service network. The verifier uses `getnameinfo`,
`getblockchaininfo`, and `getblockheader` and rejects stale, early-sync,
wrong-network, inconsistent-anchor, or malformed responses. This node is on the
security path for namespace attachment and revalidation even though it has no
serving-DNS or wallet role.

One VPS may host multiple roles if that is the cheapest operational path:

- authoritative DNS for delegated HNS zones
- the Pirate reverse proxy for native HNS web routes
- the verification API and verifier workers
- keyless `hsd` chain observation
- the separate Spaces verifier runtime

That consolidation is acceptable for public v0 as long as the logical responsibilities stay separate:

- authoritative DNS serves delegated HNS child zones
- the HNS verifier reads those zones
- the Spaces verifier performs proof and signature checks unrelated to DNS

## What Pirate Does Not Need To Run

Pirate does not need an archival or wallet-bearing Handshake node to serve the
`infinity.` zone. It does now need a synced chain node for expiry enforcement.

Important:

- authoritative DNS for `infinity.` is cheap and lightweight
- archival indexes and a Handshake wallet are not required for the observer
- a recursive HNS resolver such as `hnsd` is optional and solves a different problem

Operationally:

- authoritative DNS answers questions about the `infinity.` zone
- recursive HNS resolvers help users look up Handshake names
- Handshake chain observation is required to accept and revalidate namespaces;
  wallet-bearing chain infrastructure is needed only to publish or update
  Pirate-controlled root records

Recommended v0 posture:

- run a keyless `hsd` observer, preferably isolated from the public DNS and web
  listeners even when it shares the same VPS
- disable the wallet plugin and expose authenticated RPC only to the verifier
- if Pirate self-hosts Handshake write operations, keep the wallet and signing
  material separate from the observer and public edge
- Pirate may instead rely on an external registrar or operational provider for publishing Handshake root updates

An alternate node implementation may run alongside `hsd` as a read-only shadow
observer. Bind its RPC to localhost, store no keys, and diff the exact
`getnameinfo`/`getnameresource`/`getblockchaininfo`/`getblockheader` evidence consumed by the verifier for an
extended period before considering promotion. Shadow disagreement must never
grant capability; `hsd` remains authoritative until the alternate observer has
earned replacement status through production evidence.

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
3. a keyless, synced, authenticated `hsd` observer on mainnet
4. Handshake root records delegating each HNS root to those nameservers
5. optional reverse proxy on the same VPS forwarding native HNS web traffic into Pirate's existing app stack

This topology should support many communities because one authoritative DNS service can host many HNS zones at once.

Examples:

- `infinity.`
- `artist.`
- `label.`
- `festival.`

The cost driver is not community count. The chain observer adds persistent disk,
initial-sync time, and monitoring requirements; it should be capacity-planned
independently from the lightweight authoritative DNS workload.

## Canonical Backing Model

Pirate needs one canonical source of truth for Pirate-managed HNS child zones.

Three different functions must agree:

1. delegation inspection
2. DNS serving
3. TXT verification

The recommended split is:

1. delegation inspection reads Handshake parent data such as `NS` and glue posture
2. authoritative DNS serves the delegated `<root>.` child zone
3. health publication writes `_pirate.<root>` into Pirate's child zone through the
   PowerDNS API
4. the authority-health check reads that record back through the serving path

Important:

- after `NS` delegation, parent-side TXT state in the Handshake root resource is not the authoritative `_pirate.<root>` source
- `spaced` or other Handshake-parent inspection can prove delegation posture
- reading `_pirate.<root>` back from Pirate's own child zone proves serving
  health only — ownership proof always comes from records the owner published
  (parent-chain TXT, or the owner's own authoritative DNS), per the
  Verification Assertions section

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

## Native HTTPS and DANE

Native HNS HTTPS is a DNSSEC+DANE capability, not an ICANN Web-PKI capability.
Pirate must not claim universal browser support. The supported client matrix is
the set of HNS clients that validate the Handshake DS, child-zone DNSSEC, and
RFC 6698/RFC 7671 TLSA records.

The canonical public gateway uses DANE-EE with selector SPKI and SHA-256:

```text
TLSA 3 1 1 <sha256(subjectPublicKeyInfo)>
```

The catchall gateway deliberately serves one explicitly managed certificate
and key for all HNS SNI values. With DANE-EE, RFC 7671 binds the server identity
through the DNSSEC-authenticated TLSA association and does not require a SAN
match or certificate validity interval for authentication. This avoids a race
between dynamic host authorization, per-host certificate issuance, and TLSA
publication.

Caddy's `tls internal { on_demand }` mode is not the canonical DANE mode. Caddy
uses a distinct key for each hostname by default, so one wildcard TLSA digest
cannot authenticate all of those leaves. That mode is valid only for clients
that separately trust Caddy's private CA.

TLSA owner placement must preserve DNS wildcard semantics:

- apex HTTPS: `_443._tcp.<zone>.`
- wildcard-only web names: TLSA at `*.<zone>.`, which synthesizes the TLSA
  answer when no closer explicit node exists
- explicit web nodes: `_443._tcp.<host>.<zone>.`

Do not pre-create `_443._tcp.app.<zone>` merely because `app` may exist later.
That owner creates `app.<zone>` as an empty non-terminal and can stop wildcard A
synthesis for `app.<zone>`. Explicit TLSA owners are generated only from
existing concrete web-address records.

Certificate-key rollover is two-phase and stateful:

1. publish old and new `3 1 1` associations together in one API PATCH per zone
2. rectify DNSSEC and notify the secondary
3. wait at least two TLSA TTLs and re-read every selected zone; never shorten
   the old TTL as part of the same rotation
4. atomically switch one symlink to a complete, versioned certificate/key pair
   and reload the gateway
5. while new-zone provisioning still publishes old+new, probe the real gateway
   IP with SNI and prove the served leaf SPKI is the new association
6. change new-zone provisioning to new-only, repeat the live proof, and only
   then remove the old association

The verifier's new-zone template must carry the same association set throughout
each phase: old+new before prepare and during the waiting window, then new-only
before retirement. The rollout tool rejects mismatched configuration so a zone
created concurrently cannot omit the new key or resurrect the old one later.
The saved prepared-zone set cannot be narrowed at readiness or retirement, and
any concurrent managed-owner, association, or TTL drift fails closed. Operator
commands authenticate to the running verifier and compare its active set and
TTL; reading a duplicate variable from the operator shell is not sufficient.

Initial bring-up follows the same ordering without inventing an old key:
publish the initial association, wait two TTLs, activate the static gateway
certificate, prove it over TLS, and finalize the rollout state.

TLSA publication must fail closed for unsigned zones. PowerDNS backend DNSSEC
support alone is insufficient: the zone needs active signing keys, and the
matching DS must be published in the Handshake parent before external clients
can authenticate the chain. Existing unsigned or recovered zones must never be
silently assigned new keys, because that can invalidate a still-published DS.

## Verification Assertions

Verification is three independent assertions. They must never be conflated, and
the third must never be treated as the first.

### 1. Root ownership (creator-bound)

Proof that the requesting user controls the root. It must come from a record
only the root owner can publish — never from a record Pirate published itself.

- Pirate-managed path: the owner publishes the session-bound nonce as a TXT
  value in the Handshake parent root resource. This is on-chain ownership
  evidence, observed from the parent chain. It must not be described to users
  or recorded in evidence as DNS `_pirate.<root>` proof — after delegation the
  parent resource is not the `_pirate.<root>` data path.
- Owner-managed path: the owner publishes the session-bound nonce at
  `_pirate.<root>` through their own, already-working authoritative DNS,
  observed through independent resolvers.

Anti-circularity rule: Pirate must never accept a TXT value served from
Pirate's own authoritative backend as ownership proof. Pirate publishing
`_pirate.<root>` and then reading it back proves only that Pirate can write to
its own database.

### 2. Delegation

Independent observation of the Handshake parent record set: `NS` (and glue,
and `DS` when published) pointing at Pirate-operated nameservers. Observed
from parent-chain data, not from Pirate's own zones.

A single root-resource update by the owner may carry both the session TXT
(assertion 1, Pirate-managed path) and the delegation records (assertion 2).

### 3. Operational authority health

Only after ownership and delegation both pass, Pirate provisions the `<root>.`
child zone on its authoritative DNS, publishes `_pirate.<root>` there, and
queries it back through the serving path. This confirms the authority actually
serves the delegated zone. It is recorded as health evidence
(`authority_health_verified`), never as ownership proof.

## Verification Order

Pirate-managed path:

1. the owner starts a session and receives a session-bound nonce
2. the owner updates the Handshake parent root resource: the session TXT value
   plus `NS`/glue delegation records pointing at Pirate nameservers (one update
   may carry both)
3. Pirate independently observes the parent resource: ownership (assertion 1)
   and delegation (assertion 2)
4. both pass → Pirate provisions the `<root>.` child zone and publishes
   `_pirate.<root>` in it
5. Pirate queries `_pirate.<root>` through the authoritative serving path and
   records the result as authority health (assertion 3)
6. the session is accepted on assertions 1+2; assertion 3 gates routing
   claims, not acceptance

Owner-managed path:

1. the owner starts a session and receives a session-bound nonce
2. the owner publishes `_pirate.<root>` on their own authoritative DNS
3. Pirate observes it through independent resolvers (assertion 1) and observes
   the parent record set for routing posture (assertion 2 evidence, informational
   unless the owner also wants Pirate-managed routing)
4. the session is accepted on assertion 1; no child zone is provisioned

Important:

- owner-managed authoritative DNS is sufficient for ownership proof and for
  HNS-native routing such as `profile.infinity`
- Pirate-managed nameserver delegation is a separate operational choice and
  should not be required just to verify club attachment eligibility
- but if Pirate chooses a public-v0 implementation that only automates
  Pirate-managed DNS first, the product must say that plainly in UX instead of
  implying that parent-side HNS root-resource edits alone will populate the
  delegated child zone

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

This is the simplest deployment model that makes `infinity/` and `profile.infinity` genuinely resolvable in HNS-aware environments while keeping the required Handshake observer keyless and non-archival.

## Public V0 Delivery Plan

To get HNS working end-to-end with the least ambiguity:

1. Ship one supported HNS path first: Pirate-managed authoritative DNS plus a
   keyless `hsd` observer on the VPS/private service network.
2. In the frontend, ask the user to update only the Handshake parent delegation records in their HNS root-management tool:
   - `NS`
   - any needed glue records
3. After delegation is published, Pirate provisions the `<root>.` zone in PowerDNS.
4. Pirate serves `_pirate.<root>` from that delegated zone and verifies it through the HNS verifier.
5. Only after that path is stable should Pirate add the optional owner-managed authoritative-DNS variant.

This keeps the public-v0 message simple:

- HNS first
- one Pirate-operated VPS can host the authoritative DNS and verifier stack
- Spaces uses the same VPS later, but through a separate verifier path with no DNS delegation UX
