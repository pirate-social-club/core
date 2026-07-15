# Song-practice rewards — v1 decisions

Status: **accepted product and architecture decisions for the first funded pilot**.

Date: 2026-07-10.

This record narrows the broader campaign draft into the decisions required before implementation.
It does not authorize production activation. All rewards flags remain default-off until the funded
campaign acceptance suite and treasury controls pass.

## Product shape

- V1 campaigns use one exact, uniform USDC reward rate. Nationality- or region-adjusted rewards are
  deferred.
- A campaign targets one published song post in one community. It does not automatically follow
  copies of the song into other communities.
- At most one campaign may be active for a song post at a time. Additional rewarders may top up the
  same campaign only without changing its immutable terms. Competing campaigns are deferred.
- A song owner may opt out of third-party rewards. Pre-approval is not required for the pilot.
- Any authenticated user may boost a published song without joining its community. The current
  song owner may block third-party rewards. The block is checked when a draft is created, when
  funding is quoted or confirmed, and again before every reward reservation. Existing confirmed
  funds never become allocatable while a block is active.
- Draft and funding-state campaigns are visible only to their rewarder, the current song owner,
  and active community owners/admins/moderators. Active public offers are visible to everyone.
- A rewarder may have only one unfinished campaign per song post, and draft creation is subject to
  a platform rate limit. These are abuse controls, not community-membership requirements.
- Pirate owns qualification and anti-fraud thresholds. Rewarders choose the activity scope, rate,
  budget, start/end time, and duration within platform guardrails.

## Activity scope

`eligible_activity` is required on every campaign:

- `study`
- `karaoke`
- `either` — Study or Karaoke; the V1 default

`both_required` and separate payments for both activities are deferred.

A human may receive at most one daily campaign reward for a song and reward period. Qualifying
through both Study and Karaoke does not produce two daily rewards. The qualification evidence must
snapshot whether the accepted basis was `study`, `karaoke`, or `both`.

This limit is independent of campaign identity. The control plane claims the unique human, song
post, reward period, and reward kind in the same transaction that creates the reservation. A later
campaign on the same song cannot create a second daily claim for that human and UTC period. The
claim snapshots the song artifact identity for auditability, but artifact replacement does not
reset the post-level daily limit.

## Study qualification

Cash rewards measure completed practice, not mastery.

A Study qualification requires completion of a server-issued practice set whose exercises are:

- members of the issued session,
- unique within the set,
- idempotently submitted,
- subject to a platform-owned minimum engagement floor, and
- bounded by server-owned retry and rate limits.

Correctness is not required for the base campaign reward. Correctness continues to drive learning
feedback, FSRS scheduling, and mastery metrics. Raw client attempt counts are never sufficient.

## Karaoke qualification

Karaoke qualification remains server-authoritative and requires a completed, rank-eligible attempt.
The score, measured-line, coverage, scoring-version, and provider evidence are snapshotted. Pirate
may strengthen replay/liveness controls without changing campaign terms.

## Reward periods and durable evidence

Local Study streak dates remain local-timezone dates. Reward accounting does not reuse them.

V1 uses a server-generated UTC calendar reward period key. Both Study and Karaoke use the same key.
The key is never derived from a client-provided timezone or directly from request IP. UI may render
the UTC reset in the user's locale without changing the accounting boundary.

Community shards emit append-only qualification events through an outbox. Each event carries:

- stable event id and monotonic shard sequence,
- user id, community id, post id, and song artifact identity,
- activity and qualified-at timestamp,
- canonical reward period key,
- qualification-policy version and evidence summary.

Control-plane consumption uses a durable per-community checkpoint and idempotent event keys. It
must not repeatedly scan a newest-first window of mutable engagement rows.

## Qualification grace and expiry

- A qualification remains claimable for exactly seven 24-hour days from its server-controlled
  `qualified_at` instant. It expires when the reconciliation clock is greater than or equal to
  `qualified_at + 7 days`; `reward_period_key` never controls expiry.
- Unverified qualifications do not reserve campaign budget. Product copy must say
  `Verify within 7 days to claim` and must not describe an unreserved reward as saved or earned.
- The reconciler scans only qualifications newer than `now - 7 days`. The credit transaction
  rechecks expiry after locking the campaign row, so a qualification that reaches its expiry while
  waiting for the lock is rejected deterministically.
- Campaign end stops new qualifications. A qualification earned on or before the immutable
  campaign end remains claimable during its seven-day grace window, subject to remaining budget,
  owner policy, identity eligibility, and caps. Exhaustion admits no partial or later credit.
- Campaign terms need no additional grace-period snapshot: terms are database-immutable. Budget
  availability is intentionally resolved when the verified credit transaction runs.

For the pilot, an implicit Study practice set is fixed by the server's first target count for the
UTC reward period. Completion requires that many distinct server-issued exercise ids; retrying the
same exercise does not advance reward completion. The existing correctness-based local streak may
qualify at a different moment and is not cash-reward evidence.

## Milestones and caps

- Milestones derive from durable campaign-period qualifications, not `current_streak`.
- Only campaign-qualified periods count. A streak that predates campaign activation does not
  immediately unlock a campaign milestone.
- Daily and milestone credits are always full or zero; partial credits are not allowed.
- Platform validation requires the per-human reward-period cap to cover every configured
  combination that may mature in one period. Milestones do not bypass the cap.
- Milestones remain pending when a transient reconciler failure occurs; a later streak reset cannot
  erase an earned milestone.

## Identity and payout assurance

The uniform pilot uses exactly one configured reward-identity namespace. The initial candidate is
Very palm uniqueness, conditional on written confirmation that its nullifier is stable across web
and native flows, device changes, deletion, and re-enrollment.

