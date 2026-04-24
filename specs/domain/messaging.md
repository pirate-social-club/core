# Messaging

Status: current working spec

Related docs:

- [user.md](./user.md)
- [profile.md](./profile.md)
- [notifications.md](./notifications.md)
- [community.md](./community.md)
- [blocks.md](./blocks.md)

## Purpose

This doc defines Pirate's direct-messaging domain.

It covers:

- the v0 messaging scope
- the relationship between messaging and transport
- user-facing DM policy
- transport attachment state
- handle/address resolution rules
- unread count semantics
- public API implications

It does not cover:

- push delivery
- group chats or club channels
- final chat UI copy
- moderation tooling for message content
- every possible future transport beyond XMTP

## Normative Language

In this doc:

- `must` means required for a conforming v0 implementation
- `should` means the recommended default unless Pirate intentionally chooses otherwise
- `may` means optional behavior

## Core Principle

Messaging is a product domain.

XMTP is the v0 transport implementation, not the domain itself.

Pirate should model:

- who can message whom
- how unread state is exposed
- how users resolve a target

without hard-coding the entire product model into raw wallet-address assumptions.

## V0 Scope

V0 messaging supports:

- one-to-one direct messages only
- unread counts for the Messages inbox
- starting a conversation from a public profile or resolved handle/address input

V0 messaging does not support:

- club-wide channels
- room chat
- anonymous-identity messaging
- moderation-side break-glass identity resolution through chat surfaces
- message edits
- message deletion

## Separation From Notifications

Messaging and notifications are separate systems.

- Messaging powers the Messages inbox
- Notifications power the Activity inbox
- unread counts must remain separate at the API boundary

Required v0 unread-count endpoint:

- `GET /me/messaging/unread-count`

Recommended rule:

- clients may visually combine badges in some navigation surfaces
- the backend must still expose messaging unread state separately from notifications unread state

## DM Policy

Pirate should expose a user-level DM policy.

Suggested v0 `dm_policy` values:

- `open`
- `followers_only`
- `nobody`

Suggested v0 `user_messaging_settings` shape:

- `user_id`
- `dm_policy`
- `created_at`
- `updated_at`

Rules:

- `open` means any eligible user may initiate a DM
- `followers_only` means only users who already follow the target's public profile may initiate a DM
- `nobody` means no new inbound DMs may be initiated by ordinary users
- active user-level blocks defined in [blocks.md](./blocks.md) must be enforced before DM-policy checks; if either participant has blocked the other, DM initiation must fail
- existing conversations may remain readable even if policy later tightens, unless moderation/product policy says otherwise
- `dm_policy` must not live on the canonical `users` row
- `dm_policy` must not be inferred from transport-registration state
- `dm_policy` should live in user-controlled messaging settings, such as a `user_messaging_settings` row or equivalent settings object

### `followers_only` Consistency Boundary

`followers_only` depends on follow state that is derived from EFP and may be eventually consistent.

Rules:

- Pirate must treat `followers_only` checks as follow-read-model checks, not as instant canonical truth
- a brand-new follower may not be recognized immediately after the follow write settles
- DM initiation failures caused by stale follow state should fail clearly rather than creating a partial conversation

## Messaging Identity Boundary

Direct messages target users, not anonymous club personas.

Rules:

- DMs must resolve to a canonical user or the user's messaging transport attachment
- anonymous club labels such as `anon_mercury-17` are not valid DM targets
- enabling anonymous posting in a club does not create an anonymous DM identity
- DM affordances should only appear on non-anonymous public profile surfaces

## Transport Attachment State

Transport state should not live on the canonical `users` row.

Suggested v0 `user_messaging_transports` shape:

- `user_messaging_transport_id`
- `user_id`
- `transport`
- `address`
- `inbox_id` nullable
- `registration_state`
- `last_synced_at` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `transport`
  - `xmtp`
- `registration_state`
  - `uninitialized`
  - `pending`
  - `ready`
  - `failed`

