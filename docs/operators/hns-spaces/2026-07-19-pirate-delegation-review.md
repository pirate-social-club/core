# `.pirate` delegation review packet

Status: **STAGED ONLY — DO NOT SIGN OR BROADCAST**

Prepared 2026-07-19. The observer was at height 171,862 (50.59%) when this
packet was assembled, so observer-backed HNS assertions and the 24-hour soak
have not started.

## Owner decision

This ceremony atomically replaces the complete Handshake resource for
`.pirate`. It is not an additive NS edit. The current AWS glue is intentionally
removed, and no prior DS is retained.

Current committed resource, read from the observer:

```json
{
  "records": [
    { "type": "GLUE4", "ns": "ns1.pirate.", "address": "44.231.6.183" },
    { "type": "NS", "ns": "ns1.pirate." }
  ]
}
```

Proposed complete replacement:

```json
{
  "records": [
    { "type": "NS", "ns": "ns1.pirate." },
    { "type": "NS", "ns": "ns2.pirate." },
    { "type": "GLUE4", "ns": "ns1.pirate.", "address": "94.103.168.161" },
    { "type": "GLUE4", "ns": "ns2.pirate.", "address": "81.15.150.159" },
    {
      "type": "DS",
      "keyTag": 34383,
      "algorithm": 13,
      "digestType": 2,
      "digest": "2c16acbc6081a8eeca4582ff967ebba29f30e2df5abd845dd2d1992449ebeecd"
    }
  ]
}
```

There is no GLUE6. Neither authority has a globally routed IPv6 address and
PowerDNS is currently served over IPv4 only. Publishing unreachable GLUE6
would reduce reliability rather than add resilience.

## Child-zone evidence

PowerDNS serves signed zone serial `2026071906` from both authorities:

- `ns1.pirate.` — `94.103.168.161`
- `ns2.pirate.` — `81.15.150.159`
- TTL 300 during cutover
- apex, `app`, `api`, `profile`, and wildcard A — `94.103.168.161`
- `_pirate.pirate.` TXT — `pirate-health=v1`
- apex, app, api, profile, and wildcard TLSA —
  `3 1 1 5c8ddd3dbf63dbab698c726708b06177adda4a21416c675197f97e3b27ab20d8`

The primary and TSIG secondary returned identical SOA, DNSKEY, A, TXT, TLSA,
and RRSIG answers over UDP and TCP. Signed NSEC denial for a nonexistent name
validated from both. A fresh backup containing the real DNSSEC zone completed;
its SQLite database and retained DNSSEC key/metadata were restored and checked
in the pinned PowerDNS image.

The online signing and replication path was exercised with a temporary TXT
RRset. Both authorities served its algorithm-13 RRSIG at serial `2026071905`.
The RRset was then removed, caches purged, the zone rectified and notified, and
both authorities converged at cleanup serial `2026071906` with the probe absent.

The SHA-256 DS was computed independently from the served DNSKEY and exactly
matches PowerDNS output:

```text
34383 13 2 2c16acbc6081a8eeca4582ff967ebba29f30e2df5abd845dd2d1992449ebeecd
```

An hourly serving-path monitor checks signatures through both authority IPs,
including every TLSA owner and wildcard synthesis. It alerts below seven days
of remaining RRSIG lifetime. Its success and authenticated failure/alert paths
were both exercised before DS publication.

## Edge evidence

The HNS gateway and Caddy DANE edge are staged on ns1:

- gateway: `127.0.0.1:4049`
- on-demand authorization: `127.0.0.1:4050` only
- `app.pirate` and `api.pirate` route before wildcard profile routing
- `pirate.` returns a permanent redirect to `https://app.pirate`, preserving
  path and query
- the public verifier keeps its Let's Encrypt certificate
- HNS SNI receives the managed DANE certificate whose SPKI is the TLSA digest
  above
- the forwarder token was rotated and the Worker trusts only
  `94.103.168.161`

Privy has already accepted `app.pirate` as an interactive origin. Both glue
IPv4 addresses are confirmed persistent.

## Remaining gates before the owner signs

1. Observer reaches chain tip and verifier assertions are activated.
2. The signed zone, AXFR, backup, RRSIG monitor, gateway, and verifier remain
   continuously healthy for at least 24 hours after that activation.
3. Validate UDP and TCP 53 and the DNSSEC answers from an additional external
   vantage, not the operator workstation.
4. Re-read the current parent resource, served DNSKEY/DS, authority IPs, zone
   serial, and DANE SPKI immediately before transaction creation. Any mismatch
   invalidates this packet.
5. Create the UPDATE locally with `sign: false` and `broadcast: false`; record
   its inputs, outputs, fee, covenant resource, and raw hex in an appendix for
   owner review. Never copy a seed, private key, wallet token, or passphrase
   into this repository or onto ns1/ns2.

The 24-hour soak passes only if RRSIG and DANE SPKI/TLSA monitors remain green,
all deployment roles report no drift, a full backup/restore cycle covers the
real DNSSEC zone, a deliberate serial change converges through AXFR, the served
SPKI still matches every TLSA owner, and gateway/redirect samples remain healthy
throughout the window.

The unsigned wallet API request body is:

```json
{
  "name": "pirate",
  "data": {
    "records": [
      { "type": "NS", "ns": "ns1.pirate." },
      { "type": "NS", "ns": "ns2.pirate." },
      { "type": "GLUE4", "ns": "ns1.pirate.", "address": "94.103.168.161" },
      { "type": "GLUE4", "ns": "ns2.pirate.", "address": "81.15.150.159" },
      { "type": "DS", "keyTag": 34383, "algorithm": 13, "digestType": 2,
        "digest": "2c16acbc6081a8eeca4582ff967ebba29f30e2df5abd845dd2d1992449ebeecd" }
    ]
  },
  "sign": false,
  "broadcast": false
}
```

Submit that body only to the local wallet's
`POST /wallet/<wallet-id>/update` endpoint after the gates pass. Transaction
creation selects the name coin and fee inputs, so its exact hex cannot be
reviewed until it is created against the controlling local wallet.

## Ceremony and no-action window

After the owner verifies the final decoded transaction, signing and broadcast
are separate explicit steps. Record the txid and one canonical broadcast; do
not retry merely because DNS still returns the old resource.

Mainnet `treeInterval` is 36 blocks, approximately six hours at ten minutes per
block. A confirmed UPDATE does not become visible in the committed name tree
until the next tree interval. During that pre-declared no-action window:

- old records continuing to resolve is expected;
- do not rebroadcast or compose a second UPDATE;
- do not begin delegation validation until the committed tree includes the
  new resource.

After tree commitment, validate independently:

```text
parent DS -> child DNSKEY -> RRSIG -> TLSA -> served certificate SPKI
```

Exercise apex, app, api, profile, wildcard synthesis, and negative proofs, then
prove `app.pirate -> gateway -> Worker -> SSR` end to end. Merge web PR #220
last and only after that proof. Enable namespace revalidation only after the
observer is healthy.

## Named post-ceremony follow-up

Confirm whether the controlling wallet is the separate Bob wallet or ever
touched the hsd instance whose debug logs leaked on 2026-07-17. Secure-delete
those logs regardless. If there is any entanglement, transfer `.pirate` to a
freshly generated wallet in a later, separate ceremony. This is recorded as
defense in depth, not a blocker for this delegation.
