# Submission Audit Test Matrix

Status: draft

Purpose:

- turn the current submission-spec hardening work into an audit-friendly execution matrix
- map each rule to at least one concrete pass or fail case
- give the API repo's Bruno harness a clear target set of acceptance checks

Related:

- [post schema](../../specs/api/src/components/schemas/posts.yaml)
- [community post route](../../specs/api/src/paths/communities.yaml)
- [song artifact schema](../../specs/api/src/components/schemas/song-artifacts.yaml)
- [song publish state machine](./song-publish-v0-state-machine.md)

Harness note:

- the executable Bruno collection now lives in `pirate-api/services/api/bruno`
- Tableland publication is deferred for launch, so no submission path should depend on registry publication state.
- this doc is the rule matrix that collection should implement
- case IDs below should remain stable so audit notes, screenshots, and CI logs can reference the same identifiers

## Preconditions

Unless a case says otherwise, assume:

- the caller is authenticated
- the caller is a member of the target community
- the caller satisfies `verification_capabilities.unique_human.state = verified`
- referenced media refs or upload IDs were created by the same caller in the same community
- the target community allows the requested post type

## Create Post Cases

| Case ID | Route | Goal | Expected result |
|---|---|---|---|
| `POST-001` | `POST /communities/{community_id}/posts` | Create minimal text post with `body` only | `201` or `202`; payload accepted |
| `POST-002` | `POST /communities/{community_id}/posts` | Create minimal text post with `title` only | `201` or `202`; payload accepted |
| `POST-003` | `POST /communities/{community_id}/posts` | Submit text post with neither `title` nor `body` | `400`-class validation failure |
| `POST-004` | `POST /communities/{community_id}/posts` | Submit text post with forbidden `media_refs` | `400`-class validation failure |
| `POST-005` | `POST /communities/{community_id}/posts` | Create image post with one `image/*` media ref | `201` or `202`; payload accepted |
| `POST-006` | `POST /communities/{community_id}/posts` | Submit image post with empty `media_refs` | `400`-class validation failure |
| `POST-007` | `POST /communities/{community_id}/posts` | Submit image post with non-image MIME ref | `400`-class validation failure |
| `POST-008` | `POST /communities/{community_id}/posts` | Create video post with one `video/*` media ref | `201` or `202`; payload accepted |
| `POST-009` | `POST /communities/{community_id}/posts` | Submit video post with empty `media_refs` | `400`-class validation failure |
| `POST-010` | `POST /communities/{community_id}/posts` | Submit video post with non-video MIME ref | `400`-class validation failure |
| `POST-011` | `POST /communities/{community_id}/posts` | Create link post with `link_url` | `201` or `202`; payload accepted |
| `POST-012` | `POST /communities/{community_id}/posts` | Submit link post without `link_url` | `400`-class validation failure |
| `POST-013` | `POST /communities/{community_id}/posts` | Submit link post with forbidden `media_refs` | `400`-class validation failure |
| `POST-014` | `POST /communities/{community_id}/posts` | Create song post with `song_artifact_bundle_id` only | `201` or `202`; payload accepted if bundle is `ready` |
| `POST-015` | `POST /communities/{community_id}/posts` | Create inline song post with `audio/*` media ref plus `lyrics` | `201` or `202`; payload accepted |
| `POST-016` | `POST /communities/{community_id}/posts` | Submit song post with neither bundle nor inline audio+lyrics | `400`-class validation failure |
| `POST-017` | `POST /communities/{community_id}/posts` | Submit song post with bundle plus inline `media_refs` | `400`-class validation failure |
| `POST-018` | `POST /communities/{community_id}/posts` | Submit song post with bundle plus inline `lyrics` | `400`-class validation failure |
| `POST-019` | `POST /communities/{community_id}/posts` | Submit song post with `identity_mode = anonymous` | `400`-class validation failure |
| `POST-020` | `POST /communities/{community_id}/posts` | Submit inline song post with non-audio MIME ref | `400`-class validation failure |
| `POST-021` | `POST /communities/{community_id}/posts` | Submit remix song with `song_mode = remix`, `rights_basis = derivative`, and `upstream_asset_refs` | accepted if other checks pass |
| `POST-022` | `POST /communities/{community_id}/posts` | Submit remix song without `upstream_asset_refs` | server rejection per runtime rule |
| `POST-023` | `POST /communities/{community_id}/posts` | Submit derivative post with `rights_basis = derivative` but no `upstream_asset_refs` | server rejection per runtime rule |
| `POST-024` | `POST /communities/{community_id}/posts` | Retry a successful create with same `idempotency_key` and same payload | original post returned, no duplicate row |
| `POST-025` | `POST /communities/{community_id}/posts` | Submit valid create while user lacks required community membership or verification | `401` or `403`, depending on failure mode |

## Song Artifact Cases

