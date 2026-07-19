# Spaces Fabric read freshness and durability

Status: normative for the Pirate Spaces verifier.

## Read selection

Fabric responses are owner-signed, but signature validity does not prove freshness. A fast relay
may replay an older valid owner-signed zone. The reader therefore queries up to four relays within
a bounded deadline, verifies every response independently, and selects the highest record sequence
for each requested handle. An invalid response never competes by sequence.

Equal-sequence zones must have identical canonical bytes. A disagreement fails closed and allows
the separately reviewed, live-key-gated Pirate fallback to cover availability. Do not weaken this
to first-response or arbitrary tie selection: doing so restores stale-pinning behavior.

The deadline is a residual-risk dial, not proof of global freshness. A newer response arriving
after the deadline cannot win. If all queried relays expose the same stale zone because the latest
publication was lost everywhere, the stale state is indistinguishable from current state. Relay
reconciliation improves observed freshness; it does not provide durable storage.

## Verified empty state

A verified Fabric zone with no `web` or `freedom` record represents authoritative owner state.
The Pirate fallback must not fill either missing field. Fallback targets apply only when Fabric
state is unavailable or undetermined. This preserves an owner's deliberate target removal.

The selected sequence is part of the cached result. A direct later observation with a higher
sequence replaces a lower-sequence cached result. Lower or equal observations do not roll the
cache backward.

## Diagnostics

The publisher resolve output includes the selected `sequence` and bounded per-relay results:
relay identity, outcome class, observed sequence when verified, and latency. It does not emit
unverified payload contents. Operators use this data to distinguish transport failure, invalid
responses, verified empty state, and stale verified state.

Production must set `SPACES_FABRIC_SEEDS` explicitly. Each seed review records operator ownership
and network location. Multiple endpoints controlled by one operator or failure domain do not meet
the diversity objective.

### Production seed audit (2026-07-19)

| Seed | Administrative evidence | Network evidence | Current rationale |
| --- | --- | --- | --- |
| `relay-cosmos.spacesprotocol.org` | Same `spacesprotocol.org` administrative domain as Atlas; independent operator control is not attested | Cloudflare anycast A records `188.114.96.3`, `188.114.97.3` | Repeatedly served the complete sequence-1 production fixture |
| `relay-atlas.spacesprotocol.org` | Same `spacesprotocol.org` administrative domain as Cosmos; independent operator control is not attested | Same Cloudflare anycast A records `188.114.96.3`, `188.114.97.3` | Repeatedly served the complete sequence-1 production fixture |

Treat these as one administrative and network failure domain until independently demonstrated
otherwise. The explicit pair makes bootstrap auditable and ensured that current sequence-1 copies
were queried during the initial production reconciliation, but it does **not** satisfy the operator
or network diversity objective. Discovered peers add opportunistic reachability, not a reviewed
diversity guarantee. Do not add a seed merely to increase the count: first prove its operator,
network/ASN, stable HTTPS identity, protocol compatibility, and ability to retain current records.

## Measurement

After deployment, run at least twenty consecutive passes and require stable selected sequence and
targets for every available fixture. The initial pass covers a known complete zone, a changed-key
continuity rejection, an unknown handle, and a forced relay failure. A deliberately empty native
fixture is added only after the fresh-wallet publish E2E creates one; absence of that fixture does
not block the initial four-case measurement but must remain an explicit incomplete test.

## Durability boundary

Retention and rebroadcast precede operating a Pirate relay. Retain the exact signed publication
needed to restore current records, prove it can be rebroadcast without exporting signing material
to a server, and measure whether periodic rebroadcast provides sufficient availability. Only then
decide whether an operated relay and its encrypted backup/restore lifecycle are warranted.

Publisher `v0.1.5` implements this boundary. `publish` and `clear` accept
`--signed-message-out`, create the exact signed envelope exclusively with mode `0600` before
broadcast, and report its SHA-256. `rebroadcast --message-file` sends that public signed envelope
without a wallet export or secret key. The production batch workflow requires a signed-message
archive directory; if a session archive already exists after an interrupted run, it rebroadcasts
the retained envelope rather than signing a new sequence.

Historical publications made before this archive existed are not reconstructible from the control
plane alone: it retains record intent and verification challenges, not the exact signature. The
next fresh-wallet publish E2E must retain its envelope, copy only that envelope to the rebroadcast
host, prove wallet-free rebroadcast, and confirm the same selected sequence and targets afterward.
Only publications created with this retention path can support scheduled rebroadcast without
returning to the signing wallet.

Reconciliation cannot recover a publication that every relay has lost. Monitoring must therefore
cover selected sequence and expected record availability, not merely process health.
