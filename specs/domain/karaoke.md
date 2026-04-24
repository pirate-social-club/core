# Karaoke

Status: current working spec

Related docs:

- [asset.md](./asset.md)
- [post.md](./post.md)
- [marketplace.md](./marketplace.md)
- [community.md](./community.md)

## Purpose

This doc defines karaoke as a song-asset capability in Pirate v2.

It covers:

- karaoke-ready song asset requirements
- entitlement and unlock behavior
- the relationship between karaoke and normal social posts

## Non-goals

This doc does not define:

- vocal scoring systems
- Duolingo-style study loops
- karaoke session matchmaking
- audio DSP implementation details

## Core Principle

Karaoke is primarily an asset capability, not a top-level post type.

A song post can be published without karaoke support. Karaoke readiness is a later enrichment stage that activates when the necessary package data is complete.

Recommended v0 split:

- a song post may be published with audio + lyrics alone
- stems (instrumental, vocal) and timed lyrics are optional at post-creation time
- the song asset owns karaoke readiness and karaoke package refs
- `karaoke_ready` transitions to `true` only when `karaoke_package_ref` is sufficiently complete
- posts may expose karaoke UI or discovery only when the underlying asset is `karaoke_ready`
- later karaoke sessions/challenges may exist, but they should remain thin wrappers over karaoke-ready assets

This separation means:
- posting a song is lightweight and does not require stem uploads
- karaoke readiness is an enrichment outcome, not a publishing prerequisite
- the karaoke package can be assembled incrementally: stems uploaded later, timed lyrics derived via forced alignment

## Karaoke-Ready Asset Requirements

A karaoke-ready song asset should carry enough package data to support lyric-led playback.

Required for `karaoke_ready = true`:

- lyrics ref
- instrumental track ref
- vocal track ref

Recommended optional v0 data:

- timed lyric ref
- cover art ref
- language metadata

Interpretation:

- lyrics are required for a good karaoke experience
- instrumental and vocal refs are required for the existing stem-based karaoke flow
- timed lyrics improve UX but may be optional in the first pass

### Staged Enrichment Model

Karaoke readiness does not need to be present at post-creation time. The enrichment stages are:

1. **Post published**: song is live with audio + lyrics. `karaoke_ready` is `false`. `karaoke_package_ref` may be `null`.
2. **Stems attached**: instrumental and/or vocal stems are uploaded or derived. `karaoke_package_ref` is created or updated with stem refs.
3. **Karaoke ready**: when all required refs (lyrics, instrumental, vocal) are present in the karaoke package, `karaoke_ready` transitions to `true`.

This means a song can be published, consumed, and shared without karaoke support. Karaoke activates later when the enrichment pipeline completes.

### Forced Alignment For Timed Lyrics

Timed lyrics (word-level or line-level timestamps synchronized to audio) significantly improve the karaoke experience. In v0, timed lyrics are optional but recommended.

Recommended v0 approach for deriving timed lyrics:

- the platform may run forced alignment on a song asset that has audio + plain lyrics
- forced alignment takes plain lyrics text and audio as inputs and produces timestamped lyric segments
- the resulting timed lyric ref is stored alongside the other karaoke package data
- forced alignment is an async enrichment step, not a post-creation requirement
- forced alignment may be triggered automatically when both audio and lyrics become available, or on explicit request

This is not yet implemented in Pirate. It is specified here so the asset model correctly allows timed lyrics to be populated after initial publication.

The karaoke package schema should accommodate:

- `lyrics_ref` — required for `karaoke_ready`
- `instrumental_ref` — required for `karaoke_ready`
- `vocal_ref` — required for `karaoke_ready`
- `timed_lyric_ref` — optional, may be derived via forced alignment
- `cover_art_ref` — optional
- `language` — optional language metadata

## Asset Relationship

Karaoke capability belongs on the song asset, not the post row.

Recommended v0 additions in interpretation:

- a song asset may be `karaoke_ready`
- the karaoke package is part of the asset's stored refs and hashes
- the same asset may support normal playback and karaoke playback

This keeps karaoke compatible with existing rights, storage, and entitlement rules.

## Access And Unlock

Karaoke should reuse the normal marketplace and entitlement model.

Recommended v0 behaviors:

- free songs may expose karaoke for free
- paid songs may require purchase before karaoke package access is granted
- the unlock should follow the same listing/purchase/entitlement path as the underlying song asset

Rules:

- do not invent a separate karaoke payment rail in v0
- karaoke access should resolve from the same entitlement logic that governs the relevant song asset or listing
- if karaoke package delivery is locked, it should follow the asset's locked-payload rules

## Relationship To Posts

Posts remain the social surface around the song.

Examples:

- a song post may expose a karaoke CTA
- comments and discussion stay on the song post
- later karaoke challenge/session posts may reference the karaoke-ready asset

Recommended v0 rule:

- karaoke does not require a dedicated top-level `post_type`

## Community Interaction

Communities may choose how prominently karaoke is surfaced.

Examples:

- artist communities may feature karaoke-ready official songs
- fan communities may run karaoke challenges or events later

Community policy may later control:

- whether karaoke is highlighted in feed or profile views
- whether karaoke challenges award special community karma

## Open Questions

- When Pirate introduces karaoke sessions or challenges, should those be modeled as thin post-linked wrappers or as room/session objects similar to livestreams?
- Should forced alignment run automatically on all song assets with audio + lyrics, or only on explicit creator opt-in?
- What forced-alignment provider should Pirate use for timed-lyric derivation?
