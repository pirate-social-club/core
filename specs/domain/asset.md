# Asset

Status: draft

Related docs:

- [post.md](./post.md)
- [community.md](./community.md)
- [artist-identity.md](./artist-identity.md)
- [publish-matrix.md](./publish-matrix.md)
- [royalty-graph.md](./royalty-graph.md)
- [monetization.md](./monetization.md)
- [marketplace.md](./marketplace.md)
- [donations.md](./donations.md)
- [replay.md](./replay.md)
- [karaoke.md](./karaoke.md)
- [rights-review.md](./rights-review.md)

## Purpose

This doc defines the optional rights-bearing object that may be created from a post.

It covers:

- storage-backed media identity
- access control for full payloads
- Story publication lifecycle
- derivative linkage
- royalty-graph attachment
- the distinction between social posting and rights registration

## Non-goals

This doc does not define:

- the full legal interpretation of every supported content type
- exact Story Protocol contract calls
- payout execution details
- the final royalty graph schema

## Core Principle

An asset is optional.

Posts are required for Pirate's social product surface.
Assets are only required when a post type or policy needs explicit rights-bearing behavior.

## Canonical IDs

Assets use opaque app-issued IDs.

Examples:

- `asset_id = ast_01...`
- `post_id = pst_01...`

## V0 Asset Shape

Suggested v0 fields:

- `asset_id`
- `source_post_id`
- `community_id`
- `creator_user_id`
- `asset_type`
- `content_ref`
- `content_hash`
- `metadata_ref` nullable
- `karaoke_ready`
- `karaoke_package_ref` nullable
- `analysis_result_ref` nullable
- `rights_basis`
- `access_mode`
- `publication_state`
- `story_ip_id` nullable
- `story_nft_contract` nullable
- `story_nft_token_id` nullable
- `royalty_graph_id` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `asset_type`
  - `text`
  - `image`
  - `audio`
  - `video`
  - `mixed`
- `content_ref`
  Pointer to the stored content blob or canonical content package
- `content_hash`
  Content-addressed hash used to identify the payload
- `access_mode`
  - `public`
  - `locked`
- `publication_state`
  - `draft`
  - `story_requested`
  - `story_published`
  - `story_failed`
  - `withdrawn`

Notes:

- `source_post_id` is required because every asset originates from exactly one post
- `community_id` is intentionally denormalized for read performance in v0 because asset queries will commonly be community-scoped; the source of truth remains `source_post_id -> posts.community_id`, and the stored value must match it
- `analysis_result_ref` may point to the same shared media-analysis record referenced by the source post
- `analysis_result_ref` is a foreign key to a shared `media_analysis_results` record that stores the full ACRCloud response, match metadata, and the final upload-outcome decision
- `rights_basis` is copied from the source post at asset creation time, becomes immutable on the asset row, and must match the source post's declared basis
- `access_mode` is the source of truth for whether the full asset payload is public or gated
- `story_nft_contract` and `story_nft_token_id` are populated only when the asset is minted and registered through a Story-compatible NFT collection
- donation participation does not live on the asset row in v0; it is a listing-level commerce choice
- `karaoke_ready` is meaningful mainly for song assets in v0
- `karaoke_ready` should transition to `true` only when `karaoke_package_ref` contains all required refs (lyrics, instrumental track, vocal track); it is `false` by default and is not set by composer completeness
- `karaoke_package_ref` points to a structured karaoke package containing refs such as lyrics, instrumental track, vocal track, and optional timed-lyric metadata
- karaoke readiness is determined by `karaoke_package_ref` completeness and may be achieved through async enrichment after initial publication (see karaoke.md for the staged enrichment model)

## Storage And Content

Asset content should be stored separately from the app row.

Recommended v0 pattern:

- content blob stored in Filebase/IPFS or equivalent
- app row stores references and hashes
- Story publication, if requested, uses the stored content package as input
- song assets may also carry supplementary package references for lyrics, instrumental tracks, and vocal tracks needed by karaoke and analysis flows
- karaoke readiness belongs on the song asset/package layer rather than on the social post row
- `karaoke_ready` is determined by `karaoke_package_ref` completeness and may be achieved asynchronously after the asset is created; stems and timed lyrics do not need to be present at asset creation time
- `karaoke_package_ref` is the recommended v0 home for karaoke-specific refs rather than scattering those refs directly across the top-level asset row

Explicit storage rule:

- Pirate DB stores metadata, refs, hashes, and analysis state
- Pirate DB does not store large media binaries as canonical asset payloads
- public social text may still live in the app DB when no separate rights-bearing text asset is created
- when text becomes a rights-bearing asset, Pirate should store canonical refs and hashes for that asset just as it does for media

This allows Pirate to:

- serve social posts without blocking on Story
- preserve content-addressed history
- keep publication jobs async

Feed/rendering note:

- when an asset is `access_mode = locked`, the source post may still expose preview media via `media_refs`
- the full payload remains attached to the asset and is accessed through the asset's delivery/access path

## Access Control

`access_mode` controls whether the full asset payload is public or gated.

V0 values:

- `public`
- `locked`

Rules:

- `public` assets may expose their full payload directly through normal asset delivery
- `locked` assets must gate access to the full payload
- the post may still remain publicly visible even when the asset is locked
- feed previews and thumbnails should remain derivable from the post layer where product policy allows it

Implementation note:

- Story CDR is the preferred implementation primitive for encrypted/gated payloads on Story
- Pirate should prefer Story-native access-control and encryption primitives over rolling its own encryption stack
- CDR is not a required dependency for every asset in v0; it is primarily relevant when `access_mode = locked`

