# Song Publish V2 Audit

Status: draft

Purpose:

- record what Pirate v2 actually supports today for `song` posts
- inventory the legacy song publish pipeline in `LEGACY-DO-NOT-USE`
- decide what v2 should keep, change, or drop
- define a phased v2 song-publish pipeline before implementation work starts

## Bottom Line

Pirate v2 does not yet have a real song publish pipeline.

Today it has:

- a generic post-create surface that allows `post_type = song`
- generic post moderation outcomes (`201`, `202`, `422`)
- generic post read and community feed behavior

Today it does not have:

- artifact staging for song-specific uploads
- Filebase/IPFS-backed song package persistence
- Story publication jobs for song assets
- Story CDR or locked-audio delivery wiring
- forced alignment or timed-lyrics enrichment
- explicit cover-art geometry validation
- explicit canvas-video geometry validation
- song-specific backend validation matching the domain docs

The old project did have a real publish flow, but it was a heavier release pipeline than current v2 intends.

## Current V2 Reality

The v2 contract and docs already point toward a post-first, asset-optional model:

- [post.md](../specs/domain/post.md)
- [asset.md](../specs/domain/asset.md)
- [composer.md](../specs/domain/composer.md)
- [karaoke.md](../specs/domain/karaoke.md)

Current intended v2 posture from those docs:

- every submission is a post first
- some posts also create or attach an asset
- song posts require audio and lyrics at post creation time
- instrumental and vocal stems are optional enrichment inputs
- timed lyrics from forced alignment are optional async enrichment
- song posts should be public, not anonymous, in v0
- song assets should publish to Story asynchronously
- Filebase/IPFS or equivalent should hold canonical content blobs

Current implementation does not yet enforce most of that. The worker only treats song posts as a generic post variant and does not implement the artifact, enrichment, or publish pipeline.

Relevant current files:

- [contracts index](../pirate-api/services/contracts/src/index.ts)
- [post schema](../specs/api/src/components/schemas/posts.yaml)
- [post store validation](../pirate-api/services/api/src/lib/posts/community-post-store.ts)
- [post service](../pirate-api/services/api/src/lib/posts/post-service.ts)

## Legacy Pipeline Inventory

The old project had a concrete music publish flow with real artifact staging and finalize steps.

High-signal legacy files:

- [publish guide](../../LEGACY-DO-NOT-USE/AMARA_BLUES_PUBLISH_GUIDE.md)
- [folder publish script](../../LEGACY-DO-NOT-USE/pirate-api/services/api/scripts/music/publish-from-folder.ts)
- [artifact staging route](../../LEGACY-DO-NOT-USE/pirate-api/services/api/src/routes/music/publish/artifacts.ts)
- [finalize route](../../LEGACY-DO-NOT-USE/pirate-api/services/api/src/routes/music/publish/finalize-route.ts)
- [canonical lyrics and alignment](../../LEGACY-DO-NOT-USE/pirate-api/services/api/src/routes/music/publish/lyrics-canonical.ts)

Legacy capabilities that definitely existed:

- structured folder-based release ingestion
- required audio, cover, lyrics, preview, instrumental stem, and vocal stem
- optional canvas upload
- size and content-type checks for uploaded artifacts
- Filebase/R2-style blob uploads with stored refs and hashes
- Arweave Turbo uploads for lyrics, manifests, and encrypted delivery artifacts
- canonical lyrics upload and persisted alignment state
- ElevenLabs forced alignment integration
- Story-oriented finalize flow with publish jobs and chain state
- track manifest and locked delivery artifact generation

Legacy enforcement detail:

- artifact stage rejected missing `lyrics`, `instrumental`, and `vocals`
- preflight rejected publish unless `cover`, `preview`, `lyrics`, `instrumental`, and `vocals` were all already staged

So the legacy “required stems” rule was not just a script convention. It was enforced in the API at both staging time and publish-approval time.

Legacy release assumptions:

- a song publish was treated like a release bundle, not a lightweight social post
- stems were required at publish time
- preview clips were required and explicitly bounded
- finalize behavior was tightly coupled to Story publication and publish coordinator state

## Legacy Capability Review

### Keep

These legacy ideas are still structurally right for v2:

