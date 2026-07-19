# Reward qualifications pending human verification

**Status:** DESIGN ONLY. Implement after the restricted production pilot proves
the settlement path with an account already verified through the configured
rewards identity provider. This slice must ship before widening campaign
creation beyond the pilot allowlist.

## 1. Problem and invariant

Public reward offers are visible without identity verification, and an
unverified user may complete a qualifying study or karaoke activity. Today the
qualification is ingested, but reconciliation returns `skipped_identity`. No
balance, pending state, or user-facing explanation is created.

The wallet offers verification only when credited balance already meets the
cashout minimum. Because identity is required before credit, an unverified user
cannot reach the verification action:

```
qualification requires verification to become credited balance
verification prompt requires credited balance
```

Keep identity enforcement before credit. `reward_identity_id` is the durable
key for one reward per human, song, and period; per-human caps; and campaign
budget allocation. Crediting by account before proof would permit account
Sybils to consume campaign funds.

The product change is visibility and recovery, not credit-before-proof.

## 2. User contract

1. Anyone may see a public reward offer.
2. A signed-in user may complete the activity without prior human verification.
3. A qualifying result becomes **pending verification**, not credited money.
4. The rewards wallet shows the conditional amount and its deadline.
5. The wallet offers the one configured rewards verification provider even
   when credited balance is zero.
6. Successful verification kicks reconciliation.
7. Reconciliation applies identity deduplication, caps, campaign state, and
   available-budget checks before creating a credit.
8. When the cashout minimum is met, the user proceeds to the existing cashout
   flow.

Pending copy must not say money is earned, guaranteed, reserved, or owned. Use
copy such as `About $1 pending verification` and explain that availability is
checked after verification.

## 3. Control-plane projection

`reward_qualification_events` already contains the durable, idempotent copy of
shard-local qualification evidence. Do not duplicate that evidence or read
shards from the wallet.

Add a control-plane reconciliation projection keyed to the source event:

