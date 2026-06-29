# Livestream Recording

Status: proposed working spec

Related docs:

- [livestream.md](./livestream.md)
- [replay.md](./replay.md)
- [live-segments.md](./live-segments.md)
- [asset.md](./asset.md)
- [marketplace.md](./marketplace.md)
- [rights-review.md](./rights-review.md)
- [royalty-allocation.md](./royalty-allocation.md)
- [../contracts/locked-asset-delivery.md](../contracts/locked-asset-delivery.md)

## Purpose

This doc defines the capture, storage, post-live publishing, and ownership model for livestream recordings.

It covers:

- how live broadcasts become durable replay media
- where recording files are stored
- when Story CDR is used
- how hosts publish a recording after a live event ends
- how replay ownership and revenue splits differ from live-ticket splits

## Current Product Boundary

Paid livestream access and livestream recording are separate product surfaces.

Paid livestream access means:

- a live room can be created as `access_mode = paid`
- a live ticket listing can be sold
- live-room viewer access can be gated by purchase entitlement
- the host and viewers can attach to the broadcast rail

Paid livestream access does not imply:

- the room is recorded
- the recording is retained
- a replay asset exists
- replay ownership has been confirmed
- replay access is available before a replay has been retained, processed, reviewed, and published
- replay commerce is configured

Recording and replay publishing must be built as a separate post-live workflow.

Default replay access policy still follows [replay.md](./replay.md): when a paid live room retains and publishes a replay, v0 should default to reusing the original live-ticket entitlement unless the publisher explicitly chooses separate replay commerce.

## Core Principle

Recording enablement and replay publication are separate creator decisions.

Recommended v0 rule:

- communities should be able to choose whether recording is available by policy
- room creation should expose a simple `Record this livestream` toggle when recording is available
- recording should default from community policy, not from paid/free access mode alone
- the host should decide whether to record before going live
- the host should not have to decide replay commerce, replay price, final thumbnail, caption, or ownership edits before going live
- Pirate should capture the live room only when recording is enabled for that room
- after the room ends, Pirate should process the recording into a draft replay asset
- the host should decide whether and how to publish that recording after reviewing it

This keeps the live authoring flow small while avoiding surprise permanent recordings. It also avoids forcing creators to make ownership, rights, and pricing decisions before a performance exists.

## Creator Flow

Recommended v0 flow:

### Before Live

- host creates or schedules a live room
- host sees a `Record this livestream` toggle when community policy allows recording
- toggle copy should make clear that Pirate creates a private replay draft after the stream ends
- no replay price, replay listing, replay caption, final thumbnail, or split editing is required before going live

### During Live

- if recording is enabled, Pirate starts provider-side recording when the room enters `live`
- host/moderator surfaces may show a recording indicator
- viewer access remains governed by the live room's normal access mode and ticket entitlement

### After Live

- room ends
- Pirate stops recording and begins ingest
- anchor post shows `replay_status = processing`
- host sees a private replay draft once processing succeeds
- host previews the recording
- host edits title, caption, and thumbnail
- host chooses replay access: free, included with original ticket, or separately paid
- host confirms replay ownership and revenue split
- required approval and rights review gates run
- replay publishes only after required gates pass

The important split is:

- before live: decide whether to record
- after live: decide whether and how to publish the recording

## Capture And Storage Model

Agora is the capture rail, not the durable storage system.

Recommended v0 flow:

1. Host attaches and the room enters `status = live`.
2. Pirate starts an Agora Cloud Recording session server-side for the room channel.
3. Agora writes raw recording output to a storage bucket controlled by Pirate.
4. When the room ends, Pirate stops and queries the recording session.
5. Pirate ingests the produced files.
6. Pirate stores the durable replay media in Filebase.
7. Pirate creates or updates a draft replay asset linked to the live room.

Durable replay files should not be treated as "stored on Agora."

Agora may temporarily produce capture artifacts, but Filebase should be Pirate's durable media storage target for replay.

## Free vs Locked Replay Storage

Filebase is storage. Story CDR is access control and key recovery.

Recommended v0 storage split:

### Free Replay

- store playable replay media on Filebase
- media may be public or served through Pirate's API/CDN
- do not use Story CDR by default
- access follows normal post/community visibility rules

Flow:

`recording -> processing -> Filebase playable media -> replay_status = published`

### Included-With-Live-Ticket Replay

- store encrypted replay media on Filebase
- use Story CDR for recovery material
- read condition should accept the original live-ticket entitlement, or a replay entitlement minted from it
- replay is still a locked asset even if buyers do not pay again

Flow:

`recording -> processing -> encrypt -> Filebase ciphertext -> CDR recovery payload -> original live entitlement grants read`

