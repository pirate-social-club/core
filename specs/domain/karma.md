# Karma

Status: draft

Related docs:

- [community.md](./community.md)
- [handles.md](./handles.md)
- [user.md](./user.md)
- [profile.md](./profile.md)
- [onboarding.md](./onboarding.md)
- [post.md](./post.md)
- [questions.md](./questions.md)

## Purpose

This doc defines Pirate's native reputation and trust model.

It covers:

- the three-layer reputation architecture
- community-local karma as the primary signal
- global reputation as a safety and trust floor
- how karma events are recorded and aggregated
- trust tiers and their relationship to handle eligibility
- anti-Sybil enforcement requirements
- what karma affects and what it does not in v0

## Non-goals

This doc does not define:

- exact karma weighting formulas
- specific numeric thresholds for trust tiers
- decay or aging formulas
- moderator UI or karma adjustment workflows
- on-chain karma contracts

## Core Principle

Pirate karma is earned, not imported.

Three principles follow:

1. Community-local activity matters most.
2. Global platform trust is a safety signal, not a karma sum.
3. Imported trust from external platforms is a bootstrap signal that fades in influence over time.

Karma should affect eligibility first, pricing later, and feed ranking never in v0.

## Three-Layer Model

Pirate distinguishes three reputation layers.

### Community Karma

- scoped to one `community_id`
- primary native reputation signal
- used for handle eligibility, posting trust, and moderation thresholds within that club
- accumulates through verified participation
- moderated by community moderators

### Global Reputation

- scoped to the platform, not to any club
- weak platform-wide safety and trust signal
- useful for spam resistance and baseline account quality
- not the sum of community karmas
- should not dominate club identity

### External Trust Snapshot

- onboarding-time proof from external platforms such as Reddit
- immutable after capture
- bootstrap only
- not native karma
- defined in [user.md](./user.md) under External Trust Imports

Directional weighting:

- community karma matters most for local decisions
- global reputation helps with spam resistance and baseline trust
- external trust provides initial eligibility boost but fades in influence over time

## Anti-Sybil Baseline

Karma is only meaningful if it cannot be easily farmed.

### Verification Requirement

Only verified users may cast reputation-affecting votes.

Rules:

- voting on posts and comments requires `verification_capabilities.unique_human.state = verified` from an accepted biometric/nullifier provider such as `self` or `very`
- wallet-score systems alone are not sufficient for karma-affecting votes in v0
- user-owned agents must not cast karma-affecting votes in v0 even when their owner is verified
- unverified users may view content but their interactions must not produce karma events
- mock or dev-mode verification must never count toward karma, voting, or trust-sensitive actions outside local development

### Nullifier Uniqueness

At the app layer, not only the contract layer:

- one active `identity_nullifier_hash` may map to only one active `user_id`
- the nullifier model depends on providers that expose a stable uniqueness primitive such as a biometric or nullifier-backed proof; in v0 this includes `self` and may include `very` where product policy accepts it
- if a user rotates wallets, the verified identity follows the `user_id`, not a fresh account
- reverification updates the same user record
- a duplicate nullifier attempting to create or attach to another `user_id` must be rejected or flagged for review
- moderator or admin nullifier override must be rare and audited

This is stronger than "wallet X verified." It ties the uniqueness proof to the user identity, not just the wallet attachment.

### Additional Anti-Sybil Controls

Karma anti-Sybil is enforced through multiple layers:

- identity verification with nullifier uniqueness (see [user.md](./user.md) under Verification Capabilities)
- CAPTCHA or Turnstile on signup, handle claims, account recovery, and suspicious or rate-limited behavior
- CAPTCHA or Turnstile must not be required for normal verified-user voting; identity verification is the voting gate
- rate limits on voting, posting, and handle availability probes
- account age and activity minimums for trust-sensitive actions
- moderation adjustments and penalties
- scrobble karma caps per user per club per day
- append-only event logs that prevent retroactive tampering

## Data Model

### Reputation Events

Reputation events are an append-only log.

They must never be deleted or modified retroactively.

If a moderation penalty was applied in error, the correction is a new event with a positive delta, not a modification of the old event.

Suggested v0 shape:

- `reputation_event_id`
- `user_id`
- `community_id` nullable
- `event_type`
- `source_ref` nullable
- `delta`
- `created_at`

Suggested `event_type` values:

- `post_upvote_received`
- `post_downvote_received`
- `comment_upvote_received`
- `comment_downvote_received`
- `question_answer_correct`
- `scrobble_karma_grant`
- `moderator_adjustment_up`
- `moderator_adjustment_down`
- `trust_tier_promotion`
- `trust_tier_demotion`
- `admin_override`
- `penalty_reversal`

Suggested meanings:

- `community_id` is `null` for global reputation events
- `source_ref` points to the originating entity such as a post ID, comment ID, or moderation action ID
- `delta` is an integer representing the raw karma change
- `delta` may be `0` for binary events like tier promotions that carry no score change
- events are immutable once written
- corrections are new events, not updates

### Community Reputation Aggregate

