# Downloadable Assets And Learning Core

Status: proposed implementation architecture; generic file sales and first-class learning decks are not implemented

Related docs:

- [asset.md](./asset.md)
- [marketplace.md](./marketplace.md)
- [post.md](./post.md)
- [composer.md](./composer.md)
- [publish-matrix.md](./publish-matrix.md)
- [song-study.md](./song-study.md)
- [story-royalty-commerce.md](./story-royalty-commerce.md)

## Purpose

This document defines the implementation boundary for two related product
surfaces:

- selling downloadable files such as CSV, JSON, PDF, ZIP, and other non-media
  digital goods;
- selling or sharing first-class learning decks with deterministic spaced
  repetition.

Both surfaces reuse the existing asset, listing, quote, purchase, entitlement,
and access-decision rails. They do not extend song-specific upload or study
tables with more conditional branches.

## Current State

The current commerce path is reusable after an asset exists:

```text
asset -> listing -> quote -> purchase -> entitlement -> access decision
```

The boundaries before and after that path are specialized:

- `assets.asset_kind` currently permits only `song_audio` and `video_file`;
- `assets.primary_content_ref` is `NOT NULL`, so a generic payload-only asset
  cannot be inserted today;
- post creation permits locked access only for song and video posts;
- Story registration is independently restricted to song and video in the
  control-plane projection constraint, API types, metadata labels, and media
  URI resolution;
- upload intents, storage lookup, MIME validation, and multipart sessions are
  modeled as song artifacts;
- locked delivery accepts a song-artifact kind and buffers the whole plaintext
  before encryption;
- browser delivery assumes playback instead of a typed payload disposition;
- asynchronous publication and its constrained failure codes assume the
  existing post kinds and song/video processing stages;
- post safety fields are required, but no analyzer, moderator-inspection path,
  or takedown policy exists for opaque files or deck cards;
- Song Study review state is keyed directly to song posts, lyric lines,
  exercise types, and languages;
- the current Song Study interval calculation is a versioned heuristic, not a
  reusable canonical FSRS implementation.

The implementation must preserve the reusable middle and replace the
specialized boundaries with content-neutral ports and product adapters.

## Goals

- Add a first-class `file` post and `download_file` asset.
- Preserve filename, MIME type, byte size, checksum, and disposition as
  authoritative payload metadata.
- Reuse current listing, purchase, settlement, entitlement, and access logic.
- Move upload transport and locked-payload preparation behind content-neutral
  interfaces without breaking song or video behavior.
- Add first-class learning decks and cards that may be public or commerce
  locked.
- Add a deterministic, versioned scheduler interface with a canonical FSRS
  implementation for learning decks.
- Preserve current Song Study schedules during extraction.
- Support a community-scoped cross-deck due queue.
- Keep learner attempts and scheduling state private by default.
- Roll out additively across the community fleet with explicit rollback points.

## Non-goals

- Digital-rights management after a buyer downloads plaintext bytes.
- Arbitrary executable uploads.
- Inline rendering of untrusted HTML, SVG, archives, or office documents.
- Multi-file product bundles in the first file-sales release.
- Updating a purchased deck in place in v1.
- Public learner histories, leaderboards, or moderator access to private review
  events.
- Migrating existing Song Study learners to new FSRS parameters as part of the
  generic-core extraction.
- A cross-community authoritative review-state store.
- Rewards or streaks for generic deck study in v1.

## Decisions

### Commerce target

Downloadable files and learning decks are assets. Listings continue to target
`asset_id`; no `file_listing` or `deck_listing` table is introduced.

`purchase_entitlements.entitlement_kind = asset_access` remains the authority
for buyer access. Product-specific services ask the asset-access service for an
authorization decision instead of reimplementing purchase checks.

### New post and asset kinds

The contract adds:

```text
post_type:  file | deck
asset_kind: download_file | learning_deck
```

A `file` post owns exactly one active primary downloadable payload in v1. A
`deck` post owns exactly one immutable published deck version and its canonical
package payload.

### Published deck immutability

A published deck version is immutable. Editing after publication creates a new
draft deck and, when published, a new post and asset. Update rights, paid
upgrades, and rolling subscriptions are deferred until entitlement semantics
for them are explicitly specified.

This keeps a purchase bound to content with a stable hash and prevents review
history from silently changing underneath a learner.

### Story commerce posture

The first paid release stays on the existing Story-native commerce and CDR
delivery lane. That lane is a simulated-money beta in production: settlement
uses Base Sepolia USDC and a nominal one-US-dollar-to-one-WIP conversion, while
rights registration uses Story Aeneid. It is not a real-money general-availability
claim.

