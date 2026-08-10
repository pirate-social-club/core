# HNS Verifier Service

This service hosts Pirate's PowerDNS-backed HNS verifier and zone-provisioning runtime.

## Responsibilities

- inspect Handshake parent state without treating Pirate's own zones as ownership evidence
- verify owner-managed HNS TXT challenges from owner-published evidence
- derive the expiry horizon from authenticated hsd name state anchored to an observed chain tip
- create the `<root>.` zone in PowerDNS when Pirate-managed delegation is observed
- publish `_pirate.<root>` TXT records for delegated Pirate-managed verification sessions
- create DNSSEC keys for new zones only when explicitly enabled and return the DS records needed in Handshake
- publish configured DANE-EE TLSA associations only into DNSSEC-signed zones
- verify post-provision authority health against the serving path without reusing it as ownership proof

## Platform-managed roots

Pirate operates platform-managed roots that should be bootstrapped via `/ensure-zone` rather than
waiting for external Handshake delegation. These roots receive wildcard web-routing records and
use the HNS public gateway for HTTP resolution.

Current platform-managed roots:

- `pirate` — human public profiles
- `clawitzer` — agent public identities

## Endpoints

- `GET /health`
- `GET /inspect?root_label=<root>`
- `GET /observe-root-parent?root_label=<root>`
- `GET /observe-root-authority?root_label=<root>`
- `POST /ensure-zone`
- `POST /publish-txt`
- `POST /verify-txt`

## Environment

- `HNS_VERIFIER_HOST`
- `HNS_VERIFIER_PORT`
- `HNS_VERIFIER_AUTH_TOKEN`
- `HNS_VERIFIER_OBSERVER_AUTH_TOKEN`
- `HNS_CHAIN_RPC_URL`
- `HNS_CHAIN_RPC_API_KEY`
- `HNS_CHAIN_RPC_TIMEOUT_MS`
- `HNS_CHAIN_NETWORK`
- `HNS_CHAIN_MAX_TIP_AGE_SECONDS`
- `HNS_EXPIRY_HORIZON_BLOCKS`
- `HNS_VALIDATING_RESOLVER_ADDRESS`
- `HNS_VALIDATING_RESOLVER_PORT`
- `HNS_AUTHORITY_OBSERVATION_TIMEOUT_MS`
- `PDNS_API_URL`
- `PDNS_API_KEY`
- `PDNS_DEFAULT_SOA_CONTENT`
- `PDNS_SECURE_NEW_ZONES`
- `HNS_AUTHORITY_HEALTH_RESOLVERS`
- `HNS_AUTHORITATIVE_NAMESERVERS`
- `HNS_AUTHORITATIVE_TTL`
- `HNS_AUTHORITATIVE_NAMESERVER_IPV4`
- `HNS_AUTHORITATIVE_APEX_IPV4`
- `HNS_AUTHORITATIVE_PROFILE_IPV4`
- `HNS_AUTHORITATIVE_WILDCARD_IPV4`
- `HNS_AUTHORITATIVE_TLSA_ASSOCIATIONS`
- `HNS_AUTHORITATIVE_TLSA_TTL`

`HNS_VERIFIER_AUTH_TOKEN` authorizes every verifier route, including
PowerDNS-mutating operations. `HNS_VERIFIER_OBSERVER_AUTH_TOKEN` is optional
and authorizes only `GET /observe-root-parent` and
`GET /observe-root-authority`. The service refuses to start if the observer
token is configured without a primary token or if both values are identical.

`PDNS_SECURE_NEW_ZONES=true` asks PowerDNS to generate signing keys as part of
new-zone creation. It never signs an existing unsigned zone. `/ensure-zone` and
`/publish-txt` return `dnssec` and `ds_records`; the matching DS still must be
published in the Handshake parent before the child zone is externally secure.

`HNS_AUTHORITATIVE_TLSA_ASSOCIATIONS` is a comma-separated overlap set of
strict `3 1 1 <SPKI-SHA256>` records managed by the DANE rollout tool. If it is
non-empty, an unsigned zone fails closed instead of receiving unauthenticated
TLSA data.

`HNS_AUTHORITATIVE_TLSA_TTL` must match the rollover operator. Readiness fails
if any managed TLSA TTL drifts, and `prepare` refuses to shorten a previously
published TTL because resolvers may still cache the old association for that
longer interval.