Per-club aggregates store the derived state.

Suggested v0 shape:

- `user_id`
- `community_id`
- `post_karma`
- `comment_karma`
- `question_karma`
- `scrobble_karma`
- `moderation_adjustment`
- `raw_karma`
- `effective_karma`
- `trust_tier`
- `updated_at`

Suggested `trust_tier` values:

- `new`
- `established`
- `trusted`
- `high_trust`

Suggested meanings:

- `post_karma`
  Sum of upvotes received on the user's posts in this community, minus downvotes.
- `comment_karma`
  Sum of upvotes received on the user's comments in this community, minus downvotes.
- `question_karma`
  Sum of rewardable correct-answer karma granted from club questions in this community.
- `scrobble_karma`
  Sum of scrobble-derived karma in this community, subject to daily caps.
- `moderation_adjustment`
  Sum of all moderator adjustments, both positive and negative.
- `raw_karma`
  Sum of all community-scoped event deltas before moderation adjustments.
  This is `post_karma + comment_karma + question_karma + scrobble_karma`.
- `effective_karma`
  The trust-relevant karma after moderation adjustments.
  This is `raw_karma + moderation_adjustment`.
  Trust tiers and eligibility are derived from `effective_karma`, not `raw_karma`.
- `trust_tier`
  Derived from `effective_karma` against platform-defined thresholds for the club.

Uniqueness:

- unique on `(user_id, community_id)`

### Global Reputation Aggregate

Platform-level reputation is separate from community karma.

Suggested v0 shape:

- `user_id`
- `account_age_days_at_last_update`
- `clubs_active`
- `has_been_site_banned`
- `safety_score`
- `platform_reputation`
- `updated_at`

Suggested meanings:

- `account_age_days_at_last_update`
  Age of the account in days at the time of the last global reputation recalculation.
- `clubs_active`
  Number of communities where the user has `effective_karma` above a minimum threshold.
- `has_been_site_banned`
  Whether the user has ever received a site-level ban.
- `safety_score`
  An internal signal reflecting platform-level trust. Not directly visible to users.
  Derived from verification status, account age, ban history, and cross-community behavior.
- `platform_reputation`
  A low-resolution tier or score used for spam resistance and baseline trust.

  Suggested v0 values:
  - `new`
  - `normal`
  - `trusted`

This is not the sum of community karmas.

`platform_reputation` is a safety floor, not a karma total.

## Karma Inputs

### Good V0 Inputs

The following are reasonable karma sources because they reflect recognized club contribution and are moderately resistant to farming:

- post upvotes received within a club
- comment upvotes received within a club
- posts and comments remaining visible and non-removed over time, represented by the upvote and downvote event totals rather than a separate event type
- correct answers to rewardable club questions
- scrobble-derived karma for music communities
- moderator grants and penalties

### Inputs To Treat Carefully

The following signals are easy to game and should not meaningfully contribute to karma in v0:

- raw posting volume
- raw comment volume
- purchases or spending
- follows received
- club joins

These may be visible signals but should not produce karma events.

### Signals To Exclude From Karma

The following must not produce karma:

- self-votes
- votes from unverified users
- votes from users with `platform_reputation = new` who have not yet passed a minimum activity threshold
- votes cast by user-owned agents
- any automated or bot-generated interaction
- imported external platform metrics such as Reddit karma

Reddit karma can inform initial handle eligibility as a bootstrap signal, but it does not produce karma events and does not add to Pirate karma totals.

## Scrobble Karma

Scrobble-derived karma should exist but remain bounded.

Recommended v0 rules:

- scrobble karma is a low-weight positive signal
- only scrobbles that pass minimum listening validity rules contribute
- scrobble karma is capped per `(user_id, community_id)` per day
- the daily cap prevents passive-listening farms from inflating handle eligibility
- scrobble karma is useful for fan status, top-listener recognition, and music-native participation
- scrobble karma alone should not be enough to dominate handle allocation
- scrobble karma derives only from anchored scrobbles
- accepted but not-yet-anchored scrobbles do not produce `scrobble_karma_grant` events
- the anchor worker emits karma-related side effects only after successful onchain confirmation
- the daily cap is bucketed by `playback_started_at`, not by `anchored_at`

The daily cap value and minimum listening rules are implementation policy, not protocol.

## Trust Tiers

Trust tiers are coarse categories derived from `effective_karma`.

They exist because product policy is easier to express with tiers than raw numeric thresholds.

### Platform-Defined Tiers

Suggested v0 tier values:

- `new`
  Account exists but has not accumulated meaningful community karma.
- `established`
  The user has demonstrated consistent positive participation.
- `trusted`
  The user has substantial club reputation.
- `high_trust`
  The user has exceptional reputation and possibly moderation standing.

### Tier Derivation

Rules:

- tiers are derived from `effective_karma` thresholds, not raw score comparisons
- the platform defines minimum thresholds for each tier
- communities may use stricter thresholds but not looser ones
- a club may not define `trusted` as requiring less karma than the platform minimum for `trusted`
- the platform may adjust tier thresholds over time, but never retroactively demote a user without a moderation action
- `trust_tier` is stored on the aggregate row for read performance, but its authority comes from the event log

