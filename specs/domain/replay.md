# Replay

Status: draft

Related docs:

- [livestream.md](./livestream.md)
- [live-segments.md](./live-segments.md)
- [post.md](./post.md)
- [asset.md](./asset.md)
- [marketplace.md](./marketplace.md)
- [monetization.md](./monetization.md)
- [rights-review.md](./rights-review.md)

## Purpose

This doc defines the user-facing replay experience for livestreams in Pirate v2.

It covers:

- replay visibility on the anchor post and room page
- replay processing and review states
- replay access and purchase behavior
- relationship between replay asset, replay listing, and replay status

## Core Principle

Replay is a continuation of the live-room experience, not a separate room type.

Recommended v0 split:

- `live_room` remains the source of truth for replay lifecycle state
- `replay_asset_id` points to the media object when replay media exists
- `replay_listing_id` points to replay commerce when replay access is sold separately
- the anchor post remains the social and discovery surface for the replay

Access-control rule:

- free replay may remain publicly playable without CDR-style locking
- paid replay must be represented by a locked replay asset and delivered through Pirate's existing CDR-compatible access path

## User-Facing Replay States

Recommended v0 replay states:

- `none`
- `processing`
- `review_pending`
- `published`
- `failed`

Suggested user-facing meaning:

- `none`
  No replay is available yet. On an ended room, this means no replay has been retained or initiated.
- `processing`
  Replay generation is underway.
- `review_pending`
  Replay media exists or is nearly ready, but Pirate has held publication or monetization pending rights review.
- `published`
  Replay is available for viewing according to its access rules.
- `failed`
  Replay generation failed or could not be published.

## Anchor Post UX

The anchor post should remain the primary discovery surface for replay.

Recommended v0 behavior:

- when the room is live, the anchor post renders live status and join CTA
- when the room ends and `replay_status = processing`, the anchor post renders a replay-processing state
- when `replay_status = review_pending`, the anchor post renders a replay-under-review state
- when `replay_status = published`, the anchor post renders replay playback or replay CTA
- when `replay_status = failed`, the anchor post renders that no replay is available

The anchor post should not expose private review detail. Public UX should only need the coarse replay state.

## Replay Access Model

Replay access reuses the normal listing and entitlement model.

Recommended v0 cases:

### Free Replay

- `replay_status = published`
- `replay_asset_id` is non-null
- `replay_listing_id = null`
- any viewer who satisfies normal room and guild viewing rules may watch
- replay may be served as a public asset or public media payload

### Paid Replay

- `replay_status = published`
- `replay_asset_id` is non-null
- `replay_listing_id` is non-null
- viewer must satisfy the replay listing entitlement before full playback
- the replay asset must be `access_mode = locked`
- full replay delivery should use Pirate's CDR-compatible locked-asset path

### Reuse Live Entitlement

- `replay_status = published`
- `replay_asset_id` is non-null
- `replay_listing_id = null`
- replay access is granted by the original live-room entitlement according to room policy
- if replay is entitlement-gated rather than public, the replay asset should still be `access_mode = locked`

Entitlement resolution rule:

- when replay uses the original live entitlement, replay-access checks must resolve against the viewer's live-room purchase or entitlement record rather than a separate replay listing
- in this case, replay access may return `allowed` even though `replay_listing_id = null`

## Replay Publication Rules

Recommended v0 rule:

- replay must not become publicly playable or purchasable until `replay_status = published`
- `replay_asset_id` by itself does not imply public availability
- `replay_listing_id` must not be activated for buyer-facing replay sales until replay clears processing and any rights review
- paid replay must not be exposed as a plain public media payload; it should only be accessible through the locked-asset entitlement path

Auto-clear and review behavior:

- zero confident ACRCloud matches may auto-clear directly to `published`
- flagged rights cases move to `review_pending`
- accepted upstream references must be attached before replay monetization clears where policy requires them
- replay should remain in review if any relevant live segment still requires reconciliation or rights review

## Replay Read Model

Likely replay read model fields:

- `live_room_id`
- `anchor_post_id`
- `replay_status`
- `replay_asset_id` nullable
- `replay_listing_id` nullable
- `is_playable`
- `is_purchasable`
- `viewer_entitled`
- `preview_ref` nullable
- `reason` nullable

Interpretation:

- `is_playable` depends on `replay_status`, access mode, and entitlement
- `is_purchasable` depends on replay status and listing activity
- `reason` supports coarse UX like `processing`, `under_review`, `purchase_required`, or `not_available`

## Rights Review Boundary

Replay UX should reveal state, not operator workflow.

Recommended v0 rule:

- public replay surfaces may expose that replay is under review
- public replay surfaces should not expose the full rights-review case or operator notes
- operator tooling may inspect the underlying review case through separate internal surfaces later

## Open Questions

- Should replay preview snippets exist before full replay publication, or should preview remain hidden until replay is published?
- Should paid live access default to replay entitlement reuse more often than separate replay listings in v0?