### Separately Paid Replay

- store encrypted replay media on Filebase
- use Story CDR for recovery material
- create a replay listing
- buyer must hold the replay purchase entitlement before CDR read/decryption

Flow:

`recording -> processing -> encrypt -> Filebase ciphertext -> CDR recovery payload -> replay listing -> replay entitlement grants read`

## Relationship To Paid Songs

Locked replay delivery should follow the same architecture as locked paid songs.

Existing locked song delivery uses:

- encrypted media payload stored externally
- Filebase object storage for the ciphertext
- Story CDR for data-key recovery
- entitlement-gated CDR reads for buyers
- local playback after the client obtains the data key and decrypts the media

Replay should reuse this locked-asset delivery pattern rather than creating a parallel key-delivery system.

The difference is product lifecycle:

- songs are uploaded and published directly by the creator
- replay media is produced by a live recording pipeline, then reviewed and published after the event

## Locked Delivery Dependency

Locked replay must not ship until owner and moderator reads work correctly through the CDR delivery path.

Known dependency:

- paid-song locked delivery already supports buyer entitlement reads through token-gated Story CDR
- creator/moderator draft reads require an owner/moderator-capable read condition
- if owner/moderator reads are routed through a token-gated condition that ignores signed auxiliary access data, hosts may be unable to preview or re-download their own locked replay

Hard requirement before locked replay:

- implement or adopt a composite CDR read condition that supports both durable buyer entitlement reads and signed owner/moderator reads
- update [../contracts/locked-asset-delivery.md](../contracts/locked-asset-delivery.md) with that condition as the required locked-delivery path
- verify creator, moderator, buyer, and non-buyer reads in staging/testnet

This is a release blocker for:

- included-with-live-ticket replay
- separately paid replay
- locked replay draft preview

## Post-Live Publishing UX

Replay publishing should be a post-live flow.

Recommended v0 host flow:

1. Host ends the livestream.
2. Anchor post shows `replay_status = processing`.
3. Host sees a private "Recording processing" state.
4. When processing completes, Pirate creates a draft replay.
5. Host opens a replay publishing screen.
6. Host previews the recording.
7. Host confirms or edits replay metadata.
8. Host confirms replay access policy.
9. Host confirms replay ownership and revenue splits.
10. Pirate runs or completes rights review.
11. Replay moves to `published`, `review_pending`, or `failed`.

Recommended v0 replay publishing fields:

- replay title
- replay caption or description
- thumbnail / preview image
- duration
- access policy
- replay price, if separately paid
- included-with-live-ticket toggle, if eligible
- ownership and revenue allocations
- rights review state

The replay caption should be separate from the original live-room description.

The live-room description is event copy. It may say things like "Q&A after the set" or "join us tonight." That copy should not be blindly reused as replay copy.

## Thumbnail Policy

Replay thumbnails should be replay-specific but may default from the live room.

Recommended v0 order:

1. host-selected replay thumbnail
2. generated recording preview frame
3. original live-room cover

The live-room cover is a reasonable default because creators may intentionally upload event art. It should not be the only long-term model.

The replay read model should support a `preview_ref` or equivalent replay-specific media reference.

## Replay Ownership

Livestream ownership and recording ownership are not always the same thing.

Live access revenue is about access to the live performance. Recording revenue is about access to a fixed replay asset.

In music, the live performance and the recorded master can have different economics. Examples:

- performers split live-ticket revenue
- a label owns or participates in the recording/master
- a venue has recording rights but not live performance revenue
- a guest performer receives a live share but not replay ownership
- a collaborator receives replay royalties but did not sell live access

Therefore replay must be modeled as a first-class asset with its own ownership and allocation state.

Recommended v0 rule:

- create replay ownership/allocation records on the replay asset
- default replay allocations from the live room's performer allocations only as a convenience
- allow the host or authorized publisher to propose replay allocations before publication
- require required-party approval before publishing allocations that differ from the live split
- do not assume live-ticket performer allocations are legally or economically correct for the replay

## Replay Allocation Approval

Replay allocation editing needs a consent model.

Problem:

- live-room performer allocations are explicit at creation time
- a host-only post-live editor could otherwise rewrite replay economics after the performance
- this is especially risky for duets, guest performances, venues, and label-owned recordings

Recommended v0 rule:

- if replay allocations exactly match live-room performer allocations, they may auto-populate as a draft default
- if replay allocations differ from the live split, affected Pirate users must approve before paid replay publication
- if the community/club has policy authority over recordings, the club owner or authorized publisher must approve material replay allocation changes
- external rightsholders must be represented by a payable identity before paid publication, or their share must be held/blocked according to policy

Suggested approval states:

