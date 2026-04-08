# Live Segments

Status: draft

Related docs:

- [livestream.md](./livestream.md)
- [performance.md](./performance.md)
- [replay.md](./replay.md)
- [rights-review.md](./rights-review.md)
- [artist-catalog.md](./artist-catalog.md)
- [royalty-graph.md](./royalty-graph.md)
- [monetization.md](./monetization.md)

## Purpose

This doc defines how Pirate models song-level structure inside a live performance.

It covers:

- required setlists for live performance
- setlist lifecycle
- live segments
- declared-versus-detected reconciliation
- rights and replay implications

## Core Principle

`live_room` is the event container.

`live_segment` is the song-level unit of declaration, reconciliation, and rights meaning.

Recommended v0 split:

- a room must have exactly one setlist from creation time onward in v0
- a setlist may have many ordered items
- a room may have many segments
- each segment maps to one primary song in v0

This keeps room commerce separate from song-level rights handling.

## Required Setlists

Setlists should be required before a room can actually go live.

Recommended v0 rule:

- room creation must include an initial setlist object
- a host may draft or schedule a room while the setlist is still in `draft`
- a room must not transition to `live` until it has an active setlist
- the host may still edit, reorder, skip, or add songs while live
- requiring a setlist keeps rights handling, replay clearance, and later payout/reporting structured from the start

Interpretation:

- declared setlist = primary source of intent
- ACRCloud = verification and gap-filling
- platform review = exception handler

## Canonical Objects

Suggested v0 `setlists` shape:

- `setlist_id`
- `live_room_id`
- `status`
- `created_by_user_id`
- `created_at`
- `updated_at`
- `finalized_at` nullable

Suggested `setlist` statuses:

- `draft`
- `active`
- `finalized`

Rules:

- exactly one setlist should exist per room in v0
- a room may exist in `scheduled` state while its setlist is still `draft`, but host start should fail until the setlist reaches `active`
- the setlist is mutable while the room is live
- once the room is over and replay/review processing begins, the setlist should be finalized and locked

Suggested v0 `setlist_items` shape:

- `setlist_item_id`
- `setlist_id`
- `sequence_index`
- `title_text`
- `artist_text` nullable
- `declared_track_id` nullable
- `performance_kind`
- `rights_hint`
- `status`
- `notes` nullable
- `created_at`
- `updated_at`

Suggested `setlist_item` statuses:

- `planned`
- `added_live`
- `played`
- `skipped`

Suggested v0 `live_segments` shape:

- `live_segment_id`
- `live_room_id`
- `sequence_index`
- `setlist_item_id` nullable
- `started_at`
- `ended_at` nullable
- `declared_track_id` nullable
- `detected_track_id` nullable
- `analysis_result_ref` nullable
- `top_match_confidence` nullable
- `reconciliation_status`
- `rights_status`
- `performance_kind`
- `created_at`
- `updated_at`

## Meanings

### `performance_kind`

- `original`
- `cover`
- `remix`
- `dj_playback`
- `unknown`

Interpretation:

- this is host-declared or operator-corrected intent, not platform-verified truth by itself
- `dj_playback` should default to stricter review assumptions because it implies playback of an existing recording rather than a purely live original performance

### `rights_hint`

- `community_catalog`
- `story_catalog`
- `third_party`
- `unknown`

Interpretation:

- `rights_hint` is host-declared optimism, not platform clearance
- `rights_hint = community_catalog` means the host believes the work belongs to or is associated with the community catalog
- `rights_hint = story_catalog` means the host believes the work maps to a Story-linked catalog item
- all hints still require reconciliation and rights policy evaluation

### `reconciliation_status`

- `declared_only`
- `detected_only`
- `matched`
- `mismatched`
- `needs_review`

### `rights_status`

- `clear`
- `review_pending`
- `blocked`
- `upstream_refs_attached`

## Declared Track Resolution

`declared_track_id` is enough in v0.

Rules:

- setlist items and segments should point to `declared_track_id` when a canonical track has been resolved
- the setlist editor should default to searching Pirate's canonical songbase / track catalog first
- `title_text` and `artist_text` should be treated as display snapshots or fallback manual metadata, not the primary resolution mechanism
- Story IDs, MBIDs, and other external identifiers should be resolved through the track record rather than duplicated onto the setlist item
- manual text entry remains valid when no canonical track is resolved yet

