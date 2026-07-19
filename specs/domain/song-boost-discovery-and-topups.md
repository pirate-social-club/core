# Song boost discovery, presentation parity, and multi-funder top-ups

**Status:** DESIGN ONLY. Do not implement until the restricted Arkansas Blues
production pilot has completed a proven earn -> credit -> cashout money loop.

This document defines two related post-pilot slices. Discovery and presentation
parity ship first. Multi-funder top-ups build on the same public offer payload
after discovery is proven.

## 1. Problems

### 1.1 Feed and permalink drift

The permalink, karaoke, and study routes fetch the active public reward offer.
Community and home feeds do not. The same rewarded song can therefore render
`Sing` in a feed and `Earn $1` on its permalink.

Post actions drift too. Boost is wired only on the permalink. Community feed
passes moderation removal but no author delete or Boost actions. Home feed has
no reward enrichment, Boost, author delete, or moderation actions, and its
presentation mapper drops Boost fields even if a caller supplies them.

Desired: a post has the same reward CTA and eligible menu actions everywhere.
Only deliberate context differences are permitted, including long-text
summarization, navigation targets, and controls that cannot operate safely in
the current surface.

### 1.2 A live song cannot receive more funding

A song can carry at most one live campaign
(`reward_campaigns_one_live_per_song_post`, partial unique on
`(community_id, post_id) WHERE status IN ('scheduled','active','paused')`). A
second would-be funder receives `409 one_live`. Learners can see the daily rate
and end date but not how much budget remains.

Desired: after discovery parity ships, anyone may add money to the existing
live campaign and everyone can see approximately how much remains.

## 2. Milestones and release gates

Implement and release in this order:

1. Prove the production earn -> credit -> cashout loop on the restricted pilot.
2. Ship the pending-verification wallet flow specified in
   `reward-pending-verification.md`.
3. Add a community-scoped public discovery payload.
4. Make community feed, home feed, and permalink presentation consistent.
5. Expose approximate remaining budget through the same payload.
6. Add multi-funder top-ups.

Each milestone is independently releasable and observable. Top-ups must not be
used to justify coupling all five milestones into one deployment.

## 3. Community-scoped discovery contract

### 3.1 Cache shape

Fetch all active reward discovery entries for one community, not an arbitrary
set of visible post IDs.

A request keyed by a viewport-dependent post-ID set produces nearly unique
cache keys, defeats `CachedPublicReads` (15 seconds plus 15 seconds stale while
revalidate), and converts feed volume into traffic against the public rate
limit. A community-scoped query has a stable cache key and high reuse. The
one-live invariant caps each song at one returned offer, and active campaigns
per community are expected to remain small.

Home feed initially issues at most one request per distinct visible community,
deduplicated across cards. Add a bounded multi-community variant only if
measurements show that fan-out is material. Do not accept arbitrary post-ID
sets as a cache-key dimension.

### 3.2 Response shape

Return a strict map keyed by canonical post ID:

```json
{
  "posts": {
    "post_pst_example": {
      "boost_eligible": true,
      "offer": {
        "eligible_activity": "karaoke",
        "min_score_bps": 7000,
        "daily_reward_cents": 100,
        "chain_id": 84532,
        "ends_at": 1785369600
      }
    }
  }
}
```

The map key supplies the post identity needed to join discovery state onto feed
cards without adding identity fields to `PublicRewardOffer`. It must use the
same canonical post ID emitted by post APIs; no prefix stripping or alternate
ID form is allowed.

The contract remains `additionalProperties: false` at every defined object
boundary. It exposes no rewarder, funder, owner, wallet, accounting ledger, or
other user-identifying fields.

### 3.3 Post-aware Boost eligibility

`boost_eligible` is per-post state and must preserve the same rules as
`RewardCampaignCapabilities.enabled && post_eligible`, including the production
post allowlist and song-owner policy where applicable. Feed code must not infer
eligibility from global campaign enablement.

