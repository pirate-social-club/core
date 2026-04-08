# Notifications

Status: draft

Related docs:

- [guild.md](./guild.md)
- [messaging.md](./messaging.md)
- [post.md](./post.md)
- [profile.md](./profile.md)
- [user.md](./user.md)
- [blocks.md](./blocks.md)

## Purpose

This doc defines Pirate's app-level activity notification system.

It covers:

- the canonical notification object
- which notification kinds exist in v0
- actor identity rendering rules, including anonymous actors
- grouped and flat read models
- seen/unseen semantics
- write-path authorization boundaries
- unread badge semantics for Activity

It does not cover:

- direct-message transport internals
- push delivery, email delivery, or mobile OS notification wiring
- final notification copy
- every future notification kind Pirate may add

## Core Principle

Notifications are an app-owned activity feed for actionable product events.

They are not:

- the source of truth for the underlying action
- a public write surface
- a direct-message transport
- a dump of every low-signal event in the system

The source of truth for an action remains the underlying post, guild-membership request, moderation action, or other domain object. Notifications are derived read models created by trusted server-side event handlers.

## Separation From Messaging

Notifications and direct messages are separate systems.

- Notifications power the Activity inbox
- Messaging powers the Messages inbox
- v0 unread badge counts must remain separate at the API boundary, even if a client later combines them in navigation UI

Recommended unread-count endpoints:

- `GET /me/notifications/unread-count` for Activity
- `GET /me/messaging/unread-count` for Messages

Recommended v0 notification endpoints:

- `GET /me/notifications`
- `GET /me/notifications/grouped`
- `POST /me/notifications/seen`
- `GET /me/notifications/unread-count`

## Canonical Notification Object

Suggested v0 notification fields:

- `notification_id`
- `recipient_user_id`
- `kind`
- `entity_type`
- `entity_id`
- `actor_user_id` nullable
- `actor_identity_mode`
- `guild_id` nullable
- `group_key` nullable
- `dedupe_key`
- `read_at` nullable
- `created_at`

Suggested meanings:

- `kind`
  - `membership_request_received`
  - `membership_request_approved`
  - `membership_request_rejected`
  - `reply`
  - `mention`
  - `reaction`
  - `quote`
  - `post_review_required`
  - `post_blocked`
- `entity_type`
  - `guild_membership_request`
  - `post`
  - `post_reaction`
  - `moderation_action`
- `actor_user_id`
  - internal actor reference when a human or system actor exists
  - nullable for some system-generated events
- `group_key`
  - read-model grouping key used by grouped notification surfaces
  - nullable when the notification should stand alone
- `dedupe_key`
  - internal idempotency key used by notification writers
  - not a user-facing grouping concept

Rules:

- `notification_id` is an opaque app-issued ID
- `recipient_user_id` is always the canonical destination
- `actor_user_id` is privileged internal data and must not be exposed directly in public notification read models
- `read_at = null` means unseen
- notifications are append-only except where this spec explicitly allows update-in-place aggregation for a specific kind

## Actor Identity Rendering

Notifications must preserve the same privacy boundary as the action that triggered them.

Suggested v0 `actor_identity_mode` values:

- `public`
- `anonymous_guild_stable`
- `anonymous_thread_stable`
- `anonymous_post_ephemeral`

Interpretation:

- `actor_identity_mode` is a notification read-model projection, not a canonical user or post field
- it is derived from the triggering post's `identity_mode` plus `anonymous_scope`
- `public` means the actor may be rendered as their normal public identity
- anonymous modes mean the actor must be rendered through the corresponding anonymous presentation layer

Rules:

- the public read model must not expose `actor_user_id`
- if the triggering action was authored under anonymous guild presentation, the notification must render the actor as that anonymous label
- anonymous actor rendering in notifications must not leak the underlying `user_id`
- if the actor label is derived from guild-local scope, the notification read model should carry the rendered anonymous label as presentation data
- internal services may retain `actor_user_id` for audit, dedupe, and enforcement, but public clients must only receive scrubbed presentation data

Example:

- user A replies anonymously in a guild to user B's post
- user B receives a `reply` notification
- the notification actor renders as something like `anon_mercury-17`
- the notification must not expose user A's real profile handle or `user_id`

## V0 Notification Kinds

### Membership Request Received

Sent to moderators or admins responsible for admission review when a user submits a request to join a `membership_mode = request` guild.

Requirements:

- `entity_type = guild_membership_request`
- `entity_id = membership_request_id`
- `guild_id` required
- `actor_identity_mode = public`

### Membership Request Approved

Sent to the applicant when their request is approved.

Requirements:

- `entity_type = guild_membership_request`
- `entity_id = membership_request_id`
- `guild_id` required
- this is a standalone notification, not grouped

### Membership Request Rejected

Sent to the applicant when their request is rejected.

Requirements:

- `entity_type = guild_membership_request`
- `entity_id = membership_request_id`
- `guild_id` required
- this is a standalone notification, not grouped

### Reply

Sent when a user receives a reply on their post or thread entry.

Requirements:

- `entity_type = post`
- `entity_id = reply_post_id` or equivalent canonical triggering post
- actor identity must respect the triggering post's identity mode

### Mention

Sent when a user is explicitly mentioned by handle in supported text surfaces.

Requirements:

