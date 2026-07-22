# HNS DS Delegation Lifecycle

Status: proposed working spec

Related docs:

- [hns-authoritative-dns.md](./hns-authoritative-dns.md)
- [hns-verification-flow.md](./hns-verification-flow.md)
- [namespace.md](./namespace.md)
- [namespace-root-control.md](./namespace-root-control.md)

## Purpose

This doc defines the lifecycle that takes an HNS root from *proven ownership* to
*authenticated resolution*, and the invariants that keep it authenticated over
time.

It exists because the managed onboarding path stops one step short. A creator
can verify a root, have Pirate provision a signed child zone with DANE TLSA
records, attach it to a community, and see a working public route — while the
Handshake parent still carries no DS. The delegation is therefore insecure, the
TLSA association is unauthenticated, and a correctly fail-closed DANE client
should refuse it.

Nothing in the product surfaces this. There is no DS state, no assertion
representing parent DS publication, and no UI step asking the owner to publish
one. The verifier returns `ds_records` on every `/publish-txt` and
`/ensure-zone`; the API's response type omits the field, so application logic
cannot reach it. The values survive only as opaque JSON inside
`namespace_verification_evidence_bundles.raw_response_json`.

Manually configured roots such as `.pirate` may already carry a valid DS. What
the product cannot currently do is *establish* that state through onboarding,
*represent* it, or *notice* when it stops being true.

## Scope

This doc covers:

- the two orthogonal state dimensions a root carries: present delegation
  security, and rollover progress
- what authenticated resolution requires, beyond anchoring a key
- the structured state the system must persist, and at what scope
- how the parent DS is observed, and how often
- key rollover ordering and timing when the parent is on-chain and owner-gated
- what attachment and routing are allowed to do in each state

This doc does not cover:

