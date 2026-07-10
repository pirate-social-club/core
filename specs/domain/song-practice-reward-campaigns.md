# Song-practice reward campaigns

Status: **implementation in progress behind default-off rewards flags**.

Related docs:

- [song-practice-reward-decisions.md](./song-practice-reward-decisions.md)
- [dance-video-boosts.md](./dance-video-boosts.md)
- [community-pricing-policy.md](./community-pricing-policy.md)
- [purchase-quote-flow.md](./purchase-quote-flow.md)
- [user.md](./user.md)

This spec replaces the flat platform-funded rewards product direction with a funded campaign
model. Streaks remain the habit and leaderboard layer. Cash rewards exist when a rewarder funds a
campaign for a song.

The accepted V1 decisions in `song-practice-reward-decisions.md` override unresolved or
contradictory alternatives in this draft.

## 0. Product shape

Any account may create and fund a reward campaign for a published song. V1 has no owner-approval
gate: a funded campaign attaches without the song owner's sign-off (owner controls — approve,
decline, report — are deferred; the existing moderation surface covers abuse). A platform launch
promotion is just the platform acting as a rewarder through the same campaign machinery.

Users earn when they qualify a practice day for that song. A day qualifies when the existing
song-engagement ledger marks the `(user, song, activity_date)` as qualified:

- study: the daily study attempt threshold is met; correctness does not matter,
- karaoke: a karaoke pass meets the configured score threshold.

Rewards are per qualified day, not per action. Extra study attempts or extra karaoke passes on the
same song and day do not earn more.

Non-goals for v1:

- Do not mint creator, community, or campaign tokens.
- Do not pay on-chain per action.
- Do not let rewarders author arbitrary country-specific rates.
- Do not expose country eligibility as a separate form concept from reward levels; a reward level
  carries both its amount and its included country group.
- Do not stack multiple active campaigns on the same song.
- Do not claw back credited user balances.
- Do not make public surfaces reveal a user's nationality tier.

## 1. Campaign lifecycle

Campaign statuses:

- `draft`: rewarder is editing rate, duration, and budget.
- `funding_quoted`: the funding quote is open and awaiting payment.
- `funding_confirming`: an on-chain payment was observed and is being bound.
- `active`: funding is confirmed and the campaign window is open.
- `paused`: campaign is temporarily stopped by the rewarder or platform ops.
- `exhausted`: remaining budget cannot cover the next credit.
- `ended`: campaign reached `ends_at`.
- `canceled`: campaign was withdrawn before activation or closed with remaining budget reclaimed.

Multiple active campaigns on one song are allowed (no uniqueness constraint). Credits never
stack: at credit time a qualified day resolves to the single highest applicable rate among active,
funded, eligible campaigns, and the milestone bonuses follow the same winning campaign. If the
winning campaign cannot cover the full credit, v1 does not fall through to the runner-up campaign;
the day receives no campaign reward and the winner is marked exhausted. This keeps attribution and
budget accounting simple. Owner approval and owner-resolved competition are deferred — if abuse
shows up, the moderation surface handles it and an owner-controls slice can be added later.

## 2. Funding and logical escrow

Reuse the existing money-in shape instead of inventing a new receipt system:

- quote the funding payment,
- receive Base USDC to the rewards treasury,
- verify the on-chain receipt,
- bind that receipt exactly once to a campaign,
- snapshot the on-chain sender for later reclaim or refund handling.

Physical custody is one rewards treasury wallet. Escrow is logical accounting per campaign:

`funded_cents - credited_cents - refunded_cents = remaining_cents`

The sum of campaign remaining balances plus credited-but-unclaimed user balances must reconcile
against the treasury balance. Add ops alerts for treasury drift and low treasury balance before any
mainnet launch.

Funding sequence:

1. rewarder creates draft campaign,
2. system issues a funding quote,
3. rewarder pays the quote,
4. receipt is confirmed and bound exactly once,
5. campaign becomes active at `starts_at`.

Cancel and reclaim only ever touch uncredited budget. Credited user balances are fully covered and
cannot be clawed back.

## 3. Rate model

**Base rate + community adjustments.** The rewarder sets ONE base reward set (daily, 7-day,
30-day) that applies to **all countries**. The community's regional pricing config (pricing-editor
tier/country-assignment model) supplies percentage adjustments for its assigned country groups,
displayed as read-only "regional adjustment" rows with derived amounts. **Any country not assigned
to an adjustment group earns the full base reward** — the form must state this explicitly, because
assignments are exceptions, never an exhaustive country list. Rewarders do not edit the
country-to-group mapping in the campaign form (the mapping's single source of truth is the
community pricing editor), and they cannot author arbitrary per-country rates. Campaign-level
country targeting (all / only / except) is deferred until a real rewarder asks for it. Communities
with no regional pricing configured simply have no adjustment rows: every country earns the base.
The platform's max-per-practice-day cap applies regardless of mapping gaps, bounding arbitrage from
unassigned countries. The platform owns:

