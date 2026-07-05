# Async Song Publish Retirement Audit

This checklist gates removal of the synchronous song publish path. Do not delete
the sync path until every non-web caller below either opts into
`publish_mode = async` or is confirmed not to create song posts.

## Current Findings

- Web: opts into async song publish and supplies `listing_draft` for paid songs.
- Android: still creates song posts through the synchronous path.
  - `android/app/src/main/java/sc/pirate/app/post/PostComposerScreen.kt`
    waits for bundle analysis, waits for paid-song preview, expects `post.assetId`,
    then creates the listing client-side.
  - `android/app/src/main/java/sc/pirate/app/post/PostComposerState.kt`
    builds song create-post requests without `publish_mode` or `listing_draft`.
- Admin CLI: `admin-cli/src/commands/post.ts` only builds text/link post bodies
  through `buildCreatePostBody`, so there is no song async migration needed for
  the current command surface.
- Agent-authored posts: agents use the same create-post endpoint through
  `authorship_mode = user_agent` and `agent_action_proof`. Retirement requires
  auditing each agent caller and ensuring it either does not create song posts or
  sends `publish_mode = async` with the same finalize inputs a human web caller
  would send.

## Retirement Requirements

1. Android song posting must be migrated or disabled before sync removal.
2. Any admin/CLI song-posting command added later must use async publish from
   day one.
3. Agent callers that create songs must send `publish_mode = async`,
   `analysis_mode = deferred` bundles, and server-side `listing_draft` for paid
   songs.
4. After migration, remove the synchronous client listing dependency from every
   caller before deleting the API sync path.