```sql
CREATE TABLE reward_pending_qualifications (
  reward_pending_qualification_id TEXT PRIMARY KEY,
  reward_qualification_event_id TEXT NOT NULL UNIQUE,
  reward_campaign_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reward_period_key DATE NOT NULL,
  reward_kind TEXT NOT NULL,
  qualification_basis TEXT NOT NULL,
  conditional_amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  terminal_reason TEXT,
  credited_reward_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Allowed statuses:

- `pending_verification`
- `reconciling`
- `credited`
- `expired`
- `ineligible`

Terminal reasons are an allowlisted enum including `campaign_ended`,
`budget_unavailable`, `identity_duplicate`, `owner_blocked`, `score`, and
`verification_window_expired`. Do not store free-form operator or provider
errors in the public projection.

Foreign keys reference the qualification event, campaign, user, and credited
reward event. Add an index on `(user_id, status, expires_at)` for wallet reads
and reconciliation.

Prevent repeated attempts from inflating the wallet display. At most one
non-terminal pending projection exists per account, community, post, period,
and reward kind. Identity-level uniqueness is still enforced later through
`reward_song_period_claims`; account-level uniqueness is only presentation and
work deduplication.

## 4. Projection creation

When a qualification passes campaign, activity, score, owner-policy, and time
checks but `resolveActiveRewardIdentity` returns null, upsert the pending
projection in the same control-plane database. Increment the scheduled summary
counter, but do not treat the qualification as silently handled.

Do not create a reservation, reward event, user-day credit, identity claim, or
campaign counter update. Pending state consumes no campaign budget.

Store `conditional_amount_cents` from the campaign terms that applied at
qualification time. This is display/audit information only. Final credit still
re-reads and locks campaign state; the snapshot cannot authorize payment.

If a later reconciliation credits the qualification, atomically mark the
projection `credited` and link its reward event. If a deterministic condition
makes it unpayable, transition it to a terminal state with an allowlisted
reason so it stops being rescanned and the wallet can explain the outcome.

## 5. Expiry bounded by campaign settlement

Pending state must not outlive its ability to settle:

```
expires_at = min(
  qualified_at + qualification_grace,
  campaign.ends_at + settlement_tail
)
```

`settlement_tail` is a short, explicit operational allowance for ingestion and
reconciliation after campaign end. It is not a campaign extension and cannot
make activities after `ends_at` eligible.

When the deadline passes, mark the projection `expired`. The wallet must stop
showing a payable amount and may show a short terminal explanation. Increasing
the general grace period must never extend a pending item past the bounded
campaign settlement window.

## 6. Wallet API and presentation

Extend the authenticated reward summary with a strict pending section:

```json
{
  "pending_verification": {
    "count": 1,
    "conditional_cents": 100,
    "earliest_expires_at": "2026-07-26T12:00:00Z"
  },
  "cashout": {
    "eligible": false,
    "min_cents": 100,
    "verification_state": "unverified",
    "verification_provider": "self"
  }
}
```

Pending cents are never included in `balance_cents`, `today_earned_cents`, or
cashout eligibility.

Show `Verify to claim` when active pending state exists and verification is
missing, regardless of credited balance. After provider completion, show
`Checking pending rewards` and poll the summary until the projections become
credited or terminal. The verification callback should enqueue or kick the
bounded reconciler; correctness must not depend on the kick, because scheduled
reconciliation remains the durable fallback.

If budget is gone or the campaign settles before verification, replace pending
copy with the terminal outcome. Never leave a dollar amount displayed after it
becomes impossible to pay.

## 7. Provider policy

Use exactly one configured rewards identity provider per environment for now.
Production uses `self`; staging may continue using `very` for its seeded test
identities.

The reward summary advertises the configured provider. The rewards verification
sheet renders only that provider. Remove ZKPassport and any non-configured
provider from this specific sheet; those providers remain available for other
product verification intents.

Do not expand rewards to `self | very | zkpassport` without a cross-provider
identity policy. Provider-scoped nullifiers cannot prove that identities from
two different providers represent different humans. Accepting all providers
without unification weakens one-human-one-reward semantics.

A future multi-provider design requires either privacy-preserving identity
unification or an explicit product decision to accept bounded cross-provider
duplication.

## 8. Readiness and observability

Add an operator-facing readiness signal for the configured provider:

- configured provider is recognized;
- at least one active nullifier exists in the environment;
- qualification reconciliation reports pending, credited, terminal, and
  expired counts separately.

An empty provider population should warn loudly and appear in diagnostics. It
must not hide public offers or disable qualification ingestion; otherwise the
system recreates the same silent failure at an earlier layer.

Alert on sustained pending growth, high verification expiry, and a configured
provider with zero active identities while campaigns are live.

## 9. Tests

- Unverified qualifying activity creates one control-plane pending projection
  and no reservation, credit, identity claim, or campaign counter mutation.
- Repeated qualifying attempts for the same account/song/period do not inflate
  pending count or conditional cents.
- Wallet reads require no community-shard fan-out.
- Pending state makes `Verify to claim` available with zero credited balance.
- The sheet renders only the provider returned by the reward summary.
- Successful verification kicks reconciliation; the scheduled fallback also
  settles without the kick.
- Two accounts sharing the same reward identity cannot both credit the same
  song period.
- Final reconciliation rechecks score, policy, campaign time, cap, and budget
  under the existing transaction/lock rules.
- Pending state never changes funded, reserved, credited, or refunded counters.
- Expiry is the minimum of grace and campaign settlement bound.
- Budget exhaustion or campaign settlement transitions pending state to a
  terminal explanation and removes its payable amount.
- ZKPassport or Very verification cannot be presented as satisfying a
  production `self` rewards policy.

## 10. Rollout

1. Prove production settlement with an already Self-verified pilot account.
2. Land the Core contract and control-plane migration.
3. Implement the projection and reconciliation transitions in API.
4. Deploy API to staging and verify pending -> verification -> credit.
5. Update Web wallet summary, provider sheet, and polling state.
6. Release to production while the campaign allowlist remains restricted.
7. Only then consider community feed discovery parity or widening campaign
   creation.

Rollback may stop creating new projections while preserving existing rows for
later reconciliation. Never delete pending evidence or reinterpret it as
credited balance during rollback.