- the quarantined pre-provisioning design intended to collapse the owner's two
  Handshake writes into one. That design is specified *against* the invariants
  established here rather than alongside them. See
  [Quarantine Invariants](#quarantine-invariants).
- Spaces-family verification. The assertions named here are HNS-only.

## Core Distinction

Three separate claims are currently collapsed into one "verified" state:

| Claim | Means |
|---|---|
| ownership proven | the owner controls the Handshake root and published the session TXT |
| zone provisioned | Pirate serves a signed child zone for the root |
| secure delegation | the Handshake parent anchors that zone's live key, and the zone validates |

Only the third makes the chain of trust complete. Without it, DNSSEC validation
terminates at the parent with an insecure delegation, and every downstream
guarantee — signed answers, DANE TLSA, certificate binding — is unauthenticated.

## State Model

Delegation security and rollover progress are **orthogonal**. A single enum
cannot represent them: a planned rollover is a root that is *currently secure*
while *a key change is in flight*, and collapsing those into one value forces
the system to choose between reporting it as secure (losing the rollover) or as
requiring action (falsely withdrawing authenticated routing from a root whose
old key still validates).

### `delegation_security`

The present, observed authentication status of the root.

| Value | Means |
|---|---|
| `unknown` | never observed, or the parent could not be read. Not a claim about the root. |
| `unsecured` | observed; no matching parent DS. Includes the pre-publication case. |
| `pending` | a DS is believed submitted but not yet confirmed in the parent. |
| `secure` | the parent anchors a live key **and** the zone validates. See [Authenticated Resolution](#authenticated-resolution). |
| `bogus` | a trust anchor exists and matches, but authoritative zone validation fails. |
| `drifted` | previously `secure`; the parent no longer anchors any live key. |

`bogus` is distinct from both neighbours and cannot be folded into either.
`unsecured` and `drifted` describe the *anchor* — no DS, or a DS that no longer
matches. `bogus` describes a root whose DS still matches perfectly while the
zone itself fails to validate: expired RRSIGs, an unsigned TLSA RRset, a key
that signs nothing. The owner-facing remedy is entirely different, and so is the
responsible party — `bogus` is almost always Pirate's fault, not the owner's.

`unknown` is not a synonym for `unsecured`. Asserting `unsecured` claims we
looked and found no anchor; `unknown` admits we have not established anything.
Collapsing them would let an observer outage read as a security finding.

### Observation freshness

`delegation_security` records the *last evaluated* status. It says nothing about
how old that evaluation is, and a stale `secure` is not evidence of present
security — an observer that stopped updating would otherwise let a root remain
authoritatively "secure" indefinitely.

Freshness is therefore a **separate mandatory predicate**, not another enum
value:

```
observation_fresh := now - last_parent_observation_at <= max_observation_age
```

Authenticated routing requires `delegation_security = secure` **and**
`observation_fresh`. A root that is `secure` but not fresh is not downgraded to
another security value — the last finding stands as a finding — but it must not
be advertised as authenticated until re-observed.

This is deliberately a predicate rather than a `stale` enum value: staleness is
a property of our *knowledge*, not of the *root*, and the two must not share a
field for exactly the reason `delegation_security` and `rollover_state` must
not.

### `rollover_state`

Progress of a key change, independent of present security.

| Value | Means |
|---|---|
| `none` | no rollover in flight |
| `required` | the key must change; nothing published yet |
| `new_key_prepublished` | new DNSKEY published alongside the old |
| `new_ds_pending` | owner asked to add the new DS; not yet observed |
| `overlap` | both DS anchored; both keys live; waiting out caches |
| `old_ds_removal_pending` | owner asked to remove the old DS; not yet observed |

### Interaction rule

**Authenticated routing is permitted whenever `delegation_security = secure`,
including throughout a rollover.** A rollover that is proceeding correctly never
reduces present security; that is the entire point of the overlap discipline. A
rollover that *fails* shows up as `delegation_security` moving to `drifted`,
which is handled on its own terms.

`rollover_state` drives what the product *asks the owner to do*.
`delegation_security` drives what the product *claims about the name*. They must
never be read from the same field.

## Authenticated Resolution

`delegation_security = secure` requires more than a DS that matches a DNSKEY.
Matching anchors a key; it does not establish that the zone is operationally
valid. A zone can present a perfectly matching DS while serving expired
signatures, an unsigned RRset, or a key that signs nothing.

Slice 1 must establish **all** of:

1. **Anchor** — at least one parent DS matches a currently published DNSKEY by
   key tag, algorithm, and digest recomputed over the canonical owner name plus
   the DNSKEY RDATA, using that DS record's own `digest_type`.
2. **Self-signature** — the DNSKEY RRset carries a valid RRSIG produced by a key
   in that RRset.
3. **Chain participation** — the DS-matched key actually participates in that
   chain, rather than merely being present in the RRset.
4. **Payload validation** — the RRsets the product depends on validate: SOA, the
   apex and wildcard A records, and the TLSA associations backing DANE.
5. **Temporal validity** — every relevant RRSIG is currently within its
   inception and expiration window, and not within an unsafe margin of expiry.

A root satisfying 1 but failing any of 2–5 is `bogus`, not `unsecured` and not
`drifted`: the anchor is intact and the zone is broken. Reporting it as `secure`
would claim authenticated resolution for a zone a validating resolver will
reject; reporting it as `unsecured` would send the owner to fix a DS that is
already correct.

Matching rules:

- a root is anchored if **at least one** published DS matches. A resolver needs
  only one digest type it supports.
- a DS whose digest type the system cannot compute is `unverifiable` — never
  matching, and not on its own a reason to withhold security.
- a DS referencing an unknown key tag is `orphaned`. Orphaned records indicate
  drift **only** when no DS matches.
- **an orphaned DS during `overlap` or `old_ds_removal_pending` is an invariant
  violation, not an expected condition.** Both keys are published until step 8,
  so both DS records must still match. An orphaned old DS during those stages
  means the old DNSKEY was retired early, which is precisely the failure the
  ordering exists to prevent. It must raise an alarm rather than being tolerated
  as rollover noise.
- security is a property of the *observed parent and served zone*, never of what
  Pirate intended to publish. It must not be inferred from having shown the
  owner the records.

Pirate's managed zones use a KSK with flags `257`. That is **Pirate's managed-key
policy**, not a universal DNSSEC requirement — DNSSEC permits other valid
configurations, and this spec constrains only roots Pirate provisions.

### Digest policy

- **SHA-256 (`digest_type` 2) is required** for managed onboarding. It is the
  modern mandatory-to-implement digest and Pirate's managed baseline; a root
  anchored only by a type a given resolver cannot compute is, to that resolver,
  effectively unanchored.
- **SHA-384 (`digest_type` 4) is additionally recommended** and published
  alongside, while resolver compatibility remains uneven.

## Persisted State

DS state must be structured and queryable. The current situation — values
reachable only by parsing an audit blob — is what made this defect invisible.

### Scope: root-scoped

**The DS lifecycle belongs to the canonical root record.** A root has one
authoritative zone and one keyset; PowerDNS serves one DNSKEY set per zone.
Verifications and community bindings *reference* that root record — they do not
own its keyset, and a root attached as a mirror to a second community does not
acquire a second lifecycle.

This resolves the multi-community question directly: there is nothing to
arbitrate, because per-community DS state never exists.

### Fields

Per root:

- `zone_dnskeys` — key tag, algorithm, flags, and public key for each published
  DNSKEY, with the active KSK marked
- `expected_ds` — a **versioned materialized snapshot** of the DS set derived
  from a specific live DNSKEY set, carrying the key tag and derivation timestamp
  it was computed from. It is valid only while that keyset is live. It is not an
  indefinitely reusable cache, and a snapshot whose keyset is no longer published
  is stale by definition and must be re-derived, never served to a user.
- `observed_ds` — the DS set most recently read from the Handshake parent, each
  annotated `matching` / `orphaned` / `unverifiable`
- `pending_ds` — DS for a key being rolled to, not yet expected to be
  authoritative
- `delegation_security` and `rollover_state`
- `last_parent_observation_at`, plus the observation provider
- `state_changed_at`, so drift duration is measurable

### Issuance history

Current and pending keys are not sufficient. Persist a retained, append-only
provenance record:

- `issued_keysets` — every keyset Pirate has ever provisioned for the root, with
  key tags, algorithms and public keys
- `issued_ds` — every DS value Pirate has ever derived and asked an owner to
  publish, linked to the keyset it came from
- `activated_at` and `retired_at` per keyset

Retain this history until **no parent DS corresponds to any entry in it**.

Without it, the retention rule is unevaluable in exactly the scenario this spec
exists to handle. If a zone is rebuilt, the old parent DS becomes orphaned
against the new keyset — and with only current and pending keys on record, the
system can no longer tell whether that orphaned DS is a Pirate-issued anchor
that must be retained and cleaned up, or an unrelated record it should ignore.
The question "does a Pirate-anchored DS remain?" can only be answered against
what Pirate has issued, not against what it currently serves.

### Evidence for `pending`

`delegation_security = pending` is a claim that an owner action is in flight, and
it must be backed by evidence rather than optimism. Accepted evidence:

- a wallet-submitted Handshake transaction id
- a mempool observation of that update
- an explicit user acknowledgement that they have submitted it

A **confirmed parent observation transitions directly to `secure`** (subject to
[Authenticated Resolution](#authenticated-resolution)) without passing through
`pending`. `pending` exists to stop the UI re-asking for an action already taken,
not as a mandatory waypoint.

## Observation

Parent DS is read from the Handshake root resource via the synced observer
(`hsd` JSON-RPC), the same path already used for NS and TXT observation. A
resolver-side view is not sufficient: recursion reflects caching and delegation
posture, not what the chain says.

Cadence:

- on demand, when the owner asks the UI to check
- on a schedule while `delegation_security = pending` or a rollover is in flight
- on a slower schedule while `secure`, to detect drift

Drift detection is the part most easily skipped and most valuable. A root that
was secure yesterday and is insecure today produces no error, no failed request,
and no user complaint — the failure is silent by construction, visible only to
validating clients the owner probably is not running.

## Key Rollover

The parent is on-chain and the update is a wallet action. Pirate cannot roll a
key on its own schedule, and must never try.

### Ordering

1. Publish the new DNSKEY alongside the old. → `new_key_prepublished`
2. Wait at least the DNSKEY RRset TTL, so resolvers holding the old RRset expire
   it.
3. Ask the owner to add the new DS **while retaining the old DS**. →
   `new_ds_pending`
4. Observe the new DS in the parent, then wait the parent DS cache window plus
   safety margin. → `overlap`
5. Switch signing to the new key, with both keys still published. This step is
   an **implementation gate**, not a nudge: before proceeding, the system must
   confirm that the new key actively signs every RRset the product depends on
   (SOA, apex and wildcard A, TLSA), and that the trust path anchored by the
   **new DS alone** validates independently of the old one. Requesting removal
   of the old DS before that holds would ask the owner to delete the only
   working anchor.
6. Ask the owner to remove the old DS. → `old_ds_removal_pending`
7. Observe removal, then wait out the old DS cache window.
8. **Only then** retire the old DNSKEY. → `rollover_state = none`

The old key is retired **last**, after the old DS is gone from the parent and
its caches have expired. Retiring it earlier strands resolvers that still hold
the old DS and now cannot find the key it anchors — a self-inflicted validation
failure.

### Timing

The waits at steps 2, 4 and 7 are computed from **positive RRset TTLs and
signature lifetimes**, specifically:

- the DNSKEY RRset TTL
- the effective parent DS cache lifetime
- remaining RRSIG validity for the affected RRsets, since a resolver may hold a
  cached signature until its expiration regardless of TTL
- a safety margin

Negative-cache TTL is **not** a substitute for these. It governs how long a
resolver remembers an absence, not how long it retains a positive RRset or a
signature it already holds.

On Handshake the parent DS lives in the on-chain root resource, and its
effective cache lifetime is determined by the resolver stack rather than a TTL
Pirate controls. The safety margin must be conservative accordingly.

### Invariants

1. **Never rotate a key underneath a published DS.** Any operation that would
   change the KSK for a root whose DS is published must refuse and raise
   `rollover_state = required` instead. This explicitly includes zone rebuild
   and re-provisioning: `/ensure-zone` must be idempotent with respect to keys
   and must not silently mint a new keyset for a root that is `secure`.
2. **Publish before retiring**, per the ordering above.
3. **The owner controls the pace.** Steps 3 and 6 require human wallet actions,
   so a rollover may sit incomplete indefinitely. The system must remain secure
   and correct in that state rather than timing out into drift.

Invariant 1 is not hypothetical. The zone that motivated this spec was created
by a manual `/ensure-zone` call; had a DS already been published for an earlier
keyset, that call would have silently broken every validating client with no
error surfaced anywhere.

## Attachment vs Routing

**Attachment is allowed at ownership proof; authenticated HNS routing requires
`delegation_security = secure`.**

Rationale: ownership is genuinely proven at that point, and the community
association is what the creator came for. Withholding it until an on-chain DS
lands would strand every import behind a second wallet action before the product
does anything useful.

While attached but not `secure`:

- the community association, `route_slug`, and namespace bindings are live
- the namespace surface states plainly that authenticated HNS resolution is
  incomplete, and which action completes it
- nothing claims the name is verified *for secure resolution*
- the distinction is legible in API responses, not only UI copy, so other
  surfaces cannot accidentally imply the stronger claim

**Drift is treated identically.** If authenticated routing is withheld before a
DS is published, it must also be withheld once a DS has drifted. The security
posture is the same in both cases — the chain does not validate — and treating
them differently would mean the product is more permissive about a delegation
that *broke* than one that was never completed.

### Assertions

The existing vocabulary cannot express this. `root_control_verified`,
`routing_enabled`, and `pirate_dns_authority_verified` all describe ownership
and routing posture; none describes parent DS.

Slice 1 adds **three** assertions, not one:

| Assertion | Means | Remedy when false |
|---|---|---|
| `parent_ds_matches_live_dnskey` | condition 1 — the parent anchors a live key | owner publishes or fixes the DS |
| `authoritative_dnssec_valid` | conditions 2–5 — the served zone validates | Pirate fixes the zone |
| `secure_delegation_verified` | both of the above, plus `observation_fresh` | depends which input is false |

A single combined assertion would destroy the diagnostic difference between
"publish your DS" and "our signed zone is broken" — two failures with different
owners, different fixes, and different urgency. Collapsing them would recreate
exactly the misleading-state problem this spec exists to solve: one flag that is
false for several unrelated reasons, leaving the reader to guess which.

`secure_delegation_verified` is the only one routing may key off.

## Quarantine Invariants

The one-write onboarding design provisions a zone before ownership is proven, so
NS, TXT, and DS can be published in a single Handshake update. Constraints:

- **one idempotent quarantined zone and keyset per root.** PowerDNS serves one
  authoritative zone and one DNSKEY set per root; per-attempt keys would require
  split views or publishing every attempt's key in one zone, with cleanup and
  rollover semantics that do not resolve cleanly.
- **multiple authenticated sessions may reference the same quarantined zone**,
  each retaining its own TXT challenge. The zone is shared; the proof is not.
- **per-session authority-health nonce isolation is required.** Today
  `/publish-txt` writes the session nonce to a single `_pirate.<root>` owner
  name, replacing whatever was there. With a shared zone, two concurrent
  sessions silently overwrite each other's nonce, and whichever session reads
  back second sees the other's value — an authority-health check that passes or
  fails for the wrong reason. Either give each session its own owner name, or
  retain multiple session values at `_pirate.<root>` and match on value rather
  than presence. This is a change to the verifier contract, not only to
  Pirate-side bookkeeping.
- **a root-scoped provisioning lock** prevents concurrent zone or key creation.
- **only proven ownership activates attachment or routing.** A quarantined zone
  is inert: it exists, it is signed, and nothing points at it.
- **provisioning is bound to an authenticated account and rate-limited.**
  Minting keys for a root the requester has not proven they own is a resource
  and staging surface; it must not be anonymous or unbounded.
- **abandoned sessions expire on a short clock; zone deletion follows the
  retention rule below.**

## Retention

A zone is retained until **both** are true:

- the Handshake parent no longer delegates to Pirate nameservers, and
- no parent DS corresponds to any entry in [`issued_ds`](#issuance-history)

The second condition is evaluated against issuance history rather than the
currently served keyset, so it survives a zone rebuild.

This applies to detachment as much as abandonment. If a community detaches a
namespace whose DS is still published, deleting the zone would break resolution
for a name the owner still controls, and would do so with no error path back to
them. An idle zone is cheap; a broken delegation is not.

## Failure Semantics

Every transition that can fail must record *which stage* failed, as queryable
state rather than a log line:

```
verify_ownership | provision_zone | check_authority_health | observe_parent_ds
```

A provider outage must be reported as a provider outage. The current behaviour —
every pending state rendering as "Records not found." regardless of cause — made
a one-line ordering bug cost days of diagnosis, because the failure that actually
occurred was discarded at the API boundary and the UI substituted a plausible,
wrong explanation.

The same rule applies to DS observation. "We could not read the parent" and "the
parent carries no matching DS" are different facts and must not share a state.
The first is an outage; the second is `unsecured` or `drifted`.

## Open Questions

- **Safety margin values.** The ordering above is specified in terms of TTLs and
  signature lifetimes; the concrete margins, and the observation cadences during
  rollover, need operator input against the deployed TTLs.
- **Expiry-proximity threshold.** How close to RRSIG expiration a zone may be
  before `secure` is withdrawn rather than merely warned about.
