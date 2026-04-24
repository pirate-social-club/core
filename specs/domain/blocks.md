# Blocks

Status: current working spec

Related docs:

- [user.md](./user.md)
- [profile.md](./profile.md)
- [follow.md](./follow.md)
- [messaging.md](./messaging.md)
- [community.md](./community.md)
- [notifications.md](./notifications.md)

## Purpose

This doc defines Pirate's user-level block and mute model.

It covers:

- block semantics and scope
- mute semantics and scope
- relationship to follows, messaging, and community interactions

It does not cover:

- community-level bans (see [community.md](./community.md))
- moderation tooling for enforcing blocks at scale
- platform-wide admin blocks or shadowbans

## Core Principle

Block is a safety boundary. Mute is a visibility preference.

Block should prevent direct social interaction and personal-surface visibility between two users. It does not override shared community visibility. Mute should suppress the muted user's content from the muter's personal feeds without preventing interaction.

## Block

### Block Action

When user A blocks user B:

- user B is removed from user A's following list if a follow edge existed
- user A is removed from user B's following list if a follow edge existed
- user B may not follow user A again while the block is active
- user B may not initiate DMs to user A
- user A may not initiate DMs to user B (block is mutual for messaging)
- user B's posts and profile should not appear in user A's personal feeds and profile/search results
- user A's posts and profile should not appear in user B's personal feeds and profile/search results

Suggested v0 `user_blocks` shape:

- `user_block_id`
- `blocker_user_id`
- `blocked_user_id`
- `created_at`

Rules:

- unique on `(blocker_user_id, blocked_user_id)`
- blocks are symmetric for interaction purposes: either party may initiate the block, and both lose interaction capability
- blocks are append-only in v0: there is no unblock API in v0, though one may be added later
- a user may not block themselves
- the authoritative shared-community exception is defined below under Block And Communities

### Block And Communities

Blocks do not override community membership or community visibility.

Rules:

- if both users are members of the same community, they may still see each other's posts within that community's shared feed and thread surfaces
- blocks do not remove community membership
- blocks do not prevent a blocked user from viewing public community content authored by the blocker
- blocks apply to personal surfaces such as `Home`, `Your Communities`, profile pages, DMs, and user-targeted search — not to shared community feeds or thread reads inside a community

This preserves the community as a shared space while protecting personal boundaries.

### Block And Anonymous Posts

Rules:

- blocks apply to `user_id`, not to anonymous labels
- a user who has been blocked may still see the blocker's anonymous posts within a shared community, because the anonymous label does not reveal identity
- blocks must not become a vector for deanonymization

## Mute

### Mute Action

When user A mutes user B:

- user B's posts should be deprioritized or hidden from user A's personal feed surfaces
- user B is not prevented from following, messaging, or interacting with user A
- user B does not receive any notification about being muted
- user A may still see user B's content in community feeds and search

Suggested v0 `user_mutes` shape:

- `user_mute_id`
- `muter_user_id`
- `muted_user_id`
- `created_at`

Rules:

- unique on `(muter_user_id, muted_user_id)`
- mutes are one-directional: user B can still see user A's content normally
- mutes are reversible: user A may unmute user B
- a user may not mute themselves

## Relationship To Notifications

Rules:

- blocked users may not trigger notifications for the blocker
- muted users' notifications may be suppressed or deprioritized at the notification-system level
- `reply`, `mention`, and `reaction` notifications from blocked or muted users should follow these rules

## Open Questions

- Should v0 support unblock, or keep blocks append-only?
- Should muting also suppress mention notifications?
- Should blocks be visible to the blocked user, or should they be silent?