- staged artifact upload rather than one giant create-post payload
- separate canonical app rows from large media binaries
- content refs, hashes, and analysis state stored in Pirate DB
- async publish/finalize job model for Story-facing work
- canonical lyrics object with persisted alignment metadata
- deterministic preview validation rules
- explicit locked-delivery preparation for gated assets

### Change

These should survive, but in a different form:

- stems
  - legacy: required at publish time
  - v2: optional async enrichment, consistent with [karaoke.md](../specs/domain/karaoke.md)
- forced alignment
  - legacy: wired into the publish flow
  - v2: async enrichment after audio + lyrics are available
- Story publication timing
  - legacy: tightly coupled to the release pipeline
  - v2: separate social post creation from later asset publication jobs
- preview clip handling
  - legacy: required in the release bundle
  - v2: should likely be optional for the first publish slice unless commerce/discovery requires it
- folder-based publish script
  - legacy: useful operations tooling
  - v2: keep only as a thin client over the canonical API, not as the model itself
- lyrics pipeline
  - legacy: canonical lyrics plus translations plus chain writes were bundled together, with Arweave used as a major storage path
  - v2: keep the canonical lyrics object, but make translation and chain propagation separate async jobs and avoid Arweave in the first pass
- storage backend mix
  - legacy: split across Filebase/R2-style blob storage and Arweave Turbo for lyrics/manifests/delivery artifacts
  - v2: simplify to one Filebase/IPFS-style storage abstraction in the first pass

### Drop

These legacy assumptions should not become the v2 default:

- every song publish must arrive as a full release bundle
- stems are mandatory before a song can exist socially
- post creation should block on Story publication
- folder-layout conventions should define the domain contract
- remix and attribution logic should stay implicit inside a release script instead of explicit API contracts
- Arweave-specific pipeline requirements in the first v2 implementation

## Geometry And Media Rules

The user concern is valid: cover and canvas rules need to be explicit if they matter.

What the legacy audit shows:

- legacy artifact staging clearly validated file presence, size, and content type
- legacy Remotion/public-video tooling clearly supported `9:16`, `16:9`, `1:1`, and `4:3`
- this audit did not find clear API-layer enforcement that:
  - cover art must be exactly `1:1`
  - canvas video must be exactly `9:16`

That means geometry rules should be treated as unresolved v2 product decisions, not inherited facts.

Recommended v2 posture:

- cover art
  - if Pirate wants predictable song-card presentation, make `1:1` explicit in spec and validate it server-side at artifact-stage time
- canvas video
  - if Pirate wants a canonical music canvas format, make `9:16` explicit in spec and validate it server-side at artifact-stage time
- if geometry is only a UI preference and not a publish invariant, say that explicitly and avoid pretending it is a backend rule

## Recommended V2 Song-Publish Model

The right v2 model is a post-first pipeline with async asset and enrichment stages.

### Phase 0: Contract Hardening

Before any blob pipeline work:

- enforce song-create validation on the API surface
- reject anonymous song posts
- require audio input refs and lyrics text for `post_type = song`
- require remix posts to include upstream reference input and `rights_basis = derivative`
- decide whether preview, cover, and canvas are required, optional, or deferred

Deliverable:

- coherent request/response contract and Bruno coverage for song-specific validation

### Phase 1: Artifact Intake

Add a dedicated artifact-stage flow for song posts or song-asset drafts.

Recommended artifacts:

- primary audio
- lyrics text
- cover art optional or required, depending on product decision
- preview clip optional in first pass
- canvas optional
- instrumental stem optional
- vocal stem optional

At this stage Pirate should:

- validate content type
- validate file size
- compute hashes
- persist storage refs
- validate geometry if cover/canvas rules are product invariants
- use one Filebase/IPFS-style storage path in the first pass rather than splitting artifacts across Filebase and Arweave

Deliverable:

- app rows contain refs and hashes
- no Story dependency yet

### Phase 2: Post Create And Asset Draft

After artifact intake:

- create the social post
- create or schedule the attached audio asset draft when policy requires it
- keep feed publication independent from Story success

Recommended rule:

- a song post may publish socially once required v0 inputs exist
- the attached asset may remain in `draft` or `story_requested` while async jobs continue

### Phase 3: Async Enrichment