The API should compute eligibility from the same config/policy primitives used
by quote creation. If policy is viewer-specific, keep the public discovery
entry conservative and layer authenticated policy separately; never advertise
Boost when quote creation is known to reject the post.

Configuration/readiness failure is fail-closed: omit the action or emit
`boost_eligible: false`. Offers that are already active remain discoverable
when campaign creation is disabled, provided public reward reads remain
enabled.

### 3.4 Public offer semantics

An offer appears only for a campaign whose public state is currently earnable.
Activity-specific labels remain intentional:

- `karaoke`: karaoke CTA shows the reward; study does not.
- `study`: study CTA shows the reward; karaoke does not.
- `either`: both CTAs show the reward.

The client maps discovery entries once by canonical post ID and passes the same
derived reward labels into all post-card presentation paths.

## 4. Feed/permalink presentation parity

### 4.1 Shared enrichment

Introduce a shared post-card enrichment input containing at least:

- public reward offer;
- `boost_eligible`;
- authenticated author-delete eligibility and handler;
- moderation-remove eligibility and handler;
- reward policy-management eligibility and handler;
- Story/external asset action state.

Route components fetch or construct context, but a shared presentation builder
derives reward CTA labels and menu items. Community, home, and permalink routes
must not maintain separate reward-label or menu switch statements.

### 4.2 Allowed differences

The same post should render the same factual and actionable state across
surfaces. Allowed differences must be explicit:

- long text may be summarized or truncated in feeds;
- comments may navigate to the permalink rather than open inline;
- media may use a compact layout;
- an action may navigate to a permalink-hosted flow instead of mounting the
  flow inline, but its eligibility and label remain consistent.

Viewport size alone must not change whether a user is told that money is
attached to a song.

### 4.3 Menu actions

The shared menu builder and every menu-key dispatcher cover the same action
set: Boost, reward settings, author delete, moderator remove, event cancel, and
Story asset navigation. A route may supply a navigation handler for Boost
instead of mounting one controller per card. It must still use per-post
`boost_eligible` from discovery.

Delete depends on `viewer_is_author`, not community ownership. Operator-created
pilot posts correctly omit Delete for a viewer who is not recorded as author.

## 5. Public remaining budget

Add `remaining_budget_cents` to the discovery offer after presentation parity
ships:

```
remaining_budget_cents =
  funded_cents - reserved_cents - credited_cents - refunded_cents
```

Clamp at zero. This must match the reconciler's allocatable-budget expression.
The number is not real time: reconciliation plus public caching can produce
roughly 30-75 seconds of lag. Copy says `about $8.00 left`, never presents a
live counter, and uses network-honest currency labels on testnets.

Remaining budget is campaign-scale information, not PII. Funder identities and
contribution details remain private.

## 6. Top-up model: one campaign, many funding effects

Add contributions to the existing campaign rather than allowing concurrent
campaigns per song. This keeps the one-live index, offer selection, reconciler
resolution, and post-scoped double-dip protection unchanged. One song retains
one offer, rate, countdown, and budget.

`reward_campaign_funding_effects` already records `funder_user_id`,
`sender_address`, expected amount, transaction hash, and per-effect status. A
top-up is another funding effect against the existing campaign; no
contributions table is needed. Refunds are effect-level and already return to
the observed sender.

## 7. Budget carve-out and atomicity

`budget_cents` is frozen by `reject_reward_campaign_term_changes()` while
`funded_cents` is mutable and constrained by `funded_cents <= budget_cents`.

Permit `NEW.budget_cents > OLD.budget_cents` only. Decreases and changes to
rate, activity, period cap, minimum score, start/end, ownership, and other
frozen fields remain rejected.

Budget is capacity, not payout terms. Introduce terms version 3 whose hash
excludes `budget_cents`; existing version 2 rows retain their historical hash
meaning and are not recomputed.