Rules:

- `user_id` remains the canonical app identity
- transport attachment rows are operational integration state
- v0 should support `transport = xmtp` only
- future transports may reuse the same domain model without redefining messaging itself
- `registration_state = pending` means transport setup, inbox discovery, or registration sync is currently in flight
- `registration_state = ready` must imply `inbox_id` is non-null
- `registration_state = uninitialized` or `failed` may still have `inbox_id = null`
- `last_synced_at` refers to transport attachment sync state, such as XMTP registration or inbox discovery refresh, not to message-list synchronization

## Handle And Address Resolution

V0 should support starting a DM from:

- a public Pirate profile
- a supported `name.TLD`
- a raw wallet address

Recommended v0 resolution flow:

1. Normalize the input as a handle or wallet address
2. If the input is a handle, resolve handle to wallet address
3. Attempt XMTP inbox discovery by identifier using the resolved Ethereum address
4. If direct XMTP identifier lookup fails, fall back to published transport metadata such as `xmtp.inboxId`
5. Resolve the conversation against the discovered inbox ID

Rules:

- if the target cannot be resolved to a wallet address or inbox ID, DM initiation must fail clearly
- Pirate should prefer canonical profile resolution where possible, but the transport lookup still ultimately resolves through the user's transport-capable wallet identity
- v0 may support supported external/rooted handles so long as they resolve to an address and/or published inbox record

## Conversation Model

Suggested v0 conversation properties:

- `conversation_id`
- `participant_user_ids`
- `transport`
- `transport_conversation_ref`
- `updated_at`
- `last_message_preview` nullable
- `unread_count`

Rules:

- the transport-specific conversation reference may come from XMTP
- the app-level read model should still expose a stable conversation object to clients
- unread state should be computed for the authenticated user only
- `unread_count` should be treated as a per-user read-model field that may be materialized or cached from transport state
- `unread_count` is not the canonical source of truth for transport delivery state

## Public Read Surface

Profile read models should expose messaging capability without leaking unnecessary transport detail.

Suggested v0 read-model shape:

- `dm_capabilities`
  - `can_receive_dm`
  - `transport`
  - `inbox_id` nullable

Rules:

- `can_receive_dm` must reflect both `dm_policy` and whether the target has usable transport state
- public clients do not need the full transport attachment row
- `inbox_id` may be returned when product needs it, but is not required on every profile surface

## API Implications

Likely v0 endpoints:

- `GET /me/messaging/unread-count`
- `GET /me/conversations`
- `GET /me/conversations/{conversation_id}`
- `GET /me/conversations/{conversation_id}/messages`
- `POST /me/conversations`
- `POST /me/conversations/{conversation_id}/messages`

Notes:

- conversation creation may accept handle or address input and resolve it server-side
- if target resolution fails, DM policy denies initiation, or transport state is unusable, `POST /me/conversations` must fail with a clear 4xx response and must not create a stub conversation
- failed conversation creation should return a structured error code that distinguishes at least: unresolved target, DM-policy denial, and transport unavailable
- no public API should allow clients to spoof transport registration state
- transport synchronization and inbox discovery may involve internal services in addition to public endpoints

## Relationship To Old Pirate

Old Pirate already proves the v0 transport shape:

- XMTP is the working transport backend
- conversation creation accepts handle or address inputs
- XMTP inbox discovery uses direct identifier lookup with published-record fallback

V2 should preserve that working behavior while expressing it through a product-level messaging spec rather than an address-first transport-only model.

## Open Questions

- Should `followers_only` be part of v0, or should v0 begin with only `open` and `nobody`?
- Should existing conversations remain writable when `dm_policy` flips to `nobody`, or only readable?
- Which public handle families should be accepted directly in DM entry fields in v0?
- If `followers_only` fails because follow state is stale or unresolved, should Pirate standardize a retry hint in the error response, expose a dedicated recheck path, or leave retry behavior to clients?