The payout gate checks the accepted provider and mechanism, proof expiry, revocation, and assurance
policy. An arbitrary active `identity_nullifiers` row is insufficient.

Self, Very, and ZKPassport nullifiers are not assumed to share a human namespace. Multiple provider
namespaces may not be enabled for one rewards program until an explicit linking or bounded-risk
policy is approved. Caps are keyed to a durable `reward_identity_id`, not only `user_id`.

The pilot's 18+ posture must be decided before Very is enabled. Provider availability must not be
represented as proof that a user meets an unstated age policy.

## Funding, reservations, and display

- V1 funding is direct Base USDC. TON/bridge funding is deferred.
- The first pilot charges a literal zero platform fee. `funded_cents` is entirely allocatable reward
  inventory. A future fee must be funded on top of that inventory and accounted separately; it may
  never be reserved or credited as a user reward.
- A campaign becomes active only after a uniquely consumed on-chain receipt is verified and bound.
- Reward funding RPCs must prove their network with an explicit `eth_chainId` response matching the
  configured campaign chain. Supplying an expected chain id to a static provider is not proof.
- Funding confirmation prefers the canonical Base `safe` block tag. The receipt block number must
  be at or below the safe block and its block hash must still match the canonical block at that
  height. When an RPC does not support `safe`, the pilot requires 30 independently derived block
  confirmations. Provider convenience confirmation fields are not authoritative.
- Missing receipts, non-canonical receipt blocks, chain mismatches, and transient RPC failures keep
  the existing funding effect in its recoverable `confirming` state with the same transaction hash
  and idempotency key. They never create or claim a second funding effect.
- A reorg detected before activation prevents confirmation and campaign activation. A reorg
  detected after activation is a treasury incident: the affected campaign enters a durable
  operational hold and accrual stops. Existing credited user balances are never silently clawed
  back. Alert ownership and recovery authorization must be configured before a funded pilot.
- Campaign accounting tracks funded, reserved, credited, paid, and refunded cents.
- Qualification reserves the exact uniform reward before the UI says it was earned.
- Future regional campaigns must reserve the maximum possible liability until rate resolution, then
  release the difference.
- Cancellation and refunds may touch only unreserved, uncredited budget and return to the verified
  funding source under the campaign refund policy.

Uniform campaigns display an exact amount, for example `Practice reward: $0.40 USDC`.
Future APIs return structured `exact`, `range`, or `up_to` display semantics. A range is used only
when its floor is guaranteed. `Up to` is used when zero or exclusion is possible. `Max` is reserved
for rewarder configuration and reporting.

## Operational holds and alert ownership

- Platform incidents use the distinct durable `operational_hold` state; owner policy continues to use `paused`.
- An accounting-counter mismatch or definitive loss of a previously confirmed funding receipt opens a durable incident. Two monitor observations are required before a non-terminal campaign is held. RPC errors, unavailable safe heads, and other ambiguous reads are monitor failures and never evidence that funding disappeared.
- Holds apply only to `scheduled`, `active`, or owner-`paused` campaigns and only for accounting mismatch or definitive finality loss. An anomaly on an `ended` or `exhausted` campaign is alert-only and never destroys its terminal lifecycle state.
- Confirmed funding effects created before block provenance was persisted remain nullable and produce a standing coverage-gap incident and alert, never a hold. Before any pilot enablement, operators backfill block number/hash from the configured chain and verify canonicality; provenance is never invented from campaign timestamps.
- Held campaigns publish no offer and admit no new reservation or credit. Existing credits and submitted payouts are never clawed back. Reservation-to-credit remains one transaction, so an open reserved row is itself an accounting incident.
- Every incident records immutable opening evidence, occurrence count, last-seen time, named alert owner and destination, and successful delivery time. Missing ownership configuration makes the monitor fail closed before scanning; it must not create an unowned incident.
- Recovery is an explicit authorized operation. It requires healthy accounting and funding checks, resolves every open incident with operator identity and note, and restores the exact lifecycle state captured before the hold.
- The recovery HTTP surface uses the dedicated `/operator/reward_campaigns/{campaign_id}/incidents/{incident_id}/recover` namespace and operator-credential scope `rewards:campaign-incidents:resolve`. This deliberately differs from user-authenticated `/reward_campaigns/*` routes so user middleware cannot intercept or authorize treasury recovery.
- Monitor state never overloads one timestamp with two meanings: `last_attempted_scan_at` proves scheduler liveness, while nullable `last_successful_scan_at` proves complete finality coverage. A wholly blind finality page alerts immediately; stale/never-complete coverage and rate-based partial degradation alert independently with distinct dedupe identities.
- The seven-day qualification grace remains wall-clock based during a hold. Qualifications do not reserve inventory and the accepted pilot policy intentionally does not promise compensation for platform downtime.

## Rollout controls

Accrual, reads, payouts, and campaigns have independent default-off flags. A staging deployment
must not enable retroactive accrual merely because reward reads or UI review are enabled.

Before any funded pilot, tests must cover:

- more candidates than one reconciler page without starvation,
- replay and concurrent qualification delivery,
- campaign budget exhaustion and treasury reconciliation,
- adversarial receipt rejection (wrong sender, recipient, token, and amount), quote expiry,
  partial funding, pending/rejected confirmation recovery, and concurrent transaction-hash reuse,
- campaign counters reconciled against the authoritative reservation/event sums,
- milestone recovery after outages and streak resets,
- payout retries after a lost response and wallet changes,
- real Postgres concurrent cashouts,
- signer nonce isolation,
- proof expiry, revocation, and provider-policy enforcement, and
- fund → qualify → reserve → verify → credit → cashout → confirm on Base Sepolia.
