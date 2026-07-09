# Dance-video boosts — design contract

Status: **draft (spec-only, do not build yet)**.

Related docs:

- [song-practice-reward-campaigns.md](./song-practice-reward-campaigns.md)

Use the same funding, owner-consent, treasury accounting, and nationality-tiered reward principles
defined there unless this doc explicitly says otherwise.

This feature comes after song-practice rewards. The goal is to let an approved rewarder fund a
campaign that rewards users for posting a video that references the song, turning the existing
video soundtrack rights detector into a promotion detector.

## 0. Product shape

An approved rewarder creates a boost campaign for a published catalog song and deposits a USDC
budget. The song owner must approve third-party campaigns before they attach public cash incentives
to the song. Users post videos that use or dance to the song. The video-media analysis job extracts
an audio sample, runs ACRCloud against the platform custom bucket, maps the match back to the song
artifact bundle, and creates a pending boost reward. A lightweight review queue approves payment.
Approved rewards accrue in the account-global rewards ledger and cash out through the same
unique-human gated USDC payout rail as streak rewards.

Non-goals for v1:

- Do not mint creator/community tokens.
- Do not pay synchronously at video upload time.
- Do not require computer-vision proof that a dance happened. ACR proves the song is present; the
  approval queue handles quality.
- Do not change the song-practice reward ledger semantics.

## 1. Existing primitives to reuse

- `video-media-analysis-handler.ts` already extracts a video audio window, identifies it with
  ACRCloud, and persists the result via `persistVideoRightsAnalysis`.
- `parseAcrEvaluation` already maps custom-bucket matches to
  `song_artifact_bundle_id` from ACR `user_defined` metadata.
- `video-rights-analysis.ts` already identifies the key case:
  `allow_with_required_reference` + `policyReasonCode='undeclared_catalog_match'` when a video
  contains a catalog song but declares no source.
- `asset_derivative_links` already records positive `references_song` edges for declared upstream
  references.
- `rights_review_cases` already provides the queue shape for human review and terminal actions.
- Rewards cashout already gates payouts on `identity_nullifiers.status='active'` and sends USDC
  through the operator settlement rail.

## 2. Data model

Add control-plane tables. Campaigns are account-global funding objects; detections still originate
from community shards.

### `song_boost_campaigns`

- `song_boost_campaign_id TEXT PRIMARY KEY`
- `owner_user_id TEXT NOT NULL`
- `community_id TEXT NOT NULL`
- `song_artifact_bundle_id TEXT NOT NULL`
- `source_asset_id TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('draft','active','paused','exhausted','closed'))`
- `budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0)`
- `reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0)`
- `paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0)`
- `reward_cents INTEGER NOT NULL CHECK (reward_cents > 0)`
- `per_user_cap_cents INTEGER NOT NULL CHECK (per_user_cap_cents > 0)`
- `campaign_cap_cents INTEGER CHECK (campaign_cap_cents IS NULL OR campaign_cap_cents > 0)`
- `starts_at TIMESTAMPTZ NOT NULL`
- `ends_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Funding v1 can mirror bookings/public-name routed payment: creator pays operator treasury in Base
USDC; the control plane records the confirmed deposit before setting `status='active'`. Keep this
separate from platform-funded streak rewards.

### `song_boost_reward_events`

- `song_boost_reward_event_id TEXT PRIMARY KEY`
- `campaign_id TEXT NOT NULL`
- `user_id TEXT NOT NULL`
- `community_id TEXT NOT NULL`
- `post_id TEXT NOT NULL`
- `asset_id TEXT`
- `song_artifact_bundle_id TEXT NOT NULL`
- `media_analysis_result_id TEXT`
- `acr_confidence INTEGER`
- `amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)`
- `status TEXT NOT NULL CHECK (status IN ('pending_review','approved','rejected','paid','failed'))`
- `review_case_id TEXT`
- `approved_at TIMESTAMPTZ`
- `rejected_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

Unique indexes:

- `(campaign_id, user_id)` where `status IN ('pending_review','approved','paid')` for one paid
  reward per user per campaign.
- `(campaign_id, post_id)` where `status != 'rejected'` so repost/reanalysis cannot duplicate a
  pending reward for the same video.

Approved boost rewards should either:

- feed a new `reward_events.reward_kind='song_boost_video'` once the rewards ledger is extended,
  or
- remain in `song_boost_reward_events` and be included in `/me/rewards` balance math.

