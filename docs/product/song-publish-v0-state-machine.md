# Song Publish V0 State Machine

Status: draft

Purpose:

- define the mainline v0 song pipeline as a strict state machine
- separate what is synchronous from what is async
- make Filebase/IPFS ingestion, Story publication, locked delivery, translation, and forced alignment fit one coherent flow

## Bottom Line

Mainline v0 song publishing should be:

1. upload bytes to one Filebase/IPFS-style storage path
2. register a song artifact bundle from those refs
3. validate and mark the bundle `ready`
4. create the social song post from that bundle
5. create the attached audio asset draft
6. run async jobs for Story, locked delivery, translation, and forced alignment

The social post becoming visible should not depend on Story succeeding.

## Scope Split

Three objects matter:

1. song artifact bundle
2. post
3. asset

Each has a different job:

- bundle
  - private draft package of song inputs
  - source of truth for audio ref, lyrics, and optional media package refs
- post
  - social object shown in community feed and thread views
- asset
  - rights-bearing media object that owns Story publication and locked delivery

## Current Reality Vs Target

Current v2 implementation already has:

- Filebase-backed upload intake
- bundle `ready` gating and single-use consumption
- bundle create/read
- post create from `song_artifact_bundle_id`
- asset draft rows
- real preview derivation into a separate stored preview artifact
- async translation, forced alignment, and moderation
- async Story publish worker
- async locked-delivery preparation worker
- real CDR SDK encrypted blob write and buyer-side CDR manifest flow
- real Story publish working live through the Lit action path
- real buyer settlement -> entitlement -> CDR read -> decrypt flow
- cover-art `1:1` validation
- canvas-video `9:16` validation
- song post read/feed behavior
- community asset read route
- community asset access route for creator/buyer delivery decisions

Current v2 does not yet have:

- canvas moderation
- remix/upstream rights attachment flow beyond `song_mode = remix` requiring `rights_basis = derivative`
- explicit runtime support for upstream asset references / derivative license attachments
- full royalty-graph / upstream royalty passthrough execution
- ACRCloud copyright-identification integration

This doc defines the target mainline v0 flow that those pieces should implement.

## Canonical Sequence

### 1. Upload / Ingest

The client uploads song bytes to Pirate's mainline storage path.

Required v0 upload family:

- primary audio

Required v0 metadata:

- content hash
- mime type
- size

Optional v0 uploads:

- cover art
- canvas video
- preview audio
- instrumental stem
- vocal stem

Result:

- storage refs exist
- no public post exists yet

### 2. Bundle Registration

`POST /communities/{community_id}/song-artifacts`

Required inputs:

- primary audio ref
- lyrics

Optional inputs:

- cover art ref
- canvas video ref
- preview ref
- instrumental ref
- vocal ref

Result:

- private bundle row exists
- bundle belongs to exactly one community and one creator

### 3. Bundle Validation / Readiness

Pirate validates the registered package.

Minimum v0 checks:

- primary audio must be `audio/*`
- cover art, if present, must be `image/*`
- canvas video, if present, must be `video/*`
- preview audio, if present, must be `audio/*`
- lyrics must be non-empty

Recommended later v0 checks if promoted to product invariants:

- cover art must be exact `1:1`
- canvas video must be exact `9:16`

Only a `ready` bundle may be used for publishable song post creation.

### 4. Song Post Creation

`POST /communities/{community_id}/posts`

Required song input:

- `post_type = song`
- `song_artifact_bundle_id`

The server resolves the bundle and derives:

- canonical lyrics
- canonical audio `media_refs`

The server should reject duplicate song payload input when `song_artifact_bundle_id` is present:

- no direct `lyrics`
- no direct `media_refs`

Result:

- social post exists
- if analysis says publishable, post is live
- if analysis says `review_required`, post remains non-published
- if analysis says `blocked`, post is rejected or held according to post policy

### 5. Asset Draft Creation

When a song post is successfully created, Pirate creates the attached audio asset draft.

The asset copies:

- source post id
- creator user id
- community id
- content ref
- content hash
- rights basis
- access mode

This asset is the object that later moves through Story and locked delivery.

### 6. Async Jobs

After post and asset creation, async jobs may run independently:

- Story publication
- locked delivery / CDR preparation
- lyrics translation
- forced alignment
- karaoke package enrichment

The first executable enrichment slice should track bundle-level async state explicitly:

- `preview_status`
- `translation_status`
- `alignment_status`
- `moderation_status`
- stored refs/results for derived preview audio, translated lyrics, timed lyrics, and moderation output

Locked song publish should not crop audio inline on the request path in production. The request path should require a completed preview artifact and fail cleanly until the async preview worker finishes deriving it.

These jobs should not mutate the canonical social post into a different business object.

## Bundle State Machine

Suggested v0 bundle states:

- `draft`
- `validating`
- `ready`
- `failed`
- `consumed`

Meanings:

- `draft`
  - row exists
  - required material may still be incomplete
- `validating`
  - Pirate is checking mime, hashes, dimensions, and package completeness
- `ready`
  - valid enough to create a song post from
- `failed`
  - validation or ingestion failed
- `consumed`
  - at least one song post has been created from this bundle
  - in the current v0 direction, this is the single-use terminal state after first successful song-post creation

Recommended transitions:

- `draft -> validating`
  - triggered when required inputs are present
- `validating -> ready`
  - all required checks pass
- `validating -> failed`
  - validation fails
- `failed -> validating`
  - creator fixes the invalid inputs and retries
- `ready -> consumed`
  - first successful song post create from the bundle

Important rule:

- song post create should fail closed if bundle state is not `ready`
- consumed bundles must not be reusable for a second new song post