- tier names and country assignments,
- minimum and maximum amounts per tier,
- maximum ratio between tiers,
- minimum campaign budget,
- minimum and maximum duration,
- platform fee policy,
- default retro-credit window.

Communities without regional pricing configured fall back to the platform default reward-level
table.

The platform fee may be `0` at launch, but it should be represented explicitly because this is a
promotion marketplace.

Campaign eligibility is represented through enabled reward levels. A rewarder may include all
community reward levels or exclude whole levels. Country-level allow/exclude lists are a backend
representation detail; the v1 UI should keep the choice at the level/group granularity unless a
specific community has already modeled a single-country group.

Campaign-configurable fields:

- `daily_reward_cents_by_tier`
- `milestone_7_day_cents_by_tier`
- `milestone_30_day_cents_by_tier`
- `per_user_daily_cap_cents_by_tier`
- `eligible_country_codes`
- `excluded_country_codes`
- `total_budget_cents`
- `starts_at`
- `ends_at`
- `retro_credit_days`

Caps scale by tier. A high-tier daily rate with a low global cap is not legible.

## 4. Verification and tier resolution

Earning requires a nationality-bearing verification. V1 earn providers:

- Self with nationality disclosure,
- ZKPassport with nationality disclosure.

Very can remain as a cashout defense-in-depth provider, but it does not determine reward tier in
v1 because nationality is load-bearing.

Already verified users whose previous proof did not disclose nationality must reverify before they
can earn campaign rewards. Product copy should say "Verify your region to earn rewards", not imply
their identity verification failed.

Tier resolution:

1. read the accepted nationality attestation for the user,
2. map country code to the platform reward tier,
3. read the campaign rate for that tier,
4. snapshot provider, country code, tier key, campaign version, and computed amount on the reward
   event.

Do not use IP geolocation to price rewards in v1. IP may be used for fraud review later. If an
IP-based risk control is added, prefer a conservative rule such as `min(nationality_tier, ip_tier)`
instead of letting VPNs raise rewards.

## 5. Display rules

**Invariant: rewards are per-qualified-practice-day bonuses, never a passive rate.** No surface
may present a reward as "$X/day" or any phrasing that reads as yield accruing with time. The
correct register is action-contingent: "today's practice earned $0.40", "practice reward: $0.40".
"Per day" exists only as a frequency limit (at most one reward per song per day), not an
entitlement, and must not appear in user-facing copy.

**Offers live on practice surfaces; the wallet shows only receipts.**