Once audio + lyrics exist:

- run copyright and safety analysis
- optionally run forced alignment
- persist timed-lyrics refs if alignment succeeds
- attach stems later when provided
- mark `karaoke_ready` only when the karaoke package is complete

This aligns with:

- [karaoke.md](../specs/domain/karaoke.md)
- [asset.md](../specs/domain/asset.md)

### Phase 4: Story Publication

When the song asset is ready for rights-bearing publication:

- publish to Story asynchronously
- update `publication_state`
- persist Story IDs and publication refs
- handle retries and failure states independently from feed visibility

Important rule:

- social post success must not depend on Story success

### Phase 5: Locked Delivery

If `access_mode = locked`:

- prepare a locked delivery object for the audio payload
- use Story-native access primitives such as CDR where applicable
- keep entitlement and delivery on the asset layer, not the social post row

This matches the direction already stated in:

- [asset.md](../specs/domain/asset.md)
- [locked-asset-delivery.md](../specs/contracts/locked-asset-delivery.md)

## Recommended Keep / Change / Drop Matrix

| Capability | Legacy | V2 decision |
|---|---|---|
| Structured artifact staging | Present | Keep |
| Filebase/IPFS-like content refs | Present | Keep |
| Preview clip validation | Present | Keep, but preview may be optional in first pass |
| Canonical lyrics object | Present | Keep |
| ElevenLabs forced alignment | Present | Keep as async enrichment, not publish-critical |
| Lyrics translations during publish | Present | Change to separate async enrichment |
| Required stems at publish time | Present | Change to optional enrichment |
| Story finalize job | Present | Keep |
| Story-coupled post publish | Present in practice | Drop |
| Arweave Turbo for lyrics/manifests/delivery | Present | Drop from first v2 pass |
| Folder-based release bundle as product contract | Present | Drop |
| Cover `1:1` enforcement | Not clearly specified | Decide explicitly in v2 |
| Canvas `9:16` enforcement | Not clearly specified | Decide explicitly in v2 |

## Open Decisions That Need To Be Written Down

These are the unresolved points that should become explicit specs before implementation:

1. Is cover art required for song posts in v0?
2. If cover art exists, is exact `1:1` a publish invariant or just a preferred presentation crop?
3. Is canvas supported in v0 song publish, or deferred?
4. If canvas is supported, is exact `9:16` required?
5. Is preview clip required for initial song publish, or optional?
6. Should forced alignment run automatically or only on explicit creator opt-in?
7. Should v2 say "Filebase/IPFS or equivalent" and keep the storage interface abstract while still standardizing on one backend family in the first pass?
8. At what exact point is the audio asset row created:
   - at post create
   - at artifact intake completion
   - when Story publication is requested
9. What is the minimum remix reference payload required at create time?
10. If Arweave is intentionally excluded from v2 first pass, what metadata or delivery shapes, if any, still need a second persistence class later?

## Immediate Next Spec Work

Before implementing song publish, add or update these docs:

1. `specs/domain/post.md`
   - make song-create requirements executable, not just descriptive
2. `specs/domain/asset.md`
   - define when song asset drafts are created and when Story publication is requested
3. `specs/domain/composer.md`
   - decide whether cover, preview, and canvas are required or optional in the UI
4. new API contract doc or path spec
   - define artifact-stage endpoints and job lifecycles
5. storage note
   - explicitly standardize the first v2 song pipeline on Filebase/IPFS-style refs and not Arweave

## Recommended Implementation Order

1. Enforce song-specific create validation on the current post API.
2. Add artifact-stage endpoints and storage refs for song inputs.
3. Create asset draft rows and async enrichment jobs.
4. Add forced-alignment integration behind the enrichment boundary.
5. Add Story publish jobs and publication-state reads.
6. Add locked delivery only after public song publish is stable.

## Audit Conclusion

The current v2 post APIs are a valid foundation for song posts, but they are only the shell.

The real song-publish system is still ahead of us.

The correct v2 direction is not to port the legacy release pipeline unchanged. It is to keep the staged storage, canonical lyrics, async enrichment, and Story publication ideas while dropping the legacy assumption that every song starts as a full release bundle with mandatory stems, Arweave dependencies, and tightly coupled finalize behavior.
