# Artist Identity

Status: draft

Related docs:

- [guild.md](./guild.md)
- [namespace.md](./namespace.md)
- [artist-catalog.md](./artist-catalog.md)

## Purpose

An artist identity is Pirate's canonical internal record for a known artist.

It exists so guilds can optionally link to a stable artist object without treating route text or external platform IDs as the canonical identity.

## Core Principle

Pirate uses an internal `artist_identity_id` as the canonical identifier.

External identifiers attach to that internal record.

Examples:

- `artist_identity_id = art_01...`
- `musicbrainz_artist_mbid = b7ffd2af-...`

## V0 Fields

- `artist_identity_id`
- `musicbrainz_artist_mbid` nullable unique
- `canonical_name`
- `canonical_name_source`
- `claim_state`
- `metadata`
- `created_at`
- `updated_at`

`claim_state` values in v0:

- `none`
- `claimed`
- `disputed`

Meanings:

- `none`: no accepted claim relationship has been established yet
- `claimed`: a claim relationship has been accepted somewhere in Pirate's review or governance flow
- `disputed`: the claim relationship is under dispute or has been challenged

## MusicBrainz

MusicBrainz is first-class but optional in v0.

Rules:

- if known, store `musicbrainz_artist_mbid` on the artist identity record
- guilds link to `artist_identity_id`, not directly to MBID
- the absence of an MBID does not prevent a guild from existing

## Metadata

`metadata` is nullable in v0 and defaults to an empty object when omitted.

It is a JSON object reserved for low-risk descriptive fields that do not deserve first-class columns yet.

V0 does not require any specific keys inside `metadata`.

## Guild Linkage

An artist-linked guild stores:

- `guild.artist_identity_id = artist_identities.artist_identity_id`

This allows:

- one guild to link to a known artist
- future multiple guilds to link to the same artist identity
- later addition of more external IDs without changing guild identity

Artist identity linkage does not by itself mean the artist participates in governance.

Guild-side governance participation and proof evidence are defined in [guild.md](./guild.md).

## Open Questions

- What proof standard upgrades artist claim state from `none` to `claimed`?
- Which external IDs besides MusicBrainz should become first-class in v0 or v1?