- `not_required`
- `pending`
- `approved`
- `rejected`
- `expired`

Replay may be saved as a draft while approvals are pending. Paid replay publication should be blocked until required approvals resolve.

## External Payable Identity

`external_party_ref` is not enough by itself.

External rightsholders such as labels, venues, or management companies may not be Pirate users. If they participate in replay ownership or revenue allocation, Pirate still needs a settlement target.

Recommended v0 rule:

- an external replay allocation must resolve to a payable identity before paid replay publication
- payable identity may be a verified wallet attachment, payout account, or future rightsholder profile
- if payable identity is missing, the replay may remain draft or publish only under a policy that escrows/blocks the external share

Open implementation choices:

- require external parties to onboard before paid publication
- allow publisher-managed escrow for unresolved external shares
- disallow external-party allocations in v0 paid replay until payable identity support exists

## Revenue Splits

There are at least two separate split domains:

### Live Ticket Split

The live ticket split applies to live-room access.

Inputs:

- room listing
- community payout policy
- live-room performer allocations
- donation sidecars, if enabled

Output:

- live event revenue allocation

### Replay Asset Split

The replay split applies to recording/replay access.

Inputs:

- replay asset ownership
- replay asset allocations
- replay listing, if separately sold
- included-with-ticket policy, if applicable
- royalty graph / rights review outputs

Output:

- replay revenue allocation

Replay revenue should not be routed only through raw room-level split fields.

If recognition or rights review identifies upstream works, replay publication and replay revenue settlement may need royalty-graph-backed treatment.

## Rights Review

Recording and recognition are related but distinct.

Recommended v0 processing:

- capture recording through Agora
- store durable media in Filebase
- run recognition on the live mix or processed replay
- hold replay publication when recognition finds rights-relevant matches
- allow Pirate platform review to resolve `review_pending`

Rights review should be able to block, delay, or condition replay publication without changing the ended live-room lifecycle.

Recommended v0 publication gate:

- paid replay publication must wait for recognition to complete
- free replay publication should also wait for recognition unless the room is explicitly exempt by policy
- if recognition fails due to infrastructure, replay should remain `processing` or `review_pending`, not silently publish

Deferred option:

- if Pirate later allows early publication before recognition completes, the system must support retroactive suppression, buyer notification, refund or credit handling, and settlement correction when a late match requires review or takedown

## Data Model Additions

The existing `live_rooms.replay_status` flag is not enough.

Recommended v0 additions:

### Live Room

- `replay_asset_id` nullable
- `replay_listing_id` nullable
- `replay_status`

### Recording Session

Suggested `live_room_recordings` fields:

- `recording_id`
- `community_id`
- `live_room_id`
- `provider`
- `provider_resource_id`
- `provider_session_id`
- `status`
- `started_at`
- `stopped_at`
- `raw_artifact_ref`
- `failure_reason`
- `created_at`
- `updated_at`

Suggested statuses:

- `starting`
- `recording`
- `stopping`
- `captured`
- `ingesting`
- `failed`

### Status Transitions

Recording-session status and replay status should move together, but they are not the same state machine.

Recommended v0 transition map:

| Event | Recording status | Replay status |
| --- | --- | --- |
| Host goes live, recording requested | `starting` | `none` |
| Agora recording active | `recording` | `none` |
| Host ends room, stop requested | `stopping` | `processing` |
| Raw recording captured | `captured` | `processing` |
| Durable Filebase ingest/transcode running | `ingesting` | `processing` |
| Filebase replay asset ready, recognition clear | `captured` | `published` |
| Filebase replay asset ready, recognition needs review | `captured` | `review_pending` |
| Capture/stop/query/ingest failed | `failed` | `failed` |
| Review approves | `captured` | `published` |
| Review rejects or blocks | `captured` | `failed` |

Rules:

- `replay_status = published` requires a replay asset and access policy
- `replay_status = review_pending` requires an explicit review reason
- `replay_status = failed` should keep failure details for creator/support surfaces
- ending a live room should not by itself imply replay availability

### Replay Asset

Replay should reuse the asset model where possible, but must carry replay-specific metadata either on the asset or in a replay child table:

- `replay_asset_id`
- `source_live_room_id`
- `source_recording_id`
- `duration_ms`
- `preview_ref`
- `caption`
- `access_mode`
- `locked_delivery_status`
- `primary_content_ref`
- `locked_delivery_storage_ref`
- `story_cdr_vault_uuid`

### Replay Ownership

Suggested replay allocation fields:

- `allocation_id`
- `replay_asset_id`
- `participant_user_id` nullable
- `external_party_ref` nullable
- `role`
- `share_bps`
- `rights_basis`
- `created_at`
- `updated_at`

