# Artist Catalog

Status: draft

Related docs:

- [artist-identity.md](./artist-identity.md)
- [guild.md](./guild.md)
- [asset.md](./asset.md)
- [scrobbles.md](./scrobbles.md)
- [questions.md](./questions.md)

## Purpose

This doc defines Pirate's artist and track catalog model.

It covers:

- artist-linked guild bootstrap
- canonical versus enrichment metadata sources
- track identity
- guild-creation enrichment jobs
- pre-registration versus lazy registration

## Non-goals

This doc does not define:

- full search ranking
- full external crawler architecture
- exact MusicBrainz or Genius API clients
- exact subgraph indexing strategy

## Core Principle

Pirate should treat:

- MusicBrainz as canonical identity support
- Genius as enrichment and question-generation support
- Pirate as the approval, routing, and guild authority

The catalog should be good enough to support:

- day-one scrobbling
- day-one artist guild pages
- day-one question generation

without blocking guild creation on large background imports.

## Artist-Linked Guilds

An artist-linked guild is any guild with:

- `guild.artist_identity_id != null`

Examples:

- `/g/kanye`
- `/g/@kendrick`
- `/g/肯伊`

This does not imply:

- artist governance participation
- canonical song upload rights
- official endorsement

Those remain governed by the existing guild and artist-governance specs.

## Source Authority

### MusicBrainz

Use MusicBrainz as canonical identity support for:

- stable artist IDs
- recording MBIDs where available
- alias handling
- long-term reconciliation
- mergeability

### Genius

Use Genius as:

- lyrics and annotation enrichment
- question-generation source material
- candidate discovery source
- optional image or reference-link source

Do not use Genius as canonical identity authority.

### Pirate

Use Pirate as:

- routing authority
- moderation authority
- guild approval authority
- final display and alias policy authority

## Track Identity

Pirate should keep the working 3-kind track identity model already proven in `pirate/`.

Recommended identity kinds:

- `mbid`
  Canonical recording MBID-backed identity when available
- `story_ip`
  Story IP-backed identity for Pirate-published assets
- `metadata_hash`
  Fallback identity derived from trusted metadata when no stronger ID exists yet

Suggested v0 track fields:

- `track_id`
- `track_kind`
- `recording_mbid` nullable
- `story_ip_id` nullable
- `asset_id` nullable
- `guild_id` nullable
- `publisher_ref` nullable
- `title`
- `artist_display_name`
- `album` nullable
- `duration_ms` nullable
- `audio_fingerprint_ref` nullable
- `cover_ref` nullable
- `lyrics_ref` nullable
- `genius_song_id` nullable
- `artist_identity_ids_json` nullable
- `metadata_hash`
- `status`
- `created_at`
- `updated_at`

Suggested meanings:

- `track_kind`
  - `mbid`
  - `story_ip`
  - `metadata_hash`
- `status`
  - `draft`
  - `active`
  - `deprecated`

Rules:

- `track_id` is Pirate's stable canonical track identifier used by scrobbles and question generation
- a track should use MBID-backed identity when a strong match exists
- a Pirate-published song asset may still map to a Story-IP-backed track identity when MBID is absent
- unknown or unresolved tracks may fall back to metadata-hash identity without blocking use
- `artist_display_name` is a denormalized display convenience for product read surfaces
- `audio_fingerprint_ref` is optional reconciliation support, not canonical identity

Implementation note:

- `artist_identity_ids_json` is acceptable as a directional v0 spec shortcut, but the eventual implementation should prefer a join table such as `track_artists` rather than a permanent JSON-array dependency

## Guild-Creation Bootstrap

Artist-linked guild creation should enqueue an artist metadata enrichment job.

Recommended v0 behavior:

1. create the guild and namespace immediately
2. attach `artist_identity_id` if known or resolvable
3. enqueue `artist_metadata_enrichment`
4. return success to the creator without waiting for the enrichment job

The enrichment job may then:

- resolve or confirm the MusicBrainz artist MBID
- fetch Genius artist ID and aliases when available
- populate `guild_reference_links`
- fetch or cache cover-art and reference metadata
- fetch a first-pass known track list
- pre-register known tracks into Pirate's track table

This gives artist guilds better day-one scrobble and question-generation UX without making guild creation fragile.

## Pre-Registration vs Lazy Registration

Pirate should support both.

### Pre-Registration

Good for:

- artist-linked guilds
- high-signal top tracks
- canonical song pages
- better early question generation

### Lazy Registration

Still required for:

- long-tail music
- unknown tracks
- user listening before enrichment completes
- tracks that do not reconcile cleanly yet

Recommended v0 rule:

- pre-register what Pirate knows with high confidence
- lazily register the rest on demand

## Question Generation Support

The artist catalog should be useful for question generation.

Good question-generation inputs include:

- linked artist identities
- canonical display names and aliases
- lyrics refs
- annotation refs
- known tracks with MBIDs
- guild-linked reference links

This is why artist-catalog enrichment is worth running at guild creation time for artist-linked guilds.

## API And Job Implications

Likely v0 background job types:

- `artist_metadata_enrichment`
- `track_reconciliation`
- `catalog_track_preregistration`

Likely API surfaces:

- read guild-linked artist metadata
- inspect enrichment status
- resolve or create track records
- fetch track metadata for song/scrobble/question surfaces

## Open Questions

- What minimum confidence is required before a metadata-hash track is upgraded to an MBID-backed identity?
- Should Pirate pre-register only top tracks for artist-linked guilds, or a broader catalog slice?
- When MusicBrainz and Genius disagree on naming, which fields become public display defaults versus internal enrichment only?