Pick one implementation path before build. Do not silently create a second wallet balance.

## 3. ACR score promotion

Today `acrcloud_custom_match_json` stores raw JSON only. Boosts need thresholding and auditability.
Promote the best platform-catalog custom match score to columns on `media_analysis_results` or a
side table:

- `acrcloud_custom_best_song_artifact_bundle_id`
- `acrcloud_custom_best_score`
- `acrcloud_custom_best_provider_ref`

The threshold is campaign-configurable, with a platform default. If ACRCloud returns multiple
platform song matches, choose the highest score above threshold; ties go to review.

## 4. Detection flow

When video analysis finishes:

1. Extract the same audio window already used by `video-media-analysis-handler.ts`.
2. Run ACRCloud identification.
3. Parse custom-bucket matches to `song_artifact_bundle_id`.
4. Look up active boost campaigns for the matched song at analysis time.
5. If no active campaign exists, keep current rights behavior unchanged.
6. If an active campaign exists and the post already declared the matched song, write a positive
   `references_song` link and create a pending boost reward.
7. If an active campaign exists and the match is `undeclared_catalog_match`, do **not** open a
   punitive rights case by default. Instead:
   - write the positive `asset_derivative_links` `references_song` edge, and
   - create a boost review case with evidence from the ACR result.

The policy re-route applies only for active campaigns. A non-campaign catalog match continues to
use the existing rights guardrail.

## 5. Review and payment

Use a rights-review-shaped queue, but make the action semantics promotional:

- `approve`: reserve campaign budget, mark reward `approved`, and expose the amount in the user's
  rewards balance.
- `reject`: mark reward `rejected`; release any reservation.
- `block`: preserve current moderation/rights blocking behavior for abusive posts.

Initial v1 should require approval before funds are payable. A later auto-approve path can be
added for high-confidence matches and trusted users after observing fraud rates.

Budget reservation must be atomic in the control plane:

- lock campaign row,
- check `budget_cents - reserved_cents - paid_cents >= amount_cents`,
- increment `reserved_cents`,
- transition event to `approved`.

When the user cashes out, paid boost rewards are settled by the same rewards payout rail. If boost
events live outside `reward_events`, cashout must atomically mark included approved events as paid
or reserve them in a payout effect so retries cannot double-spend.

## 6. Fraud and caps

Required v1 controls:

- unique-human cashout gate remains mandatory; do not gate the on-chain wallet.
- one reward per user per campaign.
- one reward per post per campaign.
- per-campaign budget cap.
- per-user campaign cap.
- ACR confidence threshold.
- review approval before payment.
- reject self-dealing by default: campaign owner cannot earn from their own campaign unless an
  explicit admin override is added.

Known residual risk: an audio match proves the song is present, not that a dance happened. The
approval queue and low per-event payouts bound this in v1.

## 7. API/UI surfaces

Creator:

- campaign create/edit screen on song owner tools.
- budget deposit status.
- campaign stats: pending review, approved, paid, remaining budget.

User:

- song surface badge: "Boosted: earn $X for a video".
- video composer hint when a boosted song is selected as a reference.
- post-publish state: "boost match pending analysis" → "pending review" → "approved" /
  "not approved".
- wallet rewards card includes approved boost rewards in the same balance as streak rewards.

Reviewer:

- queue filtered by boost campaign.
- evidence: video post, matched song, ACR confidence, sample window, raw ACR excerpt, poster,
  prior rewards for the campaign.

## 8. Acceptance criteria for build phase

- A creator can fund an active Base Sepolia USDC campaign for a published song.
- A video containing that song creates exactly one pending boost reward for the campaign within
  the existing 1-3 minute media-analysis window.
- Re-running analysis is idempotent.
- A reviewer approval makes the reward visible in `/me/rewards`.
- Cashout includes approved boost rewards and double-send retries are impossible.
- A non-campaign undeclared catalog match still opens the existing rights-review case.
- A campaign match writes a positive `references_song` edge.
- ACR confidence is queryable without parsing raw JSON.

## 9. Build order

1. Migrations and read models: campaigns, boost reward events, ACR score promotion.
2. Creator funding flow on Base Sepolia.
3. Video-analysis re-route behind `SONG_BOOSTS_ENABLED=false`.
4. Review queue actions and budget reservation.
5. Rewards balance/cashout inclusion.
6. Web campaign/user/reviewer UI.
7. Staging pilot with small caps, then mainnet caps.