The exact table shape may align with the broader royalty allocation model, but replay ownership must not be only implied by `live_room_performer_allocations`.

## API Surfaces

Recommended v0 routes:

- `POST /communities/{community}/live-rooms/{room}/recording/start`
- `POST /communities/{community}/live-rooms/{room}/recording/stop`
- `POST /communities/{community}/live-rooms/{room}/recording/callback`
- `GET /communities/{community}/live-rooms/{room}/replay-draft`
- `PATCH /communities/{community}/live-rooms/{room}/replay-draft`
- `POST /communities/{community}/live-rooms/{room}/replay-draft/publish`
- `GET /communities/{community}/replays/{replay}/access`
- `GET /communities/{community}/replays/{replay}/content`

Exact route names may change, but the product boundary should remain:

- recording capture is infrastructure
- replay draft editing is creator workflow
- replay access is asset/listing/entitlement workflow

## UI Requirements

### Anchor Post / Feed Card

Replay cards should not look like stale event cards.

Recommended feed behavior:

- show title
- show compact metadata: `Ended 1h ago · 48 min`
- hide the original live event description by default
- show replay CTA when published
- show "Buy" for paid replay, not "Get ticket"
- show processing / under-review / unavailable states clearly

### Post Page

The post page may show richer replay context:

- replay player or CTA
- duration
- setlist
- rights/review state
- replay caption, if authored
- comments and discussion

The post page should not blindly reuse pre-event copy as replay copy.

### Host Replay Draft Screen

The host needs a post-live replay publishing screen.

Minimum v0 controls:

- preview recording
- choose thumbnail
- edit title
- edit replay caption
- choose access policy
- set replay price if separately paid
- confirm ownership/revenue split
- submit for publish/review

The ownership step must show whether allocations match the live split, which approvals are required, and whether every allocation has a payable identity.

## Open Questions

- Should recording be automatic for all paid live rooms, or configurable per community?
- Should free rooms record by default?
- Should any product tier override the v0 default that retained/published paid-live replay reuses the original live-ticket entitlement?
- What replay ownership roles are required for labels, venues, guests, and external rightsholders?
- What approval rules apply when a host changes replay allocations after a duet or guest performance?
- How should Pirate represent external rightsholders that are not Pirate users yet?
- Should unresolved external shares block paid replay publication or enter escrow?
- Should the replay asset be a normal `asset` row with replay metadata, or a separate `replay_assets` table that references `assets`?
- What is the maximum replay file size before chunked encryption/streaming is required?
- Should paid replay playback support streaming decryption, or is download-then-play acceptable for v0?
- What retention policy applies to raw recordings, failed recordings, unpublished replay drafts, and published replay media?
- What storage-cost policy applies to evergreen Filebase replay media?
- Who can delete a retained recording or published replay, and what happens to buyer access after deletion?
- Should generated preview-frame thumbnails require a media worker/ffmpeg pipeline in v0, or should v0 use host-uploaded thumbnails and live covers only?

## Implementation Priority

Recommended order:

1. Add data model for recording sessions, replay asset linkage, and replay listing linkage.
2. Fix locked-delivery owner/moderator CDR reads with a composite read condition.
3. Build Agora Cloud Recording start/stop/query integration.
4. Store durable recording artifacts in Filebase.
5. Create draft replay asset after recording processing.
6. Build post-live replay publishing UI.
7. Implement free replay playback from Filebase.
8. Add replay-specific ownership/allocation editing, approval states, and payable identity checks.
9. Add rights recognition and make paid replay publication wait for recognition/review.
10. Implement locked replay delivery by reusing paid-song Filebase plus Story CDR architecture.
11. Add staging/testnet E2E covering capture, Filebase storage, owner preview, buyer CDR unlock, non-buyer denial, and replay playback.

## Staging/Testnet Smoke

The focused staging smoke lives in the API service:

```bash
rtk bun run live-room:smoke:paid-staging -- --recording-enabled --replay-access-mode paid
```

This mode should:

- create a paid live room with recording enabled
- verify pre-purchase live access is blocked
- host-attach to start Agora Cloud Recording
- hold the recording window briefly
- end the room
- wait for the recording to ingest into Filebase
- publish the replay
- verify paid replay access exposes a replay listing
- create a paid replay quote without sending funds

Full Base Sepolia settlement and locked replay entitlement verification:

```bash
rtk bun run live-room:smoke:paid-staging -- --recording-enabled --replay-access-mode paid --settle-purchase
```

`--replay-access-mode free` verifies Filebase playback without Story CDR. `--replay-access-mode included_with_ticket --settle-purchase` verifies that the original live-ticket entitlement unlocks the locked replay through Story CDR.