- `entity_type = post`
- `entity_id = post_id`
- actor identity must respect the triggering post's identity mode

### Reaction

Sent when a user receives one or more reactions on a target entity.

Requirements:

- `entity_type = post_reaction`
- reaction actor identity follows the reacted-to post's anonymous presentation state
- if the reacted-to post is non-anonymous, the reaction notification uses `actor_identity_mode = public`
- if the reacted-to post is anonymous, the reaction notification uses the corresponding anonymous actor mode derived from that post's anonymous scope
- v0 does not define a separate reaction-specific anonymous presentation layer distinct from post presentation

Aggregation rule:

- unread reaction notifications should aggregate into a single unread row per `(recipient_user_id, entity_type, entity_id, kind)`
- additional unread reactions update that unread row in place rather than creating notification spam
- once the aggregated reaction notification is marked seen, a later reaction may create a fresh unread row

### Quote

Sent when a user's post is quoted or explicitly referenced in a quote-like repost surface.

Requirements:

- `entity_type = post`
- `entity_id = quoting_post_id`
- actor identity must respect the quoting post's identity mode

### Post Review Required

Sent when a user's post is routed into moderation review after automated analysis.

Requirements:

- `entity_type = moderation_action`
- `entity_id = post_id`
- `actor_user_id` may be null because the writer is the system
- recipients are the guild moderators or equivalent review operators for the post's guild
- this notification is for workflow triage, not for the post author

### Post Blocked

Sent when a user's post cannot be published or is later blocked from publication.

Requirements:

- `entity_type = moderation_action`
- `entity_id = post_id`
- `actor_user_id` may be null because the writer is the system
- recipient is the post author

## Reserved But Not V0

The following kinds are explicitly reserved for later, but are not part of v0:

- `listing_sold`
- `followed_you`
- `guild_invite_received`

## Grouping Rules

Grouped read models need deterministic `group_key` derivation.

Recommended v0 derivation:

- `membership_request_received`
  - `group_key = "membership_request_received:guild:{guild_id}:pending"`
- `membership_request_approved`
  - `group_key = null`
- `membership_request_rejected`
  - `group_key = null`
- `reply`
  - `group_key = "reply:post:{parent_post_id}"`
- `mention`
  - `group_key = "mention:post:{post_id}"`
- `reaction`
  - `group_key = "reaction:{entity_type}:{entity_id}"`
- `quote`
  - `group_key = "quote:post:{quoted_post_id}"`
- `post_review_required`
  - `group_key = null`
- `post_blocked`
  - `group_key = null`

Rules:

- `group_key` is for inbox grouping behavior, not idempotency
- `dedupe_key` is for idempotent writing, not display grouping
- grouped reads may present one visible item backed by multiple underlying rows sharing a `group_key`
- if a notification kind is defined here as standalone, clients should not silently collapse it into grouped presentation

## Dedupe Rules

Notification writers must be idempotent.

Rules:

- every notification write path must compute a stable `dedupe_key`
- retries must not create duplicate rows for the same logical event
- `dedupe_key` should be scoped narrowly enough to prevent accidental suppression of distinct events

Examples:

- membership-request approval should dedupe by `membership_request_id + approved`
- post-blocked should dedupe by `post_id + blocked`
- reply should dedupe by `recipient_user_id + reply_post_id + kind`

## Read Models

Pirate should expose both flat and grouped notification reads.

### Flat Read

Recommended v0 shape:

- list of notifications ordered newest-first
- each item includes scrubbed actor presentation data
- each item includes `seen = boolean`
- cursor pagination

### Grouped Read

Recommended v0 shape:

- list of grouped notification buckets ordered by newest activity in the bucket
- each bucket exposes:
  - `group_key`
  - `kind`
  - representative target entity
  - grouped child notifications or aggregate preview data
  - `unseen_count`

Rules:

- flat and grouped reads may share the same underlying rows
- grouped reads must not bypass actor-scrubbing rules
- grouped reads for anonymous actors must still render the correct anonymous label presentation

## Seen Semantics

Rules:

- `read_at` marks when a notification became seen
- mark-seen is recipient-scoped only; users may not mark another recipient's notifications seen
- grouped read models should report unseen state based on whether any underlying child row is unseen
- reaction aggregation should preserve unseen semantics even when the row is updated in place

## Authorization And Write Path

Notifications are created by the server, never by the client directly.

Rules:

- the write path is an internal service boundary, not a public API endpoint
- clients may only read notifications and mark them seen
- trusted event handlers and background jobs may create notifications
- notification creation must happen after the source-of-truth write succeeds or transitions to a stable state

Examples of trusted writers:

- guild-membership request service
- post/reaction write service
- moderation workflow service
- analysis pipeline completion handler

## Unread Count

The Activity badge count should come from the notifications system only.

Recommended v0 endpoint:

- `GET /me/notifications/unread-count`

Rules:

- this endpoint returns the unread count for Activity, not Messages
- message unread counts are owned by the messaging system and exposed separately
- clients may combine counts visually in some navigation surfaces, but the API surfaces remain distinct

## Delivery

V0 requires in-app notification reads only.

Non-goals for v0:

- push delivery
- email delivery
- SMS delivery

Those may later fan out from the same canonical notification rows, but they are downstream delivery concerns rather than the domain model defined here.