## Post State Machine

The post already uses the generic post state model.

Relevant v0 values:

- `draft`
- `published`
- `hidden`
- `removed`
- `deleted`

For song publish, the important synchronous decision is:

- `published`
  - social song is live
- `draft` with `analysis_state = review_required`
  - song is held for moderation/review
- no normal publishable row or only internal audit record
  - when `analysis_state = blocked`

Important rule:

- Story publication failure must not roll back a successfully published social post

## Asset State Machine

Suggested v0 asset publication states:

- `draft`
- `story_requested`
- `story_published`
- `story_failed`
- `withdrawn`

Meanings:

- `draft`
  - asset exists but Story job has not started
- `story_requested`
  - Story publish job has been queued or is running
- `story_published`
  - Story publish succeeded and IDs are attached
- `story_failed`
  - Story publish failed
- `withdrawn`
  - asset has been intentionally withdrawn from circulation later

Recommended transitions:

- `draft -> story_requested`
  - creator or policy triggers Story publish
- `story_requested -> story_published`
  - Story publish succeeds
- `story_requested -> story_failed`
  - Story publish fails
- `story_failed -> story_requested`
  - retry

Mainline v0 rule:

- songs should create an asset draft at publish time
- Story publication should then happen asynchronously on that asset

## Access Mode And Paid Songs

Assets should separately carry:

- `access_mode = public`
- `access_mode = locked`

This is independent from whether the social post is visible.

### Free Song

Typical path:

- bundle becomes `ready`
- post becomes `published`
- asset starts at `draft`
- Story publish moves asset toward `story_published`
- full payload remains publicly accessible

### Paid / Locked Song

Typical path:

- bundle becomes `ready`
- post becomes `published`
- asset is created with `access_mode = locked`
- locked-delivery job prepares the gated full payload
- Story publish and entitlement wiring happen on the asset side
- public post may still show title, lyrics excerpt, preview-safe refs, or teaser metadata

Current product invariant:

- locked delivery protects only the full audio payload
- preview audio remains public
- cover art remains public
- canvas video remains public sidecar media and is not part of the encrypted CDR payload

Important rule:

- if Story-native gated delivery is used, CDR belongs on the asset delivery path, not on the social post row

## Locked Delivery / CDR State Machine

Suggested locked-delivery states:

- `none`
- `requested`
- `ready`
- `failed`

Applicability:

- only relevant when `access_mode = locked`

Transitions:

- `none -> requested`
  - locked asset created and delivery prep is needed
- `requested -> ready`
  - encrypted payload and entitlement wiring are complete
- `requested -> failed`
  - preparation failed
- `failed -> requested`
  - retry

Important rule:

- locked delivery should use the asset as the unit of entitlement
- CDR is optional infrastructure in the sense that not every asset needs it, but it is the preferred primitive when the asset is locked

## Translation State Machine

Translation should be async and read-model oriented.

Suggested translation job states:

- `none`
- `pending`
- `ready`
- `failed`
- `policy_blocked`

Input:

- canonical lyrics
- canonical caption/body text where relevant

Triggers:

- publish success
- first read in a target locale
- proactive background materialization for high-priority locales

Important rule:

- translated renderings are not the canonical source of truth
- canonical lyrics remain the original bundle/post text

## Forced Alignment State Machine

Suggested forced-alignment states:

- `none`
- `pending`
- `ready`
- `failed`

Input:

- primary audio
- canonical plain-text lyrics

Output:

- timed lyric ref

Recommended trigger:

- automatically queue when both audio and lyrics are available and policy allows it

Alternative:

- explicit creator opt-in

Important rule:

- forced alignment is never a blocking prerequisite for social publication in v0

## Karaoke Enrichment State Machine

Suggested karaoke states:

- `none`
- `partial`
- `ready`
- `failed`

Interpretation:

- `none`
  - no karaoke package exists yet
- `partial`
  - some required refs exist, but not all
- `ready`
  - lyrics ref, instrumental ref, and vocal ref are all present
- `failed`
  - enrichment or package derivation failed

Important rule:

- karaoke readiness belongs on the asset/package layer, not the social post lifecycle

## Recommended Ownership By System

Uploader / ingest service:

- upload to Filebase/IPFS-style storage
- return storage refs, hashes, sizes, and media probes

Bundle service:

- create bundle row
- validate package
- manage bundle state

Post service:

- create song post from `ready` bundle
- apply publish-gate analysis

Asset service:

- create asset draft from created song post
- own Story publication state
- own locked delivery state

Enrichment workers:

- translation
- forced alignment
- karaoke package completion

## Recommended First Implementation Order

1. Add real upload orchestration into the bundle flow.
2. Add explicit bundle states and require `ready` for song post creation.
3. Create asset draft rows from successful song posts.
4. Add Story publish jobs and asset state reads.
5. Add locked delivery / CDR only for `access_mode = locked`.
6. Add translation and forced-alignment jobs behind the enrichment boundary.
7. Add geometry rules only if product explicitly chooses them as publish invariants.

## Decisions This Doc Assumes

These assumptions should be challenged explicitly if product wants something else:

- one Filebase/IPFS-style storage family
- no Arweave in v0 mainline
- Story is async, not a synchronous publish prerequisite
- forced alignment is enrichment, not a publish gate
- translation is enrichment, not a publish gate
- paid songs use the asset layer plus locked delivery, not a separate post-level commerce pipeline
- bundle-backed song create is the preferred mainline path

## Short Version

The simplest mental model is:

- bundle = private draft package
- post = public social song
- asset = rights and delivery object
- Story/CDR/translation/forced alignment = async jobs after the social post exists
