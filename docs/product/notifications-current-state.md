# Notifications Current State

Status: implemented first slice, not full notification system

Related:

- [pirate-api/services/api/src/lib/notifications/notification-service.ts](../../pirate-api/services/api/src/lib/notifications/notification-service.ts)
- [pirate-api/services/api/src/lib/notifications/notification-store.ts](../../pirate-api/services/api/src/lib/notifications/notification-store.ts)
- [pirate-api/services/api/src/lib/comments/comment-service.ts](../../pirate-api/services/api/src/lib/comments/comment-service.ts)
- [pirate-api/services/api/src/lib/communities/community-create-service.ts](../../pirate-api/services/api/src/lib/communities/community-create-service.ts)
- [pirate-web/src/app/authenticated-route-renderer.tsx](../../pirate-web/src/app/authenticated-route-renderer.tsx)
- [pirate-web/src/lib/notifications/use-notification-summary.ts](../../pirate-web/src/lib/notifications/use-notification-summary.ts)
- [pirate-api/services/contracts/src/index.ts](../../pirate-api/services/contracts/src/index.ts)

## Purpose

This doc describes what the notification system does today.

It is intentionally narrower than the long-term plan. It answers:

1. what notification types exist right now
2. who receives them
3. what the inbox and red dot mean
4. what is not implemented yet

## Current Surfaces

Today Pirate has two notification surfaces:

1. `Tasks`
2. `Activity`

`Tasks` are durable product actions that stay open until completed or dismissed.

`Activity` is append-only event history with unread state.

The header/mobile red dot means:

- there is at least one open task, or
- there is at least one unread activity item

## Implemented Task Types

### `namespace_verification_required`

Created when:

- a user creates a community without attaching a namespace during creation

Recipient:

- the owner who created that community

Behavior:

- one open task per `(user, type, subject_id)`
- the `subject_id` is the community id
- payload currently includes `community_display_name`
- the task appears in the `Tasks` tab
- the task can be dismissed from the inbox
- the task is resolved automatically when namespace attach succeeds for that community

What this means product-wise:

- the first red dot after namespaceless community creation should usually be this task
- this is currently the highest-priority conversion task in the system

## Implemented Activity Event Types

### `comment_reply`

Created when:

- someone replies directly to your comment

Recipient:

- the parent comment author

Guardrails:

- no self-notification
- if the post author is the same person as the parent comment author, they only get one notification for that reply

Payload today:

- `community_id`
- `thread_root_post_id`

### `post_commented`

Created when:

- a new comment is created anywhere under your post's thread root

Recipient:

- the thread root post author

Important nuance:

- this is not "notify every participant in the thread"
- this is "notify the post author when a new comment or reply is added anywhere on their post"

So for the specific question "new comments in threads (every one?)":

- the post author does get notified for every newly created comment on their post, including replies deeper in the thread
- other thread participants do not get notified unless the event is also a direct reply to their own comment

Guardrails:

- no self-notification
- if the parent comment author and post author are the same user, only one notification is emitted for that reply

Payload today:

- `community_id`

## What Does Not Exist Yet

These types exist in contracts but are not emitted yet:

- `mention`
- `mod_event`
- `community_update`
- `namespace_verification_pending`
- `payout_setup_required`

These product behaviors do not exist yet:

- notify every participant in a thread
- follow-thread subscriptions
- thread mute controls
- notification preferences
- push notifications
- Android device token registration
- actor/profile rendering in the inbox UI
- deep-link navigation from activity items
- batching or digesting noisy activity
- mention parsing and mention fanout

## Inbox Behavior Today

### Tasks tab

- loads open tasks only
- orders by `priority DESC, updated_at DESC`
- currently renders a dedicated `Verify` action only for `namespace_verification_required`
- supports dismiss

### Activity tab

- loads the activity feed
- opening the tab marks all unread activity as read
- the unread badge clears immediately in client state
- the visible items are patched locally so unread styling clears without waiting for the next poll

Feed behavior:

- newest first
- cursor pagination exists in the API
- default page size is `25`
- max page size is `100`

## API Endpoints In Use

Implemented notification endpoints:

- `GET /notifications/summary`
- `GET /notifications/tasks`
- `GET /notifications/feed`
- `POST /notifications/mark-read`
- `POST /notifications/dismiss-task`

Summary semantics:

- `open_task_count`
- `unread_activity_count`
- `has_unread = open_task_count > 0 || unread_activity_count > 0`

## Delivery Model Today

Source of truth:

- control-plane notification tables

Current persistence:

- `user_tasks`
- `notification_events`
- `notification_receipts`

Current delivery channels:

- in-app inbox only
- in-app red dot only

Not implemented:

- APNS / FCM push
- email
- SMS

## Practical Rules As Implemented

If a user creates a namespaceless community:

- create `namespace_verification_required`

If a user replies to someone else's comment:

- notify the parent comment author with `comment_reply`
- also notify the post author with `post_commented` if that is a different user

If a user adds a top-level comment to someone else's post:

- notify the post author with `post_commented`

If a user comments on their own post or replies to their own comment:

- no notification is emitted to themselves

If a user opens `Activity`:

- all of their unread activity receipts are marked read

## Known Product Gaps

The system is deliberately small right now. The biggest gaps are:

1. activity items are still generic and not rich enough to feel like a real inbox
2. there is no thread-level subscription model
3. there are no preferences or channel controls
4. there is no push delivery path for Android
5. moderation/system/community notifications are reserved but not active

## Recommended Next Expansion Order

1. make activity rows actionable with deep links and actor display
2. add `mention`
3. add `mod_event`
4. add preferences by event type and channel
5. add Android push token registration and push fanout
6. add follow-thread and mute controls only after the default fanout model is settled