Authenticated `/health` responses expose the active association set, TLSA TTL,
and new-zone DNSSEC flag. These values are not secrets; the operator CLI uses
them to prove the running verifier—not merely its own shell—has converged before
each lifecycle phase.

`HNS_CHAIN_RPC_URL` points at an hsd JSON-RPC endpoint. The verifier calls `getnameinfo`,
`getnameresource`, `getblockchaininfo`, and `getblockheader` for the reported best-block hash.
`getnameresource` supplies the live parent resource used for owner-managed apex TXT proof and NS
delegation checks; no third-party explorer is in the ownership path. The verifier computes remaining
lifetime from `stats.renewalPeriodEnd - blocks`, anchors freshness to the best block's own timestamp
rather than lagging median time, and records the expiry height, anchor height/hash/median
time/network, remaining blocks, configured horizon, and provider. Set
`HNS_EXPIRY_HORIZON_BLOCKS` explicitly to the product's minimum safe remaining lifetime and
`HNS_CHAIN_MAX_TIP_AGE_SECONDS` to the maximum acceptable best-block age. The node must report at
least `0.999` verification progress, be caught up to its headers, and report `HNS_CHAIN_NETWORK`
(default `main`). If required configuration or evidence is absent, invalid, unavailable, stale, or malformed,
`expiry_horizon_sufficient` is `null` and all expiry-gated capabilities remain withheld. Root or
resource existence is never expiry evidence.

The observer also emits `expiry_root_exists`. A valid synchronized chain tip
plus an empty, expired, revoked, or unregistered auction/closed `getnameinfo` result yields
`false`. A claimed `LOCKED` state, an unrecognized state, or malformed/unavailable chain evidence
yields `null` rather than being misreported as deletion. Revalidation can
therefore distinguish a missing root from unavailable observer evidence
without promoting either condition to positive evidence.

`/observe-root-parent` is the fail-closed parent-evidence endpoint for the root
delegation observer. It returns NS, glue, and DS from authenticated local `hsd`
only when the same request establishes a fresh, synchronized mainnet chain
anchor. It never falls back to an explorer or recursive resolver.
Authoritative DNSKEY, RRSIG, and per-authority SOA evidence is collected
separately and must not be inferred from this response.

`/observe-root-authority` supplies that independent serving-path evidence. It
uses the parent DS returned by local `hsd` as a per-root static trust anchor for
BIND `delv`, pointed at the local HNS recursive resolver. `delv` performs
validation itself; a successful response from the DoH/HNS resolver is not
treated as proof because that service intentionally leaves validation to its
clients. The endpoint validates DNSKEY, SOA, and every managed A/TLSA RRset,
records each relevant RRSIG expiry, and queries every parent-advertised
authority address directly with `dig` for SOA reachability and serial parity.
The PowerDNS API is used only to enumerate the product's required RRsets, never
as security evidence.

The production host must provide BIND `delv` and `dig` at `/usr/bin/delv` and
`/usr/bin/dig`. The default resolver target is the loopback hnsd listener at
`127.0.0.1:5350`.

For the platform-owned `pirate.` root, prefer an HNS-native nameserver:

- child zone NS: `ns1.pirate.`
- child zone A: `ns1.pirate. -> <authoritative-dns-ip>`
- parent Handshake resource: `GLUE4 ns1.pirate. <authoritative-dns-ip>`

Do not rely on `ns1.pirate.sc.` for censorship-resistant resolution; that makes the Handshake
parent delegation depend on ICANN DNS.

## Local Usage

Run the service from the repo root:

```bash
rtk bun services/verifier/hns/src/server.ts
```

## Legacy app-record audit

Before enabling sovereign thread origins, audit zones created before explicit
`app.<zone>` management. This is read-only and exits nonzero when an app A or
matching TLSA record is absent or differs from the managed wildcard/apex set:

```bash
rtk bun run --cwd services/verifier/hns audit:app-records
rtk bun run --cwd services/verifier/hns audit:app-records -- --zones pirate,example
```

Supply `PDNS_API_URL`, `PDNS_API_KEY`, and optionally `PDNS_SERVER_ID`. Repair
reported zones through the normal `/ensure-zone` reconciliation path so app A
and TLSA are applied together; do not add the TLSA owner by itself.