A known registration-determinism defect can terminally strand an asset before
sale when a retry conflicts with the original registration-effect request.
Paid file and deck publication must remain disabled until that defect is fixed,
the same-request replay fixture passes, recovery of already stranded state is
verified, and the fixed API is deployed. The launch gate is tracked by
[API issue 625](https://github.com/pirate-social-club/api/issues/625).
Public/free publication has separate
safety, compatibility, and quota gates and does not bypass them. A future
mainnet launch remains subject to the existing mainnet-readiness contract.

After that gate, a paid `download_file` or `learning_deck` asset must meet the
same publication, settlement, and locked-delivery readiness required by the
active marketplace.

Generic asset code must express those requirements through an asset-kind policy
registry. It must not treat every non-video asset as a song.

Story registration uses this metadata contract for generic kinds:

| Asset kind | IP label | `mediaType` | `mediaUrl` | `mediaHash` |
|---|---|---|---|---|
| `download_file` | `digital download` | authoritative payload MIME | public content URL only; `null` while locked | primary verified payload hash |
| `learning_deck` | `learning deck` | `application/vnd.pirate.learning-deck+json` | public canonical-package URL only; `null` while locked | canonical package hash |

The IP metadata JSON always carries the asset ID, asset kind, title, creator
identity already permitted by the Story contract, primary content hash, and
schema version. It never exposes a signed storage URL, CDR key, card answer, or
private download URL. A locked opaque payload is therefore registered by its
stable hash and metadata, not by pretending it has playable song media.

Phase 2 expands every Story kind-constrained surface together: the
`story_registered_asset_projections.asset_kind` control-plane CHECK, Story
registration and metadata type unions, label selection, public media-URI
selection, registration-state guards, derivative-source projections, generated
schema snapshots, and exhaustive kind branches found by the repository audit.
Unknown kinds fail closed; there is no `song`/`video` fallback.

The minimum implementation inventory is a successor to control-plane migration
`0111_control_plane_story_registered_asset_projections.sql`, plus API changes in
`story-royalty-registration-service.ts`, `story-royalty-metadata.ts`,
`story-registration-state.ts`, and `derivative-source-projection.ts`. A
repository-wide exhaustiveness audit is an acceptance gate because generated
schema and hydration/query adapters also carry kind unions; this list is a
floor, not permission to ignore another constrained match.

### Scheduler compatibility

The scheduler boundary supports multiple named implementations:

- `song_heuristic_v1` reproduces current Song Study intervals byte-for-byte;
- `fsrs_6_v1` pins the FSRS-6 formula for deck cards.

Extracting the boundary does not change existing Song Study due dates. Moving
song review state to `fsrs_6_v1` requires a separate reviewed migration with
shadow recomputation and learner-impact analysis.

## Architectural Boundaries

```text
product adapter
  file | deck | song | video
        |
        v
content upload ----> stored content blob ----> asset payload
                                                 |
                                                 v
asset policy ----> listing/purchase/entitlement/access
                                                 |
                                                 v
delivery adapter
  download | app-native deck | audio | video

deck content ----> review item ----> review event ----> review-state projection
                                          |
                                          v
                               versioned scheduler
```

The boundaries have the following ownership:

- a content blob describes stored bytes and their verification state;
- an asset payload attaches verified bytes to an asset with product meaning;
- an asset-kind policy decides whether that asset is publishable and sellable;
- commerce decides whether the caller owns access;
- a delivery adapter decides what the client does with authorized bytes;
- a review item gives the scheduler a stable identity independent of song or
  deck storage.

Generic modules must not import song bundle, song artifact, lyric-line, audio
player, or video-player types.

## Content Blob Model

Content blobs live in the control plane because upload sessions and storage
provider coordinates already live there. They contain no marketplace policy.

Suggested schema:

```sql
CREATE TABLE content_blobs (
  content_blob_id          TEXT PRIMARY KEY, -- cbl_*
  community_id             TEXT NOT NULL,
  uploader_user_id         TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN (
                             'pending_upload','uploaded','verifying','ready',
                             'rejected','failed','cancelled')),
  validation_profile       TEXT NOT NULL,
  declared_filename        TEXT,
  declared_mime_type       TEXT NOT NULL,
  declared_size_bytes      BIGINT CHECK (
                             declared_size_bytes IS NULL OR
                             declared_size_bytes > 0),
  declared_content_hash    TEXT,
  detected_mime_type       TEXT,
  verified_size_bytes      BIGINT,
  verified_content_hash    TEXT,
  storage_ref              TEXT NOT NULL UNIQUE,
  storage_provider         TEXT,
  storage_bucket           TEXT,
  storage_object_key       TEXT,
  storage_endpoint         TEXT,
  gateway_url              TEXT,
  ipfs_cid                 TEXT,
  rejection_code           TEXT,
  claim_kind               TEXT CHECK (claim_kind IS NULL OR claim_kind IN (
                             'asset_payload','song_artifact','deck_import')),
  claim_ref                TEXT,
  claimed_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL,
  updated_at               TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (community_id) REFERENCES communities(community_id),
  FOREIGN KEY (uploader_user_id) REFERENCES users(user_id),
  CHECK ((claim_kind IS NULL) = (claim_ref IS NULL)),
  CHECK (status <> 'ready' OR (
    detected_mime_type IS NOT NULL AND
    verified_size_bytes IS NOT NULL AND
    verified_content_hash IS NOT NULL
  ))
);

CREATE INDEX idx_content_blobs_uploader_created
  ON content_blobs (uploader_user_id, created_at DESC);

CREATE INDEX idx_content_blobs_unclaimed_expiry
  ON content_blobs (status, created_at)
  WHERE claim_kind IS NULL;

CREATE UNIQUE INDEX idx_content_blobs_claim
  ON content_blobs (claim_kind, claim_ref)
  WHERE claim_kind IS NOT NULL;
```

`validation_profile` is a versioned application policy identifier such as
`download_file_v1`, `deck_import_csv_v1`, `primary_audio_v1`, or
`primary_video_v1`. The storage schema does not acquire a new CHECK constraint
for every product kind.

The server treats declared metadata as untrusted. Only detected/verified
metadata becomes authoritative. Hashes use one normalized algorithm and
encoding defined by the API contract; v1 uses SHA-256 hex with a `0x` prefix.

### Upload sessions

Multipart mechanics move to a content-neutral `content_upload_sessions` table
and service. The session records transport state, not domain meaning:

```sql
CREATE TABLE content_upload_sessions (
  content_upload_session_id TEXT PRIMARY KEY, -- cus_*
  content_blob_id           TEXT NOT NULL,
  uploader_user_id          TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN (
                              'created','parts_uploading','completing',
                              'head_verifying','uploaded','aborting','aborted')),
  upload_mode               TEXT NOT NULL CHECK (upload_mode IN
                              ('proxy','direct_multipart')),
  object_key                TEXT NOT NULL,
  provider_upload_id        TEXT,
  part_size_bytes           INTEGER,
  total_parts               INTEGER,
  bucket                    TEXT NOT NULL,
  storage_endpoint          TEXT NOT NULL,
  expires_at                TIMESTAMPTZ NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL,
  updated_at                TIMESTAMPTZ NOT NULL,
  completed_at              TIMESTAMPTZ,
  aborted_at                TIMESTAMPTZ,
  aborted_reason            TEXT,
  FOREIGN KEY (content_blob_id) REFERENCES content_blobs(content_blob_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_content_upload_sessions_active_blob
  ON content_upload_sessions (content_blob_id)
  WHERE status NOT IN ('uploaded','aborted');
```

Only one active session may exist per blob. Part planning, signing, completion,
HEAD verification, cancellation, expiry, and orphan cleanup are shared code.
Validation profiles provide size and MIME policy; they do not replace transport
logic.

Direct multipart intents require a known positive `declared_size_bytes` before
part planning. Proxy intents may leave it `NULL`, matching the current proxy
contract; the proxy enforces its byte limit while reading. Every `ready` blob
has a positive authoritative `verified_size_bytes`, regardless of upload mode.

### Claim and cleanup

An uploaded blob is temporary until a domain object claims it. Claiming is
idempotent by `(claim_kind, claim_ref)` and must verify the same community and
uploader unless an explicit moderator import path applies.

The orphan reaper may delete an unclaimed blob only after its retention window
and only when no active upload session exists. A blob referenced by a community
asset must be claimed before the post-create operation reports success.

Because the content blob and community asset live in different databases, the
claim is a resumable saga step keyed by the post-create idempotency key. Retry
must complete the same claim; it must never allocate a replacement blob.

Reconciliation is bidirectional. The orphan reaper covers an unclaimed blob
without a shard payload. A second sweeper starts from active shard payloads,
verifies the referenced control-plane blob and claim, and idempotently restores
a missing claim when community, uploader, hash, size, and saga identity all
match. A mismatch is quarantined for operator review and cannot publish or
deliver. Metrics distinguish `blob_without_payload`, `payload_without_claim`,
`claim_restored`, and `claim_restore_conflict`.

New object keys are server-generated in disjoint namespaces:

```text
legacy song/video: song-artifacts/{community_id}/{artifact_kind}/{upload_id}/...
generic content:   content-blobs/{community_id}/{content_blob_id}/payload
```

Domain references are typed (`song_artifact:<id>` or `content_blob:<id>`);
readers never resolve an untyped raw `storage_ref`. During backfill, a new blob
row may intentionally alias an existing legacy object coordinate while both
tables are readable, but it records the legacy typed source and creates no new
object at that key. All new writes use the generic namespace, so cross-table
uniqueness is guaranteed by construction rather than an unenforceable SQL
constraint.

## Asset Payload Model

Asset payloads live in the community database beside assets. They snapshot the
metadata required for access and presentation so asset reads do not require a
control-plane join.

```sql
CREATE TABLE asset_payloads (
  asset_payload_id    TEXT PRIMARY KEY, -- apl_*
  asset_id            TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN
                        ('primary','preview','supplementary')),
  payload_version     INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN
                        ('active','superseded','withdrawn')),
  content_blob_ref    TEXT NOT NULL,
  payload_format      TEXT NOT NULL,
  delivery_behavior  TEXT NOT NULL CHECK (delivery_behavior IN
                        ('download','app_native','audio','video')),
  display_filename    TEXT,
  mime_type           TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL CHECK (size_bytes > 0),
  content_hash        TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE,
  UNIQUE (asset_id, role, payload_version),
  CHECK (delivery_behavior <> 'download' OR display_filename IS NOT NULL)
);

CREATE UNIQUE INDEX idx_asset_payloads_active_primary
  ON asset_payloads (asset_id)
  WHERE role = 'primary' AND status = 'active';
```

The initial payload formats are:

- `opaque_file_v1` for a downloadable file;
- `learning_deck_package_v1` for the canonical serialized deck;
- existing audio and video formats represented through their adapters during
  migration.

The Phase 2 `assets` rebuild makes `primary_content_ref` nullable and adds the
kind-bound constraint that `song_audio` and `video_file` still require it.
`download_file` and `learning_deck` writers leave it `NULL` and must create one
active primary `asset_payloads` row in the same community transaction. SQLite
cannot express that cross-table invariant as a CHECK, so the create service,
seeded-upgrade fixture, and integrity audit enforce it. `primary_content_hash`
remains a compatibility snapshot where already populated. Legacy access falls
back to the old columns until backfill is attested complete.

## Asset-Kind Policy Registry

Asset creation, sellability, Story registration, and delivery use one policy
registry keyed by `asset_kind`:

```ts
interface AssetKindPolicy {
  assetKind: AssetKind
  validatePrimaryPayload(payload: AssetPayloadDescriptor): void
  validateCreate(input: AssetCreateInput): void
  assertSellable(input: AssetSellabilityInput): Promise<void>
  storyPublicationRequirement(input: AssetCreateInput):
    | "required"
    | "optional"
    | "none"
  deliveryBehavior: "download" | "app_native" | "audio" | "video"
}
```

The registry replaces default branches such as “video otherwise song.” Every
supported kind has an explicit policy, and an unknown kind fails closed.

Initial rules:

| Asset kind | Primary format | Paid access | Derivative support | Client behavior |
|---|---|---|---|---|
| `song_audio` | song package/audio | locked | existing rules | audio/playback |
| `video_file` | video | locked | existing rules | video/playback |
| `download_file` | `opaque_file_v1` | locked only | none in v1 | save as file |
| `learning_deck` | `learning_deck_package_v1` | locked only | none in v1 | app-native study/export |

A paid file is locked in v1. A public file may be a free download without an
active paid listing. The existing marketplace may still create explicit
license records for public assets, but the file-sales composer does not present
that ambiguous path initially.

The same v1 product rule applies to decks: a paid deck is locked, while a
public deck is free to study. The underlying asset model still supports both
access modes without adding a second commerce path.

## File Validation And Security

`download_file_v1` is an allowlist, not “accept anything.” The initial release
accepts these exact pairs:

| Extension | MIME type | Extra validation | Locked maximum |
|---|---|---|---:|
| `.csv` | `text/csv` | valid UTF-8 | 50 MiB |
| `.tsv` | `text/tab-separated-values` | valid UTF-8 | 50 MiB |
| `.txt` | `text/plain` | valid UTF-8 | 50 MiB |
| `.json` | `application/json` | valid UTF-8 and parseable JSON | 50 MiB |

PDF and ZIP are deliberately outside the initial allowlist. Either may be
added through a new validation-profile version after malware scanning,
quarantine, and archive-bomb policy are operational. Each later format requires
an explicit MIME/extension pair, size limit, download behavior, and security
review.

Rules:

- reject executables, scripts, disk images, and active web content;
- never trust only the browser-supplied MIME type or filename extension;
- reject path separators, control characters, reserved filenames, and empty
  normalized filenames;
- store the original display name separately from the storage object key;
- serve downloadable files with `Content-Disposition: attachment`;
- include an RFC 5987 `filename*` value and a conservative ASCII fallback;
- include `X-Content-Type-Options: nosniff`;
- do not inline HTML, SVG, archives, or office-like formats;
- reject a new upload when detection is ambiguous; use
  `application/octet-stream` only as a defensive response fallback for a
  legacy payload whose authoritative MIME type is unavailable;
- scan or quarantine formats required by platform policy before marking a blob
  `ready`;
- cap locked files at 50 MiB until chunked encryption and browser save behavior
  pass production-readiness tests;
- keep the existing public multipart maximum separate from the paid locked-file
  limit.

CSV formula-like cells are bytes in a sold file and are not executed by Pirate.
The deck-import parser treats them as text and never evaluates formulas.

### Safety, inspection, and takedown

Opaque bytes are not marked safe merely because they pass MIME validation. New
file and deck posts enter `status = processing`, `analysis_state = pending`, and
`content_safety_state = pending`. Publication is allowed only after the
versioned validation profile and required safety pipeline produce an allow
decision. For the initial text-only formats, the pipeline decodes the verified
bytes, applies byte/row/depth limits, scans the complete normalized text, and
stores a non-content analysis result reference. Deck safety evaluates every
prompt, answer, title, description, and tag before canonical packaging.

`content_safety_state` retains its presentation meaning (`safe`, `sensitive`,
or `adult`); `analysis_state` remains the publication gate (`allow`,
`review_required`, or `blocked`). Ambiguous, unsupported, timed-out, partially
scanned, or scanner-unavailable results never become `allow`. The initial
profiles may therefore launch only when the text safety pipeline is available;
future opaque binary formats require malware scanning and a moderator-safe
inspection strategy before their profile can be enabled.

Moderator inspection is a separate, audited endpoint. It requires explicit
moderation authority and a case/reason code, returns sanitized text or a
quarantined download through a dedicated short-lived response, and never uses
normal creator/buyer delivery authorization. Inspection access does not grant
commerce entitlement and is logged without payload contents. Deck inspection
renders the bounded parsed card model, not active HTML.

Assets gain an enforcement projection with `active`, `quarantined`, and
`blocked` states plus reason, source, actor-role identifier, evidence reference,
and timestamps. `quarantined` and `blocked` deny public and buyer delivery before
creator/moderator entitlement shortcuts are considered; only the audited
inspection endpoint can read quarantined bytes. The projection schema is:

```sql
CREATE TABLE asset_enforcement (
  asset_id              TEXT PRIMARY KEY,
  enforcement_state     TEXT NOT NULL CHECK (enforcement_state IN
                           ('active','quarantined','blocked')),
  reason_code           TEXT,
  source                TEXT NOT NULL,
  actor_role            TEXT,
  evidence_ref          TEXT,
  decided_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE,
  CHECK (enforcement_state = 'active' OR reason_code IS NOT NULL)
);
```

The row is created with the asset. Missing enforcement state fails closed for
generic kinds. Moderator identities remain in the existing restricted audit
system; this community projection stores a role identifier, not personal data.
A confirmed takedown also:

- moves the post to `removed`, withdraws the active payload and listing, and
  prevents new quotes, purchases, sessions, exports, and CDR key releases;
- removes public gateway discovery and requests provider/CDR/IPFS unpinning or
  suppression where supported;
- preserves only the minimum immutable hash, transaction, and legal/audit
  records required by existing policy;
- makes reinstatement an explicit reviewed transition rather than a republish
  side effect.

Published deck/card rows remain immutable evidence but are not necessarily
readable. Immutability does not override enforcement. Already downloaded
plaintext, a completed chain transaction, or independently replicated
content-addressed ciphertext may be technically irreversible; the product must
state that limitation and must not describe future-access revocation as remote
deletion.

### Quotas, rate limits, and retention

The initial server-side limits are versioned policy, enforced before allocating
provider work and again at finalization:

- 10 upload intents per user per rolling hour;
- 250 MiB of completed uploads per user per rolling 24 hours;
- 2 GiB retained per user per community and 20 GiB per community;
- at most 20 unclaimed blobs per user;
- 10 MiB, 10,000 rows, 32 columns, and 16 KiB per cell for a CSV deck import;
- 10,000 cards per deck, 16 KiB per prompt or answer, and a 50 MiB canonical
  deck package.

Unclaimed, failed, and cancelled blobs expire after 24 hours. A committed raw
deck-import blob expires after 7 days. Unpublished draft payloads expire after
30 days after a visible warning, unless the creator renews the draft. Active
published assets and legally retained records follow the takedown and account
retention policies rather than orphan retention.

Quota accounting includes free/public bytes. Free public file publication is
disabled at initial rollout and gets its own feature flag after bandwidth
accounting, egress alerting, and abuse throttles are proven. A missing or
unavailable production quota service fails closed for new upload allocation;
it does not turn the product into unmetered file hosting.

## Locked Delivery Refactor

The existing CDR authorization contract remains the entitlement primitive. The
server-side preparation path becomes content neutral:

```ts
interface StoredContentReader {
  open(contentBlobRef: string): Promise<{
    body: ReadableStream<Uint8Array>
    contentHash: string
    mimeType: string
    sizeBytes: number
  }>
}

interface LockedPayloadWriter {
  prepare(input: {
    assetId: string
    body: ReadableStream<Uint8Array>
    metadata: AssetPayloadDescriptor
    accessPolicy: LockedAccessPolicy
  }): Promise<LockedDeliveryCoordinates>
}
```

The generic interfaces must not accept `SongArtifactUpload`, artifact kind, or
bundle ID. Song/Story metadata needed for rights registration is supplied by
the song asset policy, not by the byte-delivery interface.

The initial `opaque_file_v1` writer may buffer one verified payload because the
locked input is capped at 50 MiB. Its test fixture must prove peak live payload
memory remains below 110 MiB, allowing one plaintext buffer, one ciphertext
buffer, and bounded metadata overhead. Exceeding either the byte cap or memory
budget fails before Story publication begins.

Legacy whole-payload encryption remains readable as a versioned format. New
file delivery must not remove or rewrite existing ciphertext. Raising the
locked-file limit above 50 MiB requires a versioned chunked format that:

- authenticates every chunk independently with a unique nonce;
- authenticates the ordered manifest and total plaintext length;
- binds the asset ID, payload hash, and format version as associated data;
- permits bounded-memory server preparation;
- rejects missing, duplicated, reordered, or truncated chunks;
- has browser and server reference fixtures before production use.

The exact cryptographic format belongs in a separate protocol fixture reviewed
with the CDR integration. This architecture does not authorize an ad hoc
cipher construction.

## File Post Creation

The OpenAPI contract adds a discriminated `file` request:

```yaml
post_type: file
title: required
file_upload: cbl_...
access_mode: public | locked
license_preset: required when locked
listing_draft: required for a paid locked file
```

The server derives filename, MIME type, size, checksum, and storage coordinates
from the ready content blob. The client cannot override them in the post body.

File publication reuses the existing `post_publish_finalize` asynchronous lane
and `posts.status = processing`; it does not introduce a parallel publisher.
The create request durably records the saga and returns the processing post.
The finalizer performs these idempotent steps:

1. validate membership, authorship, content-blob ownership, and blob readiness;
2. validate the `download_file` asset policy;
3. create the social post;
4. create the `download_file` asset and primary payload snapshot;
5. claim the control-plane blob;
6. prepare locked delivery and required Story state;
7. create the listing from `listing_draft` only after sellability passes;
8. publish the post or record the existing retryable publication state.

The post-create idempotency record stores the IDs allocated for every step so a
retry resumes rather than duplicates the post, asset, payload, or listing.

The same Phase 2 `posts` rebuild that adds `file` and `deck` also adds constrained
failure codes for `payload_verification_failed`, `payload_safety_blocked`,
`payload_safety_review_required`, `payload_claim_failed`,
`deck_package_generation_failed`, and `deck_package_hash_mismatch`. Provider,
Story, locked-delivery, listing, catalog, and internal failures continue using
the existing generic codes where their semantics match. Retryability is
declared per failure code; safety blocks and hash mismatches never retry without
new input or a reviewed moderation transition.

## File Access And Browser Delivery

`AssetAccessResponse` gains a payload descriptor:

```ts
type AssetPayloadDescriptor = {
  delivery_behavior: "download" | "app_native" | "audio" | "video"
  display_filename: string | null
  mime_type: string
  size_bytes: number
  content_hash: string
  payload_format: string
}
```

The descriptor may be exposed as listing-safe metadata before purchase, but a
delivery reference or CDR package is returned only after the existing access
decision grants access.

For `delivery_behavior = download`, the web client uses one shared download
controller. It resolves access, fetches or decrypts the payload, verifies the
expected hash before exposing the save action, and saves it using the
authoritative display filename. It never sends downloadable bytes to the audio
or video controller. The v1 50 MiB cap keeps browser hashing and save behavior
within the same explicit memory envelope as decryption.

Locked download responses are private and non-cacheable. Public files may use
content-addressed caching only through an enforcement-aware gateway with
bounded cache TTL, purge support, and no origin-bypassing URL in the post
contract. Takedown purges platform caches and prevents future platform fetches,
but cannot revoke plaintext already downloaded or independently replicated.

## Learning Deck Domain

A learning deck is structured app content and an asset. The asset provides
commerce, entitlement, immutable package identity, and optional export. The
learning tables provide safe prompt/answer serving and private learner state.

### Deck and card schema

```sql
CREATE TABLE learning_decks (
  learning_deck_id     TEXT PRIMARY KEY, -- ldk_*
  community_id         TEXT NOT NULL,
  creator_user_id      TEXT NOT NULL,
  source_post_id       TEXT,
  asset_id             TEXT,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL CHECK (status IN
                         ('draft','published','archived')),
  active_draft_version INTEGER NOT NULL DEFAULT 1,
  published_version    INTEGER,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (source_post_id) REFERENCES posts(post_id),
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id),
  CHECK (
    (status = 'draft' AND source_post_id IS NULL AND asset_id IS NULL AND
     published_version IS NULL)
    OR
    (status IN ('published','archived') AND source_post_id IS NOT NULL AND
     asset_id IS NOT NULL AND published_version IS NOT NULL)
  )
);

CREATE TABLE learning_deck_versions (
  learning_deck_version_id TEXT PRIMARY KEY, -- ldv_*
  learning_deck_id         TEXT NOT NULL,
  version                  INTEGER NOT NULL,
  schema_version           INTEGER NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
                            ('draft','validating','ready','published','failed')),
  content_hash             TEXT,
  card_count               INTEGER NOT NULL DEFAULT 0,
  canonical_blob_ref       TEXT,
  validation_error_json    TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  published_at             TEXT,
  FOREIGN KEY (learning_deck_id) REFERENCES learning_decks(learning_deck_id)
    ON DELETE CASCADE,
  UNIQUE (learning_deck_id, version)
);

CREATE TABLE learning_cards (
  learning_card_id   TEXT PRIMARY KEY, -- lcd_*
  learning_deck_id   TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  retired_at         TEXT,
  FOREIGN KEY (learning_deck_id) REFERENCES learning_decks(learning_deck_id)
    ON DELETE CASCADE
);

CREATE TABLE learning_card_versions (
  learning_deck_version_id TEXT NOT NULL,
  learning_card_id         TEXT NOT NULL,
  ordinal                  INTEGER NOT NULL,
  card_type                TEXT NOT NULL CHECK (card_type IN
                            ('basic','cloze')),
  prompt_json              TEXT NOT NULL,
  answer_json              TEXT NOT NULL,
  tags_json                TEXT NOT NULL DEFAULT '[]',
  content_hash             TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  PRIMARY KEY (learning_deck_version_id, learning_card_id),
  FOREIGN KEY (learning_deck_version_id)
    REFERENCES learning_deck_versions(learning_deck_version_id)
    ON DELETE CASCADE,
  FOREIGN KEY (learning_card_id) REFERENCES learning_cards(learning_card_id)
    ON DELETE CASCADE,
  UNIQUE (learning_deck_version_id, ordinal)
);
```

`prompt_json` and `answer_json` follow a versioned portable document schema.
The initial schema permits UTF-8 plain text only. It does not permit executable
HTML, remote embeds, or media references. Images and other safe media require a
later schema version with explicit content-blob and entitlement behavior.

`learning_card_id` is stable only while the semantic question remains the
same. Cosmetic corrections within an unpublished draft may preserve it. A
changed fact, changed expected answer, split card, or merged card creates a new
ID so old review state is not misapplied. A published deck is never hard
deleted; it may be archived. Hard deletion is limited to unpublished drafts so
review events cannot lose their content identity.

`basic` produces one review item. A creator who wants both directions creates
two linked basic cards at authoring time; the scheduler must never share one
review state between directions. A v1 `cloze` card contains exactly one cloze
group and also produces one review item.

### Canonical deck package

Publishing serializes the ready deck version into canonical JSON with stable
key ordering and normalized text, hashes it, uploads it through the content
blob service, and attaches it to a `learning_deck` asset as
`learning_deck_package_v1`.

The package contains deck metadata, card IDs, ordinals, types, prompts,
answers, tags, and schema version. It excludes learner state, attempts,
entitlements, moderation notes, server-only audit data, and v1-deferred media
references.

The published database rows and canonical package must have the same content
hash. Publication fails closed on mismatch.

Deck publication is an idempotent saga in the existing
`post_publish_finalize` lane, keyed by the post-create idempotency record. It
allocates the post, asset, payload, listing, and derived package IDs once;
writes and claims the canonical package; creates draft community rows; prepares
required Story/CDR state for a locked deck; then atomically marks the deck
version, deck, asset, post, and listing publishable. A retry resumes the
recorded stage. No answer-bearing deck row or active listing is externally
readable before the blob claim, safety decision, and delivery prerequisites
succeed.

## CSV Deck Import

CSV import is an authoring input, not the canonical deck and not automatically
a sellable file asset.

Flow:

1. upload through `deck_import_csv_v1`;
2. parse asynchronously with fixed byte, row, column, and field-length limits;
3. require UTF-8 and surface row-level validation errors;
4. let the creator map columns to prompt, answer, and optional tags;
5. show a deterministic preview;
6. commit valid rows into a new draft deck version;
7. serialize the canonical deck package only at publication.

The parser treats every cell as text, never evaluates formulas, does not fetch
URLs, and does not render imported HTML. Duplicate rows receive distinct card
IDs unless the creator explicitly deduplicates them before commit.

Import job state is durable and idempotent. The raw import blob may be deleted
after its documented retention period once a deck version has been committed.

## Generic Review Model

### Stable review items

The scheduler operates on a stable review-item identity:

```sql
CREATE TABLE learning_review_items (
  review_item_id      TEXT PRIMARY KEY, -- lri_*
  item_kind           TEXT NOT NULL CHECK (item_kind IN
                        ('deck_card','song_exercise')),
  subject_ref         TEXT NOT NULL,
  content_version     INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active','retired')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (item_kind, subject_ref)
);
```

For deck cards, `subject_ref` is the `learning_card_id`; this is the sole
card-to-review-item relationship. `learning_cards` deliberately has no reverse
foreign key, avoiding a circular insertion and deletion dependency. Deck cards
allocate a review item when the card identity is created. A future Song Study
migration may map a stable
`post + line + exercise_type + language` identity to a review item without
changing the meaning of that identity.

### Scheduler interface

The scheduler is pure and deterministic:

```ts
type ReviewRating = "again" | "hard" | "good" | "easy"

type ReviewState = {
  phase: "new" | "learning" | "review" | "relearning"
  stability: number
  difficulty: number
  dueAtMs: number
  lastReviewedAtMs: number | null
  learningStepIndex: number | null
  scheduledIntervalDays: number
  reps: number
  lapses: number
}

type ReviewTransition = {
  algorithm: "song_heuristic_v1" | "fsrs_6_v1"
  parametersVersion: number
  reviewedAtMs: number
  scheduledIntervalDays: number
  state: ReviewState
}

interface ReviewScheduler {
  readonly algorithm: "song_heuristic_v1" | "fsrs_6_v1"
  readonly parametersVersion: number
  review(input: {
    nowMs: number
    rating: ReviewRating
    state: ReviewState | null
  }): ReviewTransition
}
```

The implementation receives time explicitly and must not call the system clock
internally. The same state, rating, timestamp, algorithm, and parameter version
must produce the same transition. Persistent timestamps are UTC with
millisecond precision; fractional-day intervals are not rounded through local
calendar dates.

The `song_heuristic_v1` compatibility fixture pins JavaScript IEEE-754 number
semantics, the current `Number(value.toFixed(3))` decimal rounding step, SQLite
`REAL` write/read behavior, and millisecond UTC ISO serialization. The extracted
pure scheduler accepts only a finite, valid `nowMs`. The legacy Song Study
adapter initially preserves the current invalid-timestamp fallback by resolving
it through an injected clock before calling the scheduler; removing that
fallback requires a separate contract change. Characterization vectors cover
all ratings, lapse/review paths, decimal half-boundaries, SQLite round trips,
valid timestamps, and the injected-clock fallback. “Byte-for-byte” refers to
the serialized persisted transition after those exact rules, not approximate
floating-point equality.

`fsrs_6_v1` implements FSRS-6 as documented by the maintained
[Open Spaced Repetition algorithm reference](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm).
Core records the exact upstream commit, formula identifier, 21 weights, desired
retention, learning steps, maximum interval, rounding rules, and time unit in an
immutable fixture. The runtime dependency is pinned exactly in the lockfile and
must match that fixture; it never floats with a package update. Reference
vectors generated from the pinned implementation must pass in Core and API.
Changing a configured parameter creates a new parameter version. Changing the
formula or upstream major algorithm creates a new algorithm identifier.

This is a stability pin, not a claim that FSRS-6 will remain the newest
upstream formula. The first release does not follow an upstream `latest` tag.

### Events and projection

Review events are append-only authority. Review state is a rebuildable
projection:

```sql
CREATE TABLE learning_review_events (
  learning_review_event_id TEXT PRIMARY KEY, -- lre_*
  user_id                  TEXT NOT NULL,
  review_item_id           TEXT NOT NULL,
  learning_deck_id         TEXT,
  learning_deck_version_id TEXT,
  learning_session_id      TEXT,
  idempotency_key          TEXT NOT NULL,
  item_event_sequence      INTEGER NOT NULL CHECK (item_event_sequence > 0),
  rating                   TEXT NOT NULL CHECK (rating IN
                            ('again','hard','good','easy')),
  reviewed_at              TEXT NOT NULL,
  algorithm                TEXT NOT NULL,
  parameters_version       INTEGER NOT NULL,
  content_version          INTEGER NOT NULL,
  prior_state_hash         TEXT,
  resulting_state_json     TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  FOREIGN KEY (review_item_id) REFERENCES learning_review_items(review_item_id),
  FOREIGN KEY (learning_deck_id) REFERENCES learning_decks(learning_deck_id),
  FOREIGN KEY (learning_deck_version_id)
    REFERENCES learning_deck_versions(learning_deck_version_id),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (user_id, review_item_id, item_event_sequence)
);

CREATE TABLE learning_review_state (
  user_id                  TEXT NOT NULL,
  review_item_id           TEXT NOT NULL,
  algorithm                TEXT NOT NULL,
  parameters_version       INTEGER NOT NULL,
  phase                    TEXT NOT NULL CHECK (phase IN
                            ('new','learning','review','relearning')),
  stability                REAL NOT NULL,
  difficulty               REAL NOT NULL,
  learning_step            INTEGER,
  scheduled_interval_days  REAL NOT NULL,
  due_at                   TEXT NOT NULL,
  last_reviewed_at         TEXT,
  reps                     INTEGER NOT NULL,
  lapses                   INTEGER NOT NULL,
  last_review_event_id     TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  PRIMARY KEY (user_id, review_item_id),
  FOREIGN KEY (review_item_id) REFERENCES learning_review_items(review_item_id),
  FOREIGN KEY (last_review_event_id)
    REFERENCES learning_review_events(learning_review_event_id)
);

CREATE INDEX idx_learning_review_state_due
  ON learning_review_state (user_id, due_at);
```

An accepted rating inserts the event and updates the projection in one
transaction. `resulting_state_json` makes idempotent replay return the original
result even if a later event has advanced the item.

`item_event_sequence` is allocated under the same per-user/item revision CAS as
the state update, so concurrent ratings cannot commit the same ordinal or leave
ambiguous event order.

Projection rebuild is historical restoration, not scheduler recomputation. It
orders accepted events by `item_event_sequence` and writes the last event's
validated `resulting_state_json` plus its recorded algorithm and parameter
version. It does not run old events through current parameters. Recomputing a
history is a separate, explicitly versioned migration that loads the exact
recorded implementation and inputs, writes a shadow projection, and never
silently replaces the authoritative result.

## Learning Sessions And Due Queue

Sessions are server-owned. The client renders the current item and returned
transition; it does not construct or reorder a private queue.

```sql
CREATE TABLE learning_sessions (
  learning_session_id TEXT PRIMARY KEY, -- lss_*
  user_id              TEXT NOT NULL,
  scope_kind           TEXT NOT NULL CHECK (scope_kind IN
                         ('deck','community_due')),
  scope_ref            TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN
                         ('active','completed','expired')),
  session_revision     INTEGER NOT NULL,
  current_item_id      TEXT,
  item_count           INTEGER NOT NULL,
  reviewed_count       INTEGER NOT NULL DEFAULT 0,
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  completed_at         TEXT,
  FOREIGN KEY (current_item_id) REFERENCES learning_review_items(review_item_id)
);

CREATE TABLE learning_session_items (
  learning_session_id TEXT NOT NULL,
  review_item_id      TEXT NOT NULL,
  ordinal             INTEGER NOT NULL,
  due_at_snapshot     TEXT,
  status              TEXT NOT NULL CHECK (status IN
                        ('pending','current','revealed','reviewed')),
  revealed_at         TEXT,
  reviewed_event_id   TEXT,
  PRIMARY KEY (learning_session_id, review_item_id),
  FOREIGN KEY (learning_session_id) REFERENCES learning_sessions(learning_session_id)
    ON DELETE CASCADE,
  FOREIGN KEY (review_item_id) REFERENCES learning_review_items(review_item_id),
  UNIQUE (learning_session_id, ordinal)
);
```

Candidate selection for v1 is deterministic:

1. overdue review items ordered by `due_at`, then stable review-item ID;
2. new cards in deck ordinal order;
3. no suspended, retired, inaccessible, or unpublished item;
4. at most the configured session limit, initially 20 items.

`scope_kind = deck` selects one entitled deck.
`scope_kind = community_due` selects due items across every currently
accessible published deck in one community. Revoked entitlements remove items
from new sessions; an active session rechecks access before serving each item.

Community-due candidate selection performs one set-based access query joining
review state through cards, published decks, assets, posts, membership, and
active entitlements. It must not call the scalar access-decision service once
per card or deck. The selected session snapshots the authorized deck/asset IDs;
each transition rechecks the current item's one asset in the same transaction,
so revocation remains effective without an N-item decision loop.

For a 20-item session over the reference fixture of 100 accessible decks and
10,000 review items, creation has a constant budget of at most four community
database statements and a p95 service target of 250 ms excluding network
transit. The query plan must use the due-state, deck/card, published-deck asset,
post visibility, and entitlement indexes with no full review-event scan. CI
asserts the statement count does not grow with candidate or deck count, and
load tests report p50/p95/p99 latency before enabling `community_due`.

A rating request includes the expected session revision, current review item,
rating, and idempotency key. Before rating, an idempotent reveal transition
changes the current item to `revealed`, increments the session revision, and
returns the answer. Ratings are accepted only for the revealed current item.
The review event, review-state projection, session-item transition, next-item
choice, and next revision commit atomically.

The response includes `next_due_at` when no item is currently due. The due query
does not load answer content until access has been established.

### Cross-community projection

Canonical learner state remains in community shards. A future global “due
today” screen uses a derived user-level routing projection containing only:

- user ID;
- community ID;
- earliest due timestamp;
- due count;
- projection watermark.

It contains no prompts, answers, ratings, or attempt payloads. It is not an
authority for accepting reviews. If stale or unavailable, community-scoped
study remains correct.

## Learning Access And Privacy

- Public decks are available under normal community visibility rules.
- Asset enforcement is checked first. A quarantined or blocked deck is denied
  through normal creator, moderator, public, buyer, export, and study routes.
- An active locked deck then requires creator authority or active
  `asset_access` entitlement before deck content or a study session is
  returned. Moderators use the audited inspection route, not buyer delivery.
- Every session transition rechecks that the deck remains accessible.
- Learners may read only their own sessions, events, and review state.
- Creators may read aggregate product metrics only through a separately
  specified privacy-preserving projection; they do not receive learner answers
  or schedules.
- Moderation access to deck content does not imply access to learner state.
- Deleting a learner account follows the existing private-attempt deletion
  policy and removes or anonymizes review events consistently.
- Exported deck packages never contain learner state.

## API Surface

The exact paths may follow existing route naming, but the contract must expose
these operations:

### Content

- create a content blob/upload intent;
- create/resume multipart session;
- sign a part;
- complete or abort a session;
- inspect verification state.

Song routes may remain as compatibility adapters while clients migrate. New
file and deck code calls only the content-neutral contract.

### Files

- create a `file` post from a ready content blob;
- read asset/listing-safe payload metadata;
- resolve existing asset access;
- stream public content or return locked CDR access;
- download with authoritative filename and disposition.

### Deck authoring

- create a draft deck;
- add, update, reorder, or retire draft cards;
- upload and validate a CSV import;
- preview and commit an import;
- validate a deck version;
- publish a deck through an idempotent post/asset/listing operation.

### Deck study

- fetch due counts and `next_due_at`;
- create or resume a deck/community-due session;
- read the current authorized card;
- submit a rating with expected revision and idempotency key;
- return the committed review transition and next item.

Answers for future auto-graded card types must remain server-side until grading
commits. V1 self-rated basic and cloze cards may return the answer only through
the session reveal flow.

## Web Structure

The composer becomes adapter-driven rather than adding another condition to
every centralized mode branch:

```ts
interface ComposerModeAdapter<State> {
  mode: ComposerTab
  initialState(): State
  validate(state: State): ComposerValidation
  progress(state: State): SubmitProgressStep[]
  submit(context: SubmitContext, state: State): Promise<CreatedPost>
  preview(state: State): PostPreviewContent
}
```

Existing text, image, link, song, video, and live behavior may migrate
incrementally. `file` and `deck` are the second real callers that justify the
registry. The refactor moves existing behavior mechanically before changing
product logic.

Post presentation has a corresponding adapter keyed by post type. The file
adapter renders metadata, price/access state, and a download action. The deck
adapter renders card count, access state, and a study action. Neither adapter
imports the song playback controller.

## Feed, Search, And Client Compatibility

New writers remain disabled until readers are deployed across API, Web,
Android, desktop, search, crosspost projection, Telegram publication, and
administrative/moderation clients. Generated enum decoders must have an
unknown-value path before the OpenAPI enum expands.

At every collection boundary, an unknown or unsupported `post_type` is skipped
with a compatibility metric; it is never coerced to text and never crashes the
whole feed, search page, notification batch, crosspost, or publisher job. A
direct detail request may return a typed `unsupported_post` shell containing
only safe common metadata and a web fallback URL. The API filters `file` and
`deck` from clients that have not advertised the corresponding read
capability until their compatible release is established.

Surface rules are explicit:

- feed serializers emit common post fields plus the typed file/deck descriptor;
- search indexes title, caption, creator-safe metadata, file type/size, deck
  description/tags, and card count, but never file bytes, card answers, or
  private package contents;
- crossposts preserve the source post type and entitlement boundary; a target
  without the adapter shows the unsupported shell or skips it;
- Telegram and other outbound publishers emit only approved listing metadata
  and a link after their adapters exist; they never attach locked payloads;
- Android and desktop either implement the typed presentation or safely skip;
  they do not receive an existing post type with incompatible fields;
- moderation and administrative queues must understand the new safety and
  enforcement states before publication is enabled.

Deployment order is tolerant readers and metrics, then schema, then disabled
writers, then per-surface flags. Compatibility fixtures inject a future
unknown enum value into every consumer and prove the enclosing collection or
job remains healthy.

## Migration And Rollout

### Phase 0: contracts and characterization

- Add this spec and the new OpenAPI discriminants and descriptors.
- Add characterization tests for current song/video upload, locked delivery,
  access, listing, and playback behavior.
- Add reference fixtures for `song_heuristic_v1` matching every current rating
  transition.
- Add accepted FSRS-6 reference vectors for `fsrs_6_v1`.
- Do not change production behavior.

### Phase 1: content-neutral transport

- Add control-plane `content_blobs` and `content_upload_sessions` tables.
- Mechanically extract provider I/O, multipart planning, signing, completion,
  HEAD verification, and cleanup from song services.
- Keep song routes backed by a song adapter.
- Add generic content routes behind a server-side flag.
- Prove song/video characterization tests remain unchanged.

Do not rename or drop legacy song tables in this phase.

### Phase 2: one community schema foundation and Story projection

- In one community fleet migration, add `asset_payloads`, `asset_enforcement`,
  and all dormant learning deck/review/session tables and indexes.
- Rebuild constrained asset/post tables to add `download_file`,
  `learning_deck`, `file`, `deck`, nullable kind-bound `primary_content_ref`,
  and the new publication failure codes where required. The posts rebuild is a
  reviewed successor to `1117_async_post_publish.sql`, preserving every current
  column, index, trigger, and existing enum member.
- In a separate central control-plane migration, expand
  `story_registered_asset_projections.asset_kind` and update its canonical
  snapshot. This is not a second community fleet sweep.
- Add the asset-kind policy registry and remove default-to-song branches.
- Expand every Story type/metadata/state/derivative kind surface and add the
  generic IP metadata fixtures.
- Add dual-read support: payload row first, legacy asset columns second.
- Backfill legacy payload snapshots with an idempotent fleet runner that reads
  authoritative upload metadata from the control plane.
- Attest total, succeeded, missing, and conflicted rows before disabling the
  fallback.

The consolidated fleet migration deliberately installs dormant learning tables
before Phase 4 so the plan performs one shard-wide schema sweep, not two. Its
staging and production attestations are independent from the central
control-plane migration. Both must complete and be verified before an API
writer can emit a new kind.

### Phase 3: downloadable file vertical

- Add the generic upload UI and `file` composer adapter.
- Add server-side file policy, claim saga, asset creation, Story/CDR
  preparation, and listing creation.
- Reuse the asynchronous post finalizer and add text safety, moderator
  inspection, takedown, quotas, retention, and both reconciliation sweepers.
- Add the browser download controller and response headers.
- Deploy tolerant readers for every client/fan-out surface before enabling the
  writer.
- Launch allowlisted locked formats behind a community/server flag only after
  the Story registration recovery gate passes; keep public/free publication
  separately disabled until egress controls pass.
- Keep the locked size cap at 50 MiB.

### Phase 4: activate the learning core and deck vertical

- Activate the dormant deck, version, card, review-item, event, state, and
  session tables installed and attested in Phase 2; perform no second planned
  fleet schema sweep.
- Add `fsrs_6_v1`, reference-vector tests, and deterministic replay tests.
- Add deck authoring, CSV import, canonical package publication, and deck
  composer/presentation adapters.
- Add paid-deck entitlement checks and community-scoped cross-deck due study.
- Apply the same safety, takedown, quota, compatibility, and Story registration
  recovery gates as files.
- Keep rewards, streaks, and global due aggregation disabled.

### Phase 5: song convergence

- Put current Song Study scheduling behind `song_heuristic_v1` without changing
  persisted results.
- Map stable song exercise identities to review items in a shadow projection.
- Replay attempts into the shadow state and compare due times and counters.
- Move song sessions or review state only after parity is attested across the
  fleet.
- Treat adoption of `fsrs_6_v1` by songs as a separate product migration.

### Phase 6: legacy retirement

- Route new song/video uploads through `content_blobs` while retaining their
  domain bundle records.
- Backfill legacy upload rows and allow active legacy sessions to expire.
- Verify no reader depends solely on legacy song-upload storage coordinates or
  `assets.primary_content_ref`.
- Remove compatibility reads and old tables only in a later, separately
  reviewed migration.

## Rollback

- New schema is additive until Phase 6.
- Flags independently control generic upload creation, file publication, file
  listing, public/free file publication, deck publication, and deck study.
- Disabling a writer does not revoke already purchased access.
- Enforcement flags and takedown state remain active during product rollback;
  rollback must never restore delivery for a blocked asset.
- Readers continue to support legacy payload and encryption formats.
- A failed backfill leaves dual-read behavior active; it does not mutate or
  delete the legacy source row.
- A scheduler rollout can stop new deck reviews while preserving events and
  projections already committed.
- No rollback recomputes Song Study due dates.

## Observability

At minimum, record:

- content uploads created, completed, verified, rejected, expired, and orphaned
  by validation profile;
- upload verification latency and provider errors;
- blob-claim retries and conflicts;
- payload-without-claim scans, restored claims, and restore conflicts;
- quota denials, retained bytes, public egress, intent rate-limit denials, and
  retention deletions by policy version;
- payload/deck safety outcomes, quarantine age, inspection counts by reason,
  takedowns, reinstatements, and failed provider suppression requests;
- locked-delivery bytes processed, peak chunk/buffer size, and preparation
  failures by payload format;
- file access grants/denials by decision reason without logging filenames or
  content;
- deck import rows accepted/rejected and validation duration;
- deck publication hash mismatches;
- review transitions by algorithm/parameter version/rating;
- idempotent review replays and stale session revisions;
- due-query latency, candidate counts, and inaccessible-item exclusions;
- due-session database statement count and candidate-to-session ratio;
- unsupported post types skipped by client/surface and capability-filtered
  responses;
- legacy fallback reads during migration.

Logs must not contain file contents, CSV cells, card answers, learner responses,
CDR keys, signed URLs, or raw wallet proofs.

## Acceptance Criteria

### Architecture

- Generic content modules have no imports from song artifacts or media players.
- Every asset kind is registered explicitly and unknown kinds fail closed.
- Story projection constraints, runtime unions, metadata labels, media URI
  rules, state guards, and derivative projections accept generic kinds without
  song/video fallback.
- The listing, quote, purchase, settlement, entitlement, and core access path
  has no file- or deck-specific fork except through the asset policy/delivery
  interfaces.
- New composer and post presentation modes are registered through adapters.

### Existing behavior

- Existing song and video upload, publish, purchase, entitlement, CDR access,
  and playback fixtures remain unchanged.
- Legacy locked payloads remain readable.
- `song_heuristic_v1` reproduces existing Song Study transition fixtures and
  due timestamps exactly, including fixed decimal rounding, SQLite `REAL`
  round trips, serialization, and the legacy injected-clock fallback.

### File sales

- A creator can upload an allowed file, publish a locked file post with a
  listing, and resume every step with one idempotency key.
- An unauthorized caller cannot obtain the delivery reference or content.
- A buyer with a settled active entitlement can download the exact bytes with
  the verified hash, MIME type, byte size, and safe filename.
- Public downloads and locked downloads set the specified security and cache
  headers.
- Rejected, unverified, expired, cross-community, or already-claimed blobs
  cannot become an asset.
- New locked-file preparation stays within the documented memory bound.
- Missing claims for valid shard payloads are repaired idempotently; conflicts
  quarantine the asset, and legacy/generic object namespaces cannot collide for
  new writes.
- Quota, rate, and retention limits prevent unlimited free hosting and fail
  closed for new production allocations.
- File publication cannot leave `processing` until safety, claim, Story/CDR,
  listing, and catalog stages reach their recorded terminal decisions.
- A quarantined or blocked asset cannot be delivered through creator,
  moderator, buyer, public, session, or export paths; only audited inspection
  can read it.

### Decks and learning

- A creator can author or import, validate, publish, list, and sell an immutable
  deck.
- The canonical package hash matches the published card rows.
- Locked deck content and study endpoints enforce active asset entitlement.
- A learner can create/resume a session, reveal a card, submit each rating, and
  receive deterministic `fsrs_6_v1` state.
- A rating for an unrevealed, non-current, inaccessible, or stale-revision card
  is rejected without writing an event.
- Equivalent idempotent replay returns the original transition after later
  reviews have occurred.
- A stale session revision cannot double-apply a review.
- Community-due sessions serve overdue cards before new cards and exclude
  retired or inaccessible cards.
- Review events rebuild the same review-state projection by restoring the last
  recorded `resulting_state_json`; rebuild never recomputes with newer
  parameters.
- Community-due creation uses a constant number of database statements, meets
  the reference p95 target, and never makes N scalar access decisions.
- No deck API exposes another learner's events or state.

### Compatibility and launch posture

- Every feed/search/crosspost/outbound/client consumer survives an injected
  unknown post type by skipping it or returning the documented unsupported
  shell without crashing its enclosing job or collection.
- Search and outbound publication never index or attach file bytes, deck
  answers, private packages, signed URLs, or CDR material.
- Readers and moderation tooling deploy before writers; unsupported clients are
  capability-filtered until compatible.
- Paid file/deck flags cannot enable while the Story registration replay and
  stranded-state recovery gate is failing.
- Product copy and release notes identify the initial paid lane as
  Base-Sepolia/Story-Aeneid simulated-money beta, not real-money availability.

### Fleet rollout

- The consolidated community schema foundation, generated schema snapshot, and
  schema requirement manifest change together in one fleet sweep; Phase 4 does
  not schedule a second learning-table sweep.
- The central Story projection migration has its own attestation and completes
  before generic writers deploy.
- Seeded-upgrade tests preserve existing song/video assets and Song Study rows.
- Staging and production fleet migrations are attested before the new API
  writer is deployed.
- Deployment verification proves the API and web versions containing the
  enabled feature, not merely a green aggregate workflow.

## Repository Ownership And Delivery Order

Core owns:

- this architecture and domain contract;
- OpenAPI schemas and generated contract version;
- control-plane and community-template migrations;
- canonical schema snapshots and fleet requirements;
- scheduler reference fixtures shared across implementations.

API owns:

- content-neutral storage/upload/delivery services;
- asset policy adapters;
- post/publish orchestration;
- deck authoring/import/study services;
- scheduler execution and transactional projections.

Web owns:

- file and deck composer adapters;
- upload and download controllers;
- file/deck post presentation;
- deck editor/import preview and study UI.

Delivery order is Core contract and schema first, then API readers, fleet
migrations, API writers, and Web surfaces. A writer that emits a new constrained
kind must not deploy before every target shard accepts it.

## Deferred Decisions

- Formats added after the initial file allowlist.
- Chunked locked-payload protocol and limits above 50 MiB.
- Multi-file bundles and product manifests.
- Deck updates, upgrade pricing, subscriptions, and entitlement inheritance.
- Sharing review history across forked decks.
- Canonical FSRS adoption for Song Study.
- Cross-community due-session orchestration.
- Learner exports and portable review-history import.
- Privacy-preserving creator analytics.