| Case ID | Route | Goal | Expected result |
|---|---|---|---|
| `SONG-001` | `POST /communities/{community_id}/song-artifact-uploads` | Create upload intent for `primary_audio` | `201` upload intent |
| `SONG-002` | `PUT /communities/{community_id}/song-artifact-uploads/{song_artifact_upload_id}/content` | Upload bytes or base64 to a pending upload intent | `200`; upload status becomes `uploaded` |
| `SONG-003` | `POST /communities/{community_id}/song-artifacts` | Register bundle using uploaded `primary_audio` ref and lyrics | `201`; bundle row created |
| `SONG-004` | `POST /communities/{community_id}/song-artifacts` | Attempt bundle registration with unknown upload ID | `400` or `404` |
| `SONG-005` | `POST /communities/{community_id}/song-artifacts` | Attempt bundle registration with upload from different user or community | `403` or `404` |
| `SONG-006` | `POST /communities/{community_id}/song-artifacts` | Attempt bundle registration with upload still `pending_upload` | `400`-class validation failure |
| `SONG-007` | `POST /communities/{community_id}/posts` | Attempt song post create from bundle not in `ready` state | server rejection per runtime rule |
| `SONG-008` | `POST /communities/{community_id}/posts` | Attempt second song post create from already consumed bundle | server rejection per runtime rule |

## Analysis And Moderation Cases

| Case ID | Route | Goal | Expected result |
|---|---|---|---|
| `ANL-001` | `POST /communities/{community_id}/posts` | Safe publishable submission | `201`; `analysis_state` non-blocking |
| `ANL-002` | `POST /communities/{community_id}/posts` | Submission that resolves to `review_required` | `202`; non-published hold state |
| `ANL-003` | `POST /communities/{community_id}/posts` | Submission that resolves to `blocked` | `422` |
| `ANL-004` | `POST /communities/{community_id}/posts` | Adult-classified text or lyrics content | accepted only with server-authored `age_gate_policy = 18_plus` if publishable |
| `ANL-005` | `POST /communities/{community_id}/posts` | Attempt to send client-owned `age_gate_policy` in create payload | request rejected or ignored; field must not be writable |
| `ANL-006` | `POST /communities/{community_id}/posts` | Content that requires upstream reference attachment | `201`/`202` only when runtime rule is satisfied; otherwise reject or hold according to server behavior |

## Link And Market Context Cases

| Case ID | Route | Goal | Expected result |
|---|---|---|---|
| `LNK-001` | `POST /communities/{community_id}/posts` | Create valid link post in community with market context enabled | create succeeds without waiting for market matching |
| `LNK-002` | `GET /posts/{post_id}` after publish | Inspect newly created link post before market job attaches anything | post read succeeds even if `market_context` is null or absent |
| `LNK-003` | async worker + `GET /posts/{post_id}` | Confirm eligible published top-level link can later show `market_context.status = attached` or `no_match` | sidecar appears post-create only |
| `LNK-004` | `POST /communities/{community_id}/posts` | Create link post while market-context policy is off | create result unchanged; only enrichment behavior changes |

## Policy Surface Cases

For each policy endpoint below, the minimum audit set is:

- one `GET` read returning the resolved policy
- one successful `PATCH`
- one auth or eligibility failure case

| Case Prefix | Route family |
|---|---|
| `POL-PRV-*` | `/communities/{community_id}/provenance-policy` |
| `POL-PRO-*` | `/communities/{community_id}/promotion-policy` |
| `POL-ADL-*` | `/communities/{community_id}/adult-content-policy` |
| `POL-GRP-*` | `/communities/{community_id}/graphic-content-policy` |
| `POL-LNG-*` | `/communities/{community_id}/language-policy` |
| `POL-CAP-*` | `/communities/{community_id}/capture-edit-policy` |
| `POL-MOT-*` | `/communities/{community_id}/motion-media-policy` |
| `POL-MKT-*` | `/communities/{community_id}/market-context-policy` |
| `POL-SRC-*` | `/communities/{community_id}/source-policy` |
| `POL-AUT-*` | `/communities/{community_id}/content-authenticity-policy` |

## Named Scenario Cases

| Case ID | Goal | Expected result |
|---|---|---|
| `SCN-INF-001` | Seed an existing-user fixture plus an operational Infinity community via `scripts/community/bootstrap-infinity-existing-user.sh` | control-plane user fixture exists, Infinity local community DB exists, creator membership is seeded |
| `SCN-INF-002` | Inspect the bootstrapped Infinity community in control-plane state | `status = active`, `provisioning_state = active` |
| `SCN-INF-003` | Create a post as the seeded existing Infinity user | create succeeds with `201` or `202` if all normal posting preconditions pass |
| `SCN-INF-004` | Confirm the Infinity local-stub scenario does not depend on Tableland | community create and read flows succeed without any registry-publication step |

## Evidence Checklist

Each implemented case should produce:

- request payload used
- response status
- response body or key error shape
- any created resource IDs
- for async cases, follow-up poll or read result
- CI log or Bruno result keyed by case ID

## Minimum Audit Exit Criteria

- every `POST-*` and `SONG-*` case has either automated coverage or an explicit waiver
- every documented server-enforced cross-field rule has at least one failing case
- at least one `201`, one `202`, and one `422` create-post outcome are proven
- one link post proves market context is non-gating at create time
- one song bundle proves bundle-backed create works
- one invalid song bundle path proves non-`ready` or consumed bundles are rejected