At confirmation, increment `budget_cents` and `funded_cents` by the same amount
in one transaction under row lock. Never increment at quote issuance. This
preserves `funded_cents == budget_cents` for live campaigns and makes abandoned
or expired quotes no-ops. Enforce the maximum post-top-up budget at quote time
and again under lock at confirmation.

## 8. Time and state rules

Top-ups add money, never time. They do not change `ends_at`.

| Campaign status | Top-up behavior |
| --- | --- |
| `active`, `scheduled` | Accept |
| `exhausted` before `ends_at` | Accept; confirmation revives to `active` |
| `paused` | Reject; owner opted out |
| `operational_hold` | Reject; do not accept money during an incident |
| `ended`, `canceled`, `draft`, `funding_*` | Reject |

## 9. Authorization and consent

- Any authenticated user may contribute, subject to post eligibility and the
  song-owner policy.
- Only the original rewarder controls campaign terms, pause, and cancel.
- A contribution grants no campaign control.
- The song owner retains existing block/pause authority.

Before transfer, state that confirmed contributions are non-refundable, do not
extend the end date, and grant no control.

## 10. Funding semantics that remain unchanged

- Idempotency remains namespaced by funder.
- Sender pinning uses the contributor's primary wallet.
- A top-up quote does not reserve `reward_song_slots`; that reservation is for
  a competing new campaign.
- Late-deposit grace remains in force.
- Wrong amounts route to `refund_pending` without touching campaign counters.
- Refund execution returns funds to the observed sender.
- Confirmed contributions have no un-fund path.

## 11. UI states

| Campaign state | Menu label |
| --- | --- |
| none | `Boost` |
| active with remaining budget | `Boost · about $8.00 left` |
| exhausted before end | `Boost · out of funds` (clickable) |
| paused or operational hold | `Boost · paused` (disabled with reason) |
| ended | `Boost` (creates a new campaign) |

Feed and permalink use the same state derivation. Testnet amounts use the
existing network-aware label helper rather than a bare dollar label.

## 12. Required tests

### Discovery and parity

- Community discovery uses one stable cache key regardless of viewport post
  set and returns canonical post-ID map keys.
- Eligibility remains post-aware; a non-allowlisted song never shows Boost in
  any surface.
- An active karaoke-only offer produces the same karaoke reward label in
  community feed, home feed, and permalink, and no study reward label.
- The same post fixture produces the same eligible menu action keys in all
  three surfaces, except differences explicitly declared by the test.
- Feed menu dispatchers handle every key the shared builder can emit.
- Missing or failed discovery fails closed for Boost and never invents a reward
  amount.
- Home feed deduplicates requests by visible community.
- Contract tests prove no private campaign/accounting fields are exposed.

### Remaining budget and top-ups

- Remaining budget never goes negative and matches reconciler allocatability.
- Concurrent top-ups serialize; budget and funded totals increase by exactly
  the confirmed sum.
- Maximum budget is enforced at quote and confirmation.
- Budget decreases and every other frozen-field mutation remain rejected.
- Exhausted campaigns revive; ended, paused, and operational-hold campaigns
  reject top-ups.
- Top-up quotes do not reserve song slots; competing new campaigns still
  receive `one_live`.
- Wrong and late top-ups preserve counters and refund the correct sender.
- Contributors cannot pause or cancel; authorized owners retain control.

## 13. Migration, deployment, and rollback

Discovery is an additive Core contract change followed by API generation and
implementation, staging API deployment, Web integration, and production
release. Web must not consume a required field before the pinned API serves it.

Top-up migration replaces `reject_reward_campaign_term_changes()` with the
budget-increase carve-out. No contribution table or funding-effect column is
required. Rollback restores the old function body. Confirmed budget increases
remain valid because funded and budget counters rose together; no data repair
is needed.

## 14. Explicitly out of scope

- Extending `ends_at`.
- Concurrent campaigns or relaxing the one-live index.
- Public contributor lists or leaderboards.
- Refunding confirmed contributions.
- Per-viewport post-ID batch cache keys.
- Attributing `paid_cents`; payout effects currently have no campaign link.