- Song/practice surfaces carry the offer and progress: a daily progress indicator
  (attempts toward today's qualification) with the bonus as the prize, flipping to
  "earned today" when the day qualifies. Before verification the bonus shows as an honest
  range or floor ("$0.10-$1.00", "from $0.10"); once verified, the exact amount.
  Avoid "up to" as the primary message.
- Milestone bonuses render inside the streak display (e.g. "7-day bonus $1.50 added ·
  while campaign budget lasts"), never as detached banners or floating callouts.
- The wallet rewards card displays only results: credited balance with its provenance
  ("from 4 practice days and a 7-day bonus") or, before verification, saved qualified days
  ("5 days saved · worth $0.50-$5.00 depending on your region — verify to collect").
  Forward-looking rates or offers never appear on the wallet.
- Verification is never prompted on the practice surface itself; the verify call-to-action
  lives in the wallet/claim flow.

Public song, feed, and leaderboard surfaces must not expose the user's tier or nationality-derived
rate. Tier-specific amounts belong on the user's own surfaces.

## 6. Qualification and crediting

`song_engagement_days` remains the source of truth for practice qualification. Credit is derived by
a reconciler. Do not credit inline from study or karaoke write paths.

Eligibility for a daily credit:

- campaign is active for the qualified activity date,
- user has a nationality-bearing verification accepted by the platform,
- the verified nationality is eligible for the campaign's country filter,
- no existing reward event exists for `(user_id, campaign_id, activity_date, reward_kind)`,
- per-user daily cap has remaining room,
- campaign has remaining budget.

Budget decrement and reward insertion must be atomic:

1. lock the campaign row,
2. resolve the user's tier and amount,
3. apply per-user daily cap,
4. check remaining campaign budget,
5. insert the reward event,
6. increment campaign credited cents,
7. mark exhausted if the next credit cannot be covered.

Default v1 behavior is no partial daily credits. If the remaining budget cannot cover the computed
credit, mark the campaign exhausted and credit nothing for that event. This avoids odd "$0.03
earned" edge cases.

Add `ON CONFLICT DO NOTHING` on daily reward insertion even if the transaction lock should already
serialize writers.

## 7. Retro-credit on verification

Practice days are recorded whether or not the user is verified. When a user completes a
nationality-bearing verification, retro-credit the trailing campaign window, defaulting to seven
qualified days.

Retro-credit rules:

- use qualified `song_engagement_days` rows in the trailing window,
- resolve the user's current verified tier,
- draw from the campaign's remaining budget at credit time,
- do not pay if the campaign is exhausted or ended,
- keep the same idempotency key as normal daily credits.

The UI should frame this as "You kept 5 days of rewards" and should include "while budget lasts"
where campaigns may exhaust before verification.

## 8. Milestones

Milestones are funded by the same campaign pool and are first-come-first-served in v1. If a user is
at day 22 and the campaign exhausts before day 30, the day-30 milestone does not pay.

This must be visible in product copy as "while budget lasts". Do not let reconciler order silently
decide an invisible promise.

V2 option: reserve day-30 milestone liability once a user crosses day 7. Do not build this in v1
unless product explicitly chooses the stronger guarantee and accepts the budget lockup.

Milestones pay once-ever per `(user, campaign, milestone)`. Rebuilding a broken streak does not
pay the same milestone again.

## 9. Cashout

Rewards accrue off-chain in the account-global rewards ledger. Payout is user-initiated. The
existing nullifier-based unique-human cashout gate remains as defense in depth, but earning should
already have required Self or ZKPassport nationality verification.

Verification gates ledger-to-wallet claiming only. On-chain funds already in the user's wallet are
never restricted by rewards policy.

## 10. Data model sketch

Control-plane tables:

### `reward_campaigns`

- `reward_campaign_id TEXT PRIMARY KEY`
- `campaign_kind TEXT NOT NULL CHECK (campaign_kind='song_practice')`
- `rewarder_user_id TEXT NOT NULL`
- `community_id TEXT NOT NULL`
- `post_id TEXT NOT NULL`
- `song_artifact_bundle_id TEXT NOT NULL`
- `song_owner_user_id TEXT NOT NULL` — snapshot for display/reporting only; no approval gate in v1
- `status TEXT NOT NULL`
- `funded_cents INTEGER NOT NULL DEFAULT 0`
- `credited_cents INTEGER NOT NULL DEFAULT 0`
- `refunded_cents INTEGER NOT NULL DEFAULT 0`
- `platform_fee_bps INTEGER NOT NULL DEFAULT 0`
- `platform_fee_cents INTEGER NOT NULL DEFAULT 0`
- `tier_rates_json JSONB NOT NULL`
- `guardrails_snapshot_json JSONB NOT NULL`
- `starts_at TIMESTAMPTZ NOT NULL`
- `ends_at TIMESTAMPTZ NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

### `reward_campaign_funding_effects`

- `reward_campaign_funding_effect_id TEXT PRIMARY KEY`
- `reward_campaign_id TEXT NOT NULL`
- `rewarder_user_id TEXT NOT NULL`
- `idempotency_key TEXT NOT NULL`
- `chain_id INTEGER NOT NULL`
- `token_address TEXT NOT NULL`
- `expected_amount_cents INTEGER NOT NULL`
- `received_amount_cents INTEGER`
- `sender_address TEXT`
- `treasury_address TEXT NOT NULL`
- `tx_hash TEXT`
- `status TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Extend `reward_events`:

- `reward_campaign_id TEXT`
- `verification_provider TEXT`
- `nationality_country_code TEXT`
- `reward_tier_key TEXT`
- `campaign_rate_snapshot_json JSONB`

Balance remains `SUM(reward_events) - SUM(confirmed/pending payouts)`. Do not create a second
wallet balance.

## 11. Storybook-first surfaces

Build the product review surface before backend implementation:

- song badge: no campaign, unverified range, verified exact rate, budget nearly exhausted,
  exhausted,
- study/karaoke completion: pending verification, reward pending, credited, cap reached,
  milestone while budget lasts,
- verification sheet: Self, ZKPassport, already unique-human verified but missing nationality,
  pending, success with retro-credit, conflict,
- rewarder create flow: community-default tiering with custom-tier mode, budget, duration,
- funding flow: address/QR, waiting for confirmation, confirmed, failed,
- rewarder dashboard: active stats, remaining budget, exhausted, cancel/reclaim,
- wallet: balance, claimable, pending payout, complete payout, identity conflict.

## 12. Build order

1. Merge the dark rewards ledger and payout foundation with production flags off.
2. Add this campaign spec and update dance-video boosts to share the funding model.
3. Audit the regional pricing UI, data model, and tests for reuse.
4. Build Storybook stories for the campaign and verification surfaces.
5. Add campaign and funding-effect schema.
6. Add campaign API behind flags.
7. Update the practice reconciler to resolve campaign rates.
8. Add nationality verification and retro-credit handling.
9. Wire wallet and song surfaces.
10. Run a Base Sepolia staging pilot.

## 13. Open questions

- Do we ever allow partial credits when a campaign has only a small budget remainder?
- Can the rewarder or song owner earn from their own campaign?
- What is the platform fee at launch?
- Do we accept the Self/ZKPassport nullifier namespace split as a capped residual sybil risk?
- Are platform reward tiers global, or can the platform publish reusable templates per market?