## Setlist Mutability

The setlist is a living document during live performance.

Recommended v0 rule:

- while the room is `scheduled` or `live`, the host may add, remove, reorder, or annotate setlist items
- once the room ends, the setlist should move to `finalized`
- post-hoc ACRCloud detections that do not match any declared item create segments with `setlist_item_id = null` and `reconciliation_status = detected_only`

## Surprise Songs

Surprise songs should create setlist items, not orphan segments.

Recommended v0 rule:

- when the host adds a surprise song during live, Pirate should create a `setlist_item` with `status = added_live`
- the new segment should link to that setlist item
- truly orphan segments should only come from undeclared ACRCloud detections or missing host action

## Segment Lifecycle

Recommended v0 host flow:

1. host creates the room with an initial setlist
2. host starts a segment when a song begins
3. host ends the segment when the song finishes or moves to the next song
4. Pirate opens the next segment manually or through host action
5. after the room ends, any undeclared detected songs may produce additional post-hoc segments for review

Recommended v0 simplification:

- one segment maps to one primary song
- medleys, mashups, and multi-song blended transitions are deferred
- if a medley occurs, the segment should store the primary track and likely move to `needs_review`

## Reconciliation

ACRCloud should not be the canonical author of the performance timeline.

Recommended v0 rule:

- host actions and setlist state define the declared timeline
- ACRCloud samples from the live mix or replay provide verification and discovery
- Pirate reconciles the declared segment against the detected result

Good outcomes:

- declared track + detected track + same primary match -> `matched`
- declared track + no confident detection -> `declared_only`
- no declaration + detected track -> `detected_only`
- declaration and detection disagree -> `mismatched`
- ambiguous or medley-like case -> `needs_review`

Storage rule:

- the full ACRCloud response should live in `analysis_result_ref`
- `top_match_confidence` stores only the top reconciled match confidence needed for product logic
- the segment row stores the simplified outcome, not the full candidate set

## Replay Clearance Rule

Replay clearance is the conjunction of segment outcomes.

Recommended v0 rule:

- replay may advance to `published` only when every relevant segment is clear enough for publication
- if any segment has `rights_status = review_pending`, replay should remain `review_pending`
- if any segment has `reconciliation_status = needs_review` or `mismatched`, replay should remain `review_pending`
- if any segment is `blocked`, replay should not publish until the blocking issue is resolved
- only when all segments are effectively clear should replay publish

This means replay publication is derived from room-level replay processing plus segment-level rights outcomes.

## Rights And Monetization Boundary

Segments are foundational for rights, but not yet for real-time money routing.

Recommended v0 rule:

- live-room access revenue still follows the room listing plus the guild payout policy
- segments provide the structure for rights review, replay clearance, and future detailed payout logic
- ACRCloud matches or segment detections must not auto-rewrite payout splits in real time

Likely later extension:

- hosts predeclare full setlists before the room starts
- declared tracks create candidate upstream references up front
- ACRCloud verifies or challenges the declared setlist
- accepted segment references later feed segment-aware payout or reporting

## API Shape

Recommended v0 API shape:

- `POST /live-rooms/{id}/setlist`
  - create or replace the full ordered setlist
- `PATCH /live-rooms/{id}/setlist`
  - batch update the ordered setlist during live
- `GET /live-rooms/{id}/setlist`
  - read the current setlist
- `POST /live-rooms/{id}/segments/start`
  - start a segment, optionally linked to a setlist item
- `POST /live-rooms/{id}/segments/{segment_id}/end`
  - end the current segment
- `GET /live-rooms/{id}/segments`
  - read all known segments and reconciliation state

Recommended v0 stance:

- batch setlist updates are preferable to item-by-item CRUD
- individual item CRUD is unnecessary complexity for the first pass
- host start should require that the room already has an active setlist
- `performance_kind` should remain mutable until the segment ends

## Open Questions

- Should Pirate later support larger multi-performer rooms with a separate performer roster object attached to each segment?
- Should post-hoc detected-only segments be visible to the host immediately, or only in the review UI after the room ends?
- When medleys are added later, should Pirate model them as multi-track segments or as segment groups?