## Locked Payload Shape

`access_mode = locked` uses one delivery architecture across supported asset types.

Core rule:

- one asset version maps to one locked delivery object and one entitlement class
- the locked-delivery contracts are media-type agnostic
- the contracts do not distinguish between audio, video, text, or image bytes
- what changes by asset type is the payload format and the client behavior after decryption

Recommended v0 locked payload expectations:

- `text`
  - the locked payload should contain the full sellable text document or structured text package
  - the source post may show title, excerpt, or teaser text publicly
  - the full paid text should not rely only on the public post body stored in the app DB
- `image`
  - v0 commerce should support single-image locked assets
  - the locked payload should contain the full-resolution image file
  - the source post may expose preview-safe derivatives such as thumbnails or compressed previews
- `audio`
  - the locked payload should contain the audio file or audio package intended for buyer access
- `video`
  - the locked payload should contain the video file intended for buyer access
  - v0 may use a simple download-then-play client path even though the entitlement architecture is the same as audio
  - v0 should not support playable public teaser clips for locked video assets by default; public metadata and poster-style presentation are sufficient

Deferred v0 posture:

- multi-image gallery sales are deferred from the initial commerce surface
- gallery delivery may later use a packaged blob or a manifest-style payload, but v0 does not need to standardize that yet
- replay still uses the same locked entitlement architecture, but replay playback behavior is specified separately in [replay.md](./replay.md)

## Story Publication

Story publication is the process that turns an asset into a formally published rights-bearing object.

Recommended v0 rules:

- audio assets sourced from `song` posts must publish to Story
- assets sourced from `song` posts with `song_mode = remix` must publish to Story and require upstream references
- `text`, `image`, and `video` assets may publish to Story when the author opts in

`story_ip_id` is nullable until publication succeeds.

Publication should be asynchronous.

Failure rules:

- Story publication failure must not delete the source post
- Story publication failure should move the asset to `publication_state = story_failed`
- the user may retry or abandon publication subject to later policy

## Story Collection Strategy

Story publication should use Story's standard NFT-plus-IP registration flow.

Recommended v0 posture:

- Pirate uses Story's existing protocol and periphery flows rather than inventing a custom asset protocol
- Pirate should manage one small number of Pirate-controlled NFT collections for published assets
- Pirate should not create one Story NFT collection per club in v0

Implications:

- club identity remains an app-level concept
- Story collection layout is an implementation concern, not the source of club identity
- club affiliation is carried in Pirate metadata, app records, and Story metadata references rather than by minting a separate collection for every club

This keeps the Story-side asset model simple while still allowing:

- song assets to be minted and registered on Story
- derivative linkage and royalty behavior to remain Story-native
- future dedicated collections for major artists or special programs if needed later

## Rights Basis

Assets inherit `rights_basis` from their source post at creation time.

This doc does not redefine that enum's meanings.

See [post.md](./post.md) for the canonical meanings of:

- `original`
- `derivative`
- `attribution_only`

Rules:

- the asset stores an immutable snapshot of `rights_basis`
- the source post remains the canonical home of the enum definition
- asset creation must fail if the copied `rights_basis` is incompatible with the asset type or upload analysis outcome

## Derivative Linkage

Some assets require or allow upstream references.

Suggested v0 linkage shape:

- `asset_derivative_links`
  - `asset_derivative_link_id`
  - `asset_id`
  - `upstream_asset_id`
  - `relationship_type`
  - `created_at`

Suggested `relationship_type` values:

- `remix_of`
- `references_song`
- `inspired_by`
- `samples`

Important:

- some relationship types are legally stronger than others
- `remix_of` and `samples` are closer to legal derivative concepts
- `references_song` and `inspired_by` may be social or attribution-oriented references
- consumers must not assume every derivative link implies a strong legal royalty edge

Rules:

- remix assets require at least one upstream link
- not every derivative link automatically implies a strong legal royalty edge

## Royalty Graph Attachment

An asset may optionally attach to a royalty graph.

That graph should be treated as a separate concern from the asset row itself.

This matters because:

- not every asset needs revenue sharing
- some edges are legally strong
- some edges are club-defined attribution or sharing norms

Recommended v0 rule:

- only assets, not raw posts, attach directly to royalty graphs

## Automated Analysis Relationship

Automated analysis happens before or alongside asset creation.

Its outputs may influence:

- whether an asset can claim `original`
- whether an upstream reference is required
- whether Story publication should be blocked or reviewed

ACRCloud should be the primary v0 audio-identification provider for audio-bearing assets and posts.

## On-chain vs Off-chain

Recommended v0 split:

- asset rows live in the app DB
- content blobs live in Filebase/IPFS or equivalent
- Story publication is optional except where required by post type policy
- Story identifiers are attached after publication succeeds
- Story registration should use standard Story-compatible NFT collection flows

## API Implications

Likely first endpoints:

- `POST /assets`
- `GET /assets/{asset_id}`
- `POST /assets/{asset_id}/publish-to-story`
- `POST /assets/{asset_id}/derivative-links`
- `GET /assets/{asset_id}/royalty-graph`

## Open Questions

- Should Pirate allow asset creation only during initial post composition, or also as a later opt-in after the post is already published?
- Which derivative relationship types should become first-class in v0 versus stored in a more generic edge model?
- When should Pirate treat a detected ACRCloud match as a hard block versus a review requirement?
