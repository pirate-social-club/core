# HNS DS Delegation Lifecycle

Status: draft for review

Related docs:

- [hns-authoritative-dns.md](./hns-authoritative-dns.md)
- [hns-verification-flow.md](./hns-verification-flow.md)
- [namespace.md](./namespace.md)
- [namespace-root-control.md](./namespace-root-control.md)

## Purpose

This doc defines the lifecycle that takes an HNS root from *proven ownership* to
*authenticated resolution*, and the invariants that keep it authenticated over
time.

It exists because the product currently stops one step short. A creator can
verify a root, have Pirate provision a signed child zone with DANE TLSA
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

The result is a happy path that silently produces a half-secure namespace.

## Scope

This doc covers:

- the states a root moves through from ownership proof to secure delegation
- what "DS readiness" means cryptographically
- the structured state the system must persist
- how the parent DS is observed, and how often
- key rollover, including the overlap discipline required when the parent is
  on-chain and owner-gated
- what attachment and routing are allowed to do at each state

This doc does not cover:

- the quarantined pre-provisioning design intended to collapse the owner's two
  Handshake writes into one. That design is deliberately specified *against*
  the invariants established here rather than alongside them. See
  [Quarantine Invariants](#quarantine-invariants) for the constraints it must
  satisfy.
- Spaces-family verification. The assertions named here are HNS-only.

## Core Distinction

Three separate claims are currently collapsed into one "verified" state:

| Claim | Means |
|---|---|
| ownership proven | the owner controls the Handshake root and published the session TXT |
| zone provisioned | Pirate serves a signed child zone for the root |
| secure delegation | the Handshake parent carries a DS that authenticates that zone's live key |

The first two are true for every root that completes verification today. The
third is true for none of them, because nothing asks for it.

Only the third makes the chain of trust complete. Without it, DNSSEC validation
terminates at the parent with an insecure delegation, and every downstream
guarantee — signed answers, DANE TLSA, certificate binding — is unauthenticated.

## States

```
ownership_pending
  → ownership_verified
    → ds_publication_required
      → ds_confirmation_pending
        → secure_delegation_ready
            ↘ ds_drifted
            ↘ key_rollover_required
```

**`ownership_pending`** — a session exists with a TXT challenge. The parent has
not yet been observed carrying the expected NS and TXT.

**`ownership_verified`** — the parent carries the expected delegation and the
session TXT. Ownership is proven. The zone may now be provisioned. Community
attachment is permitted from this state (see
[Attachment vs Routing](#attachment-vs-routing)).

**`ds_publication_required`** — the child zone is provisioned and signed, and
its DNSKEY set is published. The DS records derived from the live KSK are
available and the owner has been asked to publish them. This is a first-class
state, not an implicit gap: it is the state most roots will sit in longest,
because leaving it requires an on-chain wallet action by a human.

**`ds_confirmation_pending`** — a DS matching the live key has been submitted or
observed as pending in the parent, but has not yet been confirmed and settled.
Distinguishing this from `ds_publication_required` prevents the UI from
repeatedly asking for an action the owner has already taken.

**`secure_delegation_ready`** — the observed parent DS set cryptographically
matches a currently published zone DNSKEY. This is the only state in which HNS
routing may be advertised as authenticated.

**`ds_drifted`** — the parent DS no longer matches any currently published
DNSKEY. Reached by a parent-side edit, a zone rebuild, or a key change that
bypassed rollover. This is a fail-closed state: routing must be marked
unauthenticated and the owner told what to republish.

**`key_rollover_required`** — the zone's key must change (age, algorithm
migration, compromise), and the parent DS must be updated before the old key can
be retired. Distinct from `ds_drifted` because it is *planned*: the old key is
still valid and still matches the parent, so resolution is still secure while
the rollover runs.

## DS Readiness

`secure_delegation_ready` requires a cryptographic match, not the presence of a
record.

A parent DS matches when **all** of the following hold against a DNSKEY
currently published in the zone's DNSKEY RRset:

- the DNSKEY has the SEP bit set (a KSK; flags `257`)
- `key_tag` agrees
- `algorithm` agrees
- the DS digest equals the digest recomputed over the canonical owner name plus
  the DNSKEY RDATA, using the DS record's own `digest_type`

Rules:

- a root is ready if **at least one** published DS matches. Multiple DS records
  are expected — the current deployment emits digest types `2` (SHA-256) and `4`
  (SHA-384) for the same key — and a resolver needs only one it supports.
- a DS whose digest type the system cannot compute is recorded as
  `unverifiable`, never as matching. It neither satisfies nor blocks readiness
  on its own.
- a DS referencing an unknown key tag is `orphaned`. Orphaned DS records are
  the signal for `ds_drifted` **only** when no DS matches; during rollover an
  orphaned-looking old DS is expected and benign.
- readiness is a property of the *observed parent*, never of what Pirate
  intended to publish. The system must not infer readiness from having shown the
  owner the records.

## Persisted State

DS state must be structured and queryable. The current situation — values
reachable only by parsing an audit blob — is what made this defect invisible.

Per root, persist:

- `zone_dnskeys` — key tag, algorithm, flags, and public key for each published
  DNSKEY, with the active KSK marked
- `expected_ds` — the DS set derived from the current KSK, the values the owner
  is asked to publish
- `observed_ds` — the DS set most recently read from the Handshake parent, each
  annotated `matching` / `orphaned` / `unverifiable`
- `pending_ds` — DS for a key that is being rolled to but is not yet expected to
  be authoritative
- `delegation_state` — one of the states above
- `last_parent_observation_at` and the observation provider
- `state_changed_at`, so drift duration is measurable

`expected_ds` must be derived from the live zone, never cached from an earlier
provisioning response. The values in this incident's evidence bundle are already
one zone rebuild away from being wrong; anything that reuses them without
re-deriving is a latent bug.

## Observation

Parent DS is read from the Handshake root resource via the synced observer
(`hsd` JSON-RPC), the same path already used for NS and TXT observation. A
resolver-side view is not sufficient: recursion reflects caching and delegation
posture, not what the chain says.

Cadence:

- on demand, when the owner asks the UI to check
- on a schedule for every root in `ds_confirmation_pending`, until confirmed or
  expired
- on a slower schedule for every root in `secure_delegation_ready`, to detect
  drift

Drift detection is the part most easily skipped and most valuable. A root that
was secure yesterday and is insecure today produces no error, no failed request,
and no user complaint — the failure is silent by construction, visible only to
validating clients the owner probably is not running.

## Key Rollover

The parent is on-chain and the update is a wallet action. Pirate cannot roll a
key on its own schedule, and must never try.

Invariants:

1. **Never rotate a key underneath a published DS.** Any operation that would
   change the zone's KSK for a root whose DS is published must refuse and raise
   `key_rollover_required` instead. This explicitly includes zone rebuild and
   re-provisioning: `/ensure-zone` must be idempotent with respect to keys and
   must not silently mint a new keyset for a root in
   `secure_delegation_ready`.
2. **Publish before retiring.** The new DS must be observed in the parent while
   the old key is still published and still matching.
3. **Overlap through the caching window.** After the parent carries the new DS,
   both keys stay published for longer than the longest relevant cache lifetime
   — parent DS TTL, zone DNSKEY TTL, and the zone's negative-caching TTL — plus
   a safety margin. Only then may the old key be retired and the old DS asked to
   be removed.
4. **The owner controls the pace.** Because step 2 requires a human wallet
   action, rollover may sit incomplete indefinitely. The system must remain
   secure and correct in that state rather than timing out into drift.

Invariant 1 is not hypothetical. The zone in the incident that motivated this
spec was created by a manual `/ensure-zone` call; had a DS already been
published for an earlier keyset, that call would have silently broken every
validating client with no error surfaced anywhere.

## Attachment vs Routing

Settled: **attachment is allowed at `ownership_verified`; authenticated HNS
routing is not advertised until `secure_delegation_ready`.**

Rationale: ownership is genuinely proven at that point, and the community
association is the thing the creator came for. Withholding it until an on-chain
DS lands would strand every import behind a second wallet action before the
product does anything useful.

What must be true while attached but not secure:

- the community association, `route_slug`, and namespace bindings are live
- the namespace surface states plainly that authenticated HNS resolution is
  incomplete, and which action completes it
- nothing in the product claims the name is verified *for secure resolution*
- the distinction is legible in API responses, not only in UI copy, so other
  surfaces cannot accidentally imply the stronger claim

The existing assertion vocabulary is not sufficient to express this.
`root_control_verified`, `routing_enabled`, and `pirate_dns_authority_verified`
all describe ownership and routing posture; none describes parent DS. Slice 1
adds `parent_ds_published`, defined as the cryptographic match above.

## Quarantine Invariants

The one-write onboarding design provisions a zone before ownership is proven, so
that NS, TXT, and DS can be published in a single Handshake update. Constraints
it must satisfy:

- **one idempotent quarantined zone and keyset per root.** PowerDNS serves one
  authoritative zone and one DNSKEY set per root; per-attempt keys would require
  split views or publishing every attempt's key in one zone, with cleanup and
  rollover semantics that do not resolve cleanly.
- **multiple authenticated sessions may reference the same quarantined zone**,
  each retaining its own TXT challenge. The zone is shared; the proof is not.
- **a root-scoped provisioning lock** prevents concurrent zone or key creation.
- **only proven ownership activates attachment or routing.** A quarantined zone
  is inert: it exists, it is signed, and nothing points at it.
- **provisioning is bound to an authenticated account and rate-limited.**
  Minting keys for a root the requester has not proven they own is a resource
  and staging surface; it must not be anonymous or unbounded.
- **abandoned sessions expire on a short clock; zone deletion follows a longer
  retention policy**, because a deleted zone whose DS is already published in
  the parent is worse than an idle one.

## Failure Semantics

Every state transition that can fail must record *which stage* failed, as
queryable state rather than a log line:

```
verify_ownership | provision_zone | check_authority_health | observe_parent_ds
```

A provider outage must be reported as a provider outage. The current behaviour
— every pending state rendering as "Records not found." regardless of cause —
made a one-line ordering bug cost several days of diagnosis, because the failure
that actually occurred was discarded at the API boundary and the UI substituted
a plausible, wrong explanation.

The same rule applies to DS observation. "We could not read the parent" and "the
parent carries no matching DS" are different facts and must not share a state.

## Open Questions

- **Digest type policy.** The deployment currently emits types `2` and `4`. Is
  publishing both required, recommended, or owner's choice? Resolver support for
  `4` is not universal; publishing only `4` could strand validators.
- **Drift response.** On detecting `ds_drifted`, does the product disable the
  public HNS route, or serve it while clearly marked unauthenticated? Disabling
  is safer and more surprising.
- **Retention on detach.** If a community detaches a namespace whose DS is
  published, the parent still points at a Pirate zone. Deleting it breaks
  resolution for a name the owner still controls. Retention policy needs to be
  stated.
- **Multi-community roots.** A root attached as a mirror to a second community
  shares one zone and one keyset. Which community's lifecycle owns the DS state?