### Transition Events

When a user's `effective_karma` crosses a tier threshold:

- a `trust_tier_promotion` or `trust_tier_demotion` event is written to the event log
- `trust_tier` on the aggregate row is updated
- the event `delta` may be `0` if the tier change is a window adjustment, not a karma change

## Relationship To Handle Eligibility

Once a club enables namespace-local handle claims, community karma and trust tiers become the primary inputs for community-local handle eligibility.

Directional v0 mapping:

- `8+` character handles
  Claimable by `established` or higher in the club, or any verified member if the namespace policy allows open claims at that length
- `7` character handles
  Claimable only by `trusted` or `high_trust` users in that club
- `6` character handles
  Claimable only by `high_trust` users, or via manual approval
- `1-5` character handles
  Not eligible through karma alone; reserved, auction-only, or admin-assigned

These are directional guidelines.

The authoritative policy lives in the namespace handle policy record defined in [handles.md](./handles.md).

Global `.pirate` handles use the tier policy defined in [profile.md](./profile.md), not community karma.

External trust snapshots may contribute to early eligibility as a bootstrap signal but must not override native karma-based tier requirements.

## Relationship To Voting

Only verified users may cast karma-affecting votes.

Rules:

- the voter must have `verification_capabilities.unique_human.state = verified` from an accepted biometric/nullifier provider such as `self` or `very`
- the vote must come from a user with a valid nullifier mapping from a provider that offers the accepted uniqueness mechanism
- user-owned agent actions must not count as voter identities or cast parallel votes on behalf of the owner
- duplicate votes from the same nullifier mapping to different `user_id` values must be rejected
- unverified users may browse and view content but their interactions must not produce karma events
- downvotes should be subject to at least the same verification requirements as upvotes
- vote weight is one user one vote in v0; weighted voting by karma is not part of v0

## User-Agent Karma Attribution

User-owned agents do not create a second karma principal.

Recommended v0 rules:

- votes received on a `user_agent` post or reply should accrue karma to the `owner_user_id` represented by that post's `author_user_id`
- the post's `agent_ownership_record_id` is the continuity anchor for determining which owner receives historical karma
- if an agent is later transferred, historical-post karma continues to accrue to the owner attached to the historical ownership record
- new posts after a transfer accrue to the new owner only

This preserves auditability and prevents transfer from retroactively rerouting past contribution history.

## Moderation Adjustments

Moderators may adjust karma to correct abuse, penalize violations, or recognize contributions that the automated system misses.

Rules:

- moderation adjustments produce `moderator_adjustment_up` or `moderator_adjustment_down` events
- adjustments affect `effective_karma`, not `raw_karma`
- adjustments are visible in the event log for auditability
- adjustments should be tied to a `source_ref` pointing to the moderation action
- penalties must not be arbitrary; they should reference a specific policy violation
- admin overrides produce `admin_override` events and must be audited separately

## What Karma Does Not Affect In V0

The following are explicitly out of scope for v0 karma influence:

- feed ranking and post sorting
- pricing discounts on handles or assets
- payment or monetization eligibility
- content promotion beyond eligibility

Karma affects eligibility, not visibility.

This boundary may be relaxed in later versions once karma signals are proven robust against abuse.

## Relationship To External Trust

External trust snapshots are defined in [user.md](./user.md) under External Trust Imports.

For karma-specific rules:

- external trust must not produce karma events
- external trust may inform initial handle eligibility as a bootstrap signal
- external trust must not add to `post_karma`, `comment_karma`, `question_karma`, or `scrobble_karma`
- external trust must not affect `trust_tier` derivation
- external trust may appear on the user's profile as contextual information but must not be displayed as native Pirate karma
- the influence of external trust on eligibility should decrease over time as native karma accumulates

## Relationship To Community

Community karma is scoped to a single `community_id`.

Rules:

- karma earned in one club does not transfer to another
- a user may be `trusted` in one club and `new` in another
- club owners and moderators are responsible for moderation adjustments within their club
- platform admins retain override authority for site-wide violations
- club-question rewards are part of community karma, not a separate product score

Default karma policy should be created at community creation time alongside the namespace handle policy.

See [community.md](./community.md) for the create flow.

## On-chain vs Off-chain

Recommended v0 split:

- karma events are app-level records
- karma aggregates are app-level derived state
- trust tiers are app-level derived state
- no on-chain karma contract is needed in v0
- karma may later influence governance or on-chain actions, but that is a future upgrade

## Open Questions

- What are the specific numeric thresholds for each trust tier?
- Should downvotes subtract from karma, or only neutralize an upvote?
- Should karma decay over time if a user becomes inactive?
- What is the minimum activity threshold before a new user's votes start producing karma events for others?
- Should scrobble karma be capped at a fixed daily amount, or should the cap vary by club size?
- How should karma handle club merges or namespace mirrors where the same user may have karma in sibling namespaces?
- What audit trail is required for admin karma overrides, and who can review it?
