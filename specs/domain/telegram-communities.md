# Telegram Communities

Status: current working spec

Related docs:

- [community.md](./community.md)
- [community-machine-access.md](./community-machine-access.md)
- [messaging.md](./messaging.md)
- [notifications.md](./notifications.md)
- [attestations.md](./attestations.md)
- [community-pricing-policy.md](./community-pricing-policy.md)
- [community-money-policy.md](./community-money-policy.md)
- [marketplace.md](./marketplace.md)

External Telegram references:

- [Telegram Bot Features](https://core.telegram.org/bots/features)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## Purpose

This doc defines Pirate's Telegram integration for communities.

It covers:

- Telegram Mini App community discovery
- Telegram-first Pirate sessions
- linking an existing Telegram group to a Pirate community
- gate-aware Telegram chat access
- Telegram group and one-to-one assistant behavior
- the assistant context model needed for useful board-aware answers

It does not define:

- Telegram as Pirate's canonical social graph
- Telegram group creation by Pirate
- userbot or MTProto account automation
- full role sync between Pirate and Telegram
- Telegram topic mapping
- post sharing and announcement automation
- wallet-heavy onboarding for Telegram-first users

## Core Principles

Pirate remains the source of truth for community identity, membership, gates, roles,
pricing policy, money policy, commerce, and assistant configuration.

Telegram is a chat and discovery surface.

Rules:

- Telegram chat access must be downstream of Pirate community access.
- A Telegram account is an auth/linking input, not a replacement for `user_id`.
- A Telegram group is an external transport attached to a durable `community_id`.
- Community-specific Telegram operations use a community-owned Telegram bot configured by
  the community owner. That bot may grant or approve Telegram access only after Pirate gates
  pass.
- Pirate may also operate a platform bot for Pirate-level surfaces such as Mini App launch,
  account linking, and global discovery, but that platform bot must not be the visible group
  bot for a community-owned chat.
- The assistant identity and policy are community-owned Pirate state. Telegram is only a
  transport into that assistant.
- Assistant context must be audience-scoped. A context pack that is safe in a private
  user chat is not automatically safe in a Telegram group.

## Public API Naming

Storage fields may use explicit database names such as `community_id`, `user_id`,
`telegram_user_id`, and `telegram_chat_id`.

Public API JSON should follow Pirate's existing object-reference convention.

Rules:

- expose Pirate community refs as `community`, not `community_id`
- expose Pirate user refs as `user`, not `user_id`
- expose Telegram account refs under a named object such as `telegram_account`
- expose Telegram chat refs under a named object such as `telegram_chat`
- keep raw Telegram numeric ids out of public responses unless the caller is an owner,
  moderator, bot integration endpoint, or the Telegram account owner

## Telegram Chat Creation Boundary

Telegram bots should not be expected to create new groups for community owners.

Rules:

- The v0 product should connect an existing Telegram group or supergroup.
- Pirate should not rely on a userbot or custodial Telegram user session to create groups.
- The owner setup flow should avoid manual chat-id pasting.

Recommended owner flow:

1. The owner creates a Telegram bot through `@BotFather`.
2. The owner pastes that bot token into Pirate.
3. Pirate verifies the token with Telegram `getMe`, stores the token encrypted, creates a
   per-bot webhook secret, and registers a webhook for that community bot.
4. The owner adds the community bot to the target Telegram group or supergroup as an admin.
5. The owner taps `Connect Telegram chat` in the Pirate Mini App or web app.
6. Pirate creates a short-lived signed setup intent scoped to the community bot.
7. The client opens the community bot private chat with that setup intent.
8. The bot verifies the setup token, stores a Telegram `request_id` on the setup intent,
   and sends a Telegram native `request_chat` keyboard button.
9. The owner selects a group or supergroup they control and grants the bot required rights.
10. Telegram sends the bot a `chat_shared` update with the selected chat id.
11. The bot looks up the pending setup intent by `request_id`, owner Telegram user id,
   and private chat id, verifies its membership/admin permissions, and completes the link.

The bot should require, at minimum:

- ability to create invite links, when `link_mode = invite_link`
- ability to manage or approve join requests, when `link_mode = join_request`
- visibility into chat member updates needed for audit and cleanup

## Setup Intents

Owner chat linking should be mediated by a short-lived setup intent.

Suggested storage:

- `telegram_setup_intents`
  - `telegram_setup_intent_id`
  - `community_id`
  - `telegram_community_bot_id`
  - `owner_user_id`
  - `status`
  - `setup_token_hash`
  - `requested_permissions_json`
  - `request_id` nullable
  - `request_owner_telegram_user_id` nullable
  - `request_private_chat_id` nullable
  - `request_message_id` nullable
  - `request_sent_at` nullable
  - `telegram_user_id` nullable
  - `telegram_chat_id` nullable
  - `created_at`
  - `expires_at`
  - `completed_at` nullable
  - `canceled_at` nullable

Suggested `status` values:

- `pending`
- `completed`
- `expired`
- `canceled`

Rules:

- `telegram_setup_intent_id` should be the primary key.
- setup tokens must be random, high-entropy, and short-lived.
- only a hash of the setup token should be stored.
- a setup token must be single-use.
- the bot must only send the `request_chat` keyboard from a private chat with the owner;
  `/start` commands in groups should reply with private-chat instructions.
- the `request_chat` button should request `chat_is_channel = false`, `bot_is_member = true`,
  and admin rights sufficient for invite links or join-request approval.
- the `chat_shared` handler should look up pending intents by `request_id`,
  `request_owner_telegram_user_id`, and `status = pending`; `request_private_chat_id`
  should also be verified when available.
- the setup token should bind `telegram_setup_intent_id`, `community_id`, `owner_user_id`, and
  `telegram_community_bot_id`, and `expires_at`.
- the server must verify the setup request, expiry, and bot chat permissions before writing
  `telegram_linked_chats`.
- expired and completed intents should not be reusable.

Acceptable token shape:

- an opaque random token stored by hash, or
- a signed envelope containing `intent_id`, `community_id`, `owner_user_id`, and `exp`
  plus a server-side row status check

In both cases, row status remains authoritative.

Webhook authentication:

- Community bot webhook delivery should be routed through a bot-specific webhook URL and
  authenticated with `X-Telegram-Bot-Api-Secret-Token` using that bot row's stored webhook
  secret.
- The platform bot, if configured, may still use environment-level `TELEGRAM_WEBHOOK_SECRET`
  for platform-level updates.
- `TELEGRAM_BOT_INTEGRATION_SECRET` is reserved for service-to-service calls if any bot
  runtime is later split out of the API worker.

## Telegram Session Exchange

The Mini App should start with a lightweight Telegram auth path.

Required v0 endpoint:

- `POST /telegram/session/exchange`

Input:

- raw `initData` from `Telegram.WebApp.initData`

Rules:

- the server must validate the raw `initData` HMAC using the token for the bot that
  launched the Mini App
- platform Mini App launches validate against the platform bot token
- community-bot Mini App launches must resolve the launching community bot first and validate
  against that community bot's decrypted token
- the server must reject stale `auth_date` values
- the server must reject tampered launch data
- the server must use Telegram numeric user id as the stable external identity
- Telegram username must be treated as mutable profile metadata
- the endpoint should create or reconcile a Pirate user
- the endpoint should return a normal Pirate API session usable by existing authenticated routes

Suggested storage:

- `telegram_accounts`
  - `telegram_user_id`
  - `user_id`
  - `username` nullable
  - `first_name` nullable
  - `last_name` nullable
  - `photo_url` nullable
  - `first_seen_at`
  - `last_seen_at`
  - `updated_at`

Constraints:

- `telegram_user_id` should be the primary key.
- `user_id` should be unique unless Pirate intentionally supports linking multiple
  Telegram accounts to one Pirate user.
- if multi-account linking is allowed later, the spec must add an explicit account
  selection and conflict-resolution model before relaxing the unique constraint.

If existing auth-provider-link storage can represent Telegram cleanly, Pirate may store the
identity there and keep `telegram_accounts` as integration metadata.

### Session Expiry And Resume

The exchange endpoint returns a normal Pirate API session, so Telegram routes should use the
same authenticated API machinery as the rest of Pirate after exchange.

Rules:

- the Pirate session expiry should be explicit in the exchange response
- when the Pirate session expires, the Mini App should re-run `POST /telegram/session/exchange`
  with fresh `initData` if Telegram provides it
- if fresh `initData` is unavailable because the WebView was suspended or resumed, the client
  should ask Telegram to reopen the Mini App or require a normal Pirate re-auth path
- v0 does not require a separate Telegram refresh token
- if a refresh token is introduced later, it must be revocable when the Telegram account is
  unlinked

## Wallet Posture

Telegram-first users should not receive an embedded wallet by default in the initial
Telegram MVP.

Rules:

- `POST /telegram/session/exchange` should not create a wallet.
- Wallet creation should be lazy and tied to an action that needs a wallet.
- NFT and wallet-score gates must clearly explain when an external wallet is required.
- A fresh embedded wallet is not evidence of NFT ownership or wallet reputation.

Reasoning:

- open, request, proof-of-work, Self, and Very flows do not require a wallet
- wallet-connect flows inside Telegram WebViews are higher-friction and should not block MVP
- automatic wallet creation does not help NFT or score gates when the new wallet is empty

Pirate may later add Privy Telegram login or embedded-wallet creation for Telegram users.
If so, the auth domain, wallet creation policy, and recovery model must be explicit.

## Telegram Account Unlinking

Users may later unlink their Telegram account from Pirate.

Rules:

- unlinking must revoke outstanding setup intents and join grants for that Telegram account
- unlinking must prevent new Telegram grants until the account is linked again
- unlinking should not automatically delete historical audit rows
- v0 should not automatically kick the user from already joined Telegram groups
- communities may later add an optional enforcement job that removes unlinked or no longer
  eligible Telegram accounts from linked groups

Reasoning:

- automatic kicks are operationally sensitive and require accurate chat-member state
- accidental unlinking should not immediately destroy user access without a clear recovery path
- the bot can still prevent future re-entry through grant checks

## Linked Chat Model

Suggested storage:

- `telegram_linked_chats`
  - `community_id`
  - `telegram_community_bot_id`
  - `telegram_chat_id`
  - `chat_type`
  - `chat_title`
  - `chat_username` nullable
  - `link_mode`
  - `bot_admin_status`
  - `bot_permissions_json`
  - `directory_visible`
  - `status`
  - `linked_by_user_id`
  - `setup_intent_id` nullable
  - `linked_at`
  - `updated_at`
  - `unlinked_at` nullable

Suggested `link_mode` values:

- `invite_link`
- `join_request`

Suggested `bot_admin_status` values:

- `unknown`
- `ready`
- `missing`
- `insufficient_permissions`
- `left_chat`

Rules:

- a community may have at most one active primary Telegram linked chat in v0
- only community owners or admins may link or unlink a chat
- linking must verify that the bot is in the chat and has required permissions
- unlinking must stop new grants but should preserve audit records
- chat title and username are display/cache fields and must be refreshed opportunistically

Initial owner and bot endpoints:

- `GET /communities/{community_id}/telegram-chat`
- `POST /communities/{community_id}/telegram-chat/setup-intents`
- `POST /communities/{community_id}/telegram-chat`
- `POST /communities/{community_id}/telegram-chat/unlink`
- `POST /telegram/setup-intents/complete`

Public responses should use `community`, `linked_chat`, `bot_start_parameter`, and
`bot_deep_link`; raw Telegram chat ids should not be returned to the moderator UI.

## Mini App Directory

The `/tg` route should be a real Telegram-native community directory.

Required behavior:

- show communities with linked Telegram chats
- show the viewer's Pirate membership and join eligibility summary
- show whether a Telegram chat is available
- let the user open `/tg/c/{community_id}` for details

Suggested endpoint:

- `GET /telegram/communities`

Suggested response fields per item:

- `community`
- `display_name`
- `description`
- `avatar_ref`
- `route_slug`
- `telegram_chat`
- `membership_mode`
- `viewer_membership_status`
- `join_status`
- `membership_gate_summaries`
- `missing_capabilities`
- `assistant_available`

Suggested `telegram_chat` response object:

- `available`
- `title`
- `username` nullable
- `link_mode`
- `bot_admin_status`

The public directory response should not include raw `telegram_chat_id`.

The endpoint should use the same membership and gate evaluation semantics as normal Pirate
community routes.

## Join Grants

Telegram chat entry should be represented by a short-lived grant.

Suggested storage:

- `telegram_join_grants`
  - `grant_id`
  - `community_id`
  - `telegram_chat_id`
  - `telegram_user_id`
  - `telegram_user_chat_id` nullable
  - `user_id` nullable
  - `link_mode`
  - `invite_link` nullable
  - `telegram_invite_link_ref` nullable
  - `status`
  - `missing_capabilities_json` nullable
  - `join_request_date`
  - `prompted_at` nullable
  - `approved_at` nullable
  - `created_at`
  - `updated_at`
  - `expires_at`
  - `used_at` nullable
  - `revoked_at` nullable

`link_mode` is intentionally stored as a snapshot on the grant. If the linked chat changes
from invite links to join requests later, old grant audit rows should still describe how
they were issued.

Suggested `status` values:

- `pending`
- `approved`
- `denied`
- `failed`
- `issued`
- `used`
- `expired`
- `revoked`

Rules:

- grants must be short-lived
- join-request grants should expire after 24 hours in v0
- invite links should be one-use or member-limited when Telegram supports it
- grants must be bound to `community_id`, `user_id`, `telegram_user_id`, and `telegram_chat_id`
- a leaked invite should not become durable access to a gated community
- the bot should record join-request or chat-member updates for audit
- `telegram_user_chat_id` is short-lived delivery context from Telegram, not a stable user
  identity; the bot must send the verification prompt immediately after receiving
  `chat_join_request`
- if the Telegram user is already mapped to a Pirate user and join eligibility is
  `already_joined` or `joinable`, Pirate may approve the Telegram join request immediately
- if the Telegram user is unmapped or not joinable, Pirate should send a Mini App join link
  to `telegram_user_chat_id` and leave the Telegram request pending
- Telegram Bot API does not expose a decline method for join requests; Pirate-side `denied`
  means Pirate decided not to approve, and the Telegram-side action is inaction

Suggested storage:

- `telegram_chat_member_events`
  - `event_id`
  - `community_id`
  - `telegram_chat_id`
  - `telegram_user_id`
  - `user_id` nullable
  - `telegram_update_id`
  - `event_type`
  - `payload_json`
  - `created_at`

Events without a resolved `user_id` are audit-only in v0. They should not grant Pirate
membership, approve Telegram access, or trigger moderation actions unless another service
first links the Telegram user to a Pirate user and re-checks policy.

## Join Flow

Mini App community join flow:

1. User opens `/tg/c/{community_id}`.
2. Client exchanges Telegram `initData` for a Pirate session when needed.
3. Client loads community preview and join eligibility.
4. If the viewer is missing the platform baseline trust credential, the Mini App starts
   the required trust flow before community membership is created.
5. If the community has additional gates, the Mini App starts only the missing gate
   flows compiled by the server.
6. If `membership_mode = open` or `membership_mode = gated` and all gates pass, the client
   joins the community.
7. If `membership_mode = request`, the client submits a membership request and waits for
   moderator approval.
8. Only after membership exists, the client requests a Telegram join grant.
9. Server creates a Telegram invite link or pending join-request grant.
10. Client opens the Telegram link with Telegram-native navigation.
11. Bot records join request approval or chat-member update.

Suggested endpoint:

- `POST /communities/{community_id}/telegram-chat/join-grant`

Rules:

- platform baseline trust remains required in Telegram, including for otherwise open
  communities
- `join-grant` must check current Pirate membership before issuing Telegram access
- request-to-join communities must not issue Telegram access before approval
- banned Pirate members must not receive Telegram access
- if the Telegram user id is not linked to the Pirate user, grant issuance must fail

## Gate Behavior In Telegram

Gate behavior should be explicit by gate family.

Works directly in the Mini App:

- `open`
- `request`
- `altcha_pow`

Works through app-switch or deep-link:

- `unique_human` with `self`
- `unique_human` with `very`
- `minimum_age` with `self`
- `nationality` with `self`
- `gender` with `self`

Wallet-dependent and deferred in MVP:

- `erc721_holding`
- `erc721_inventory_match`
- `wallet_score`

Rules:

- proof-of-work should run in the Telegram WebView using the same ALTCHA semantics as web
- Self and Very flows should return to the Mini App route that initiated verification
- Self-backed nationality, age, and gender gates should satisfy the platform baseline
  `unique_human` requirement when the compiled verification session proves it
- NFT gates should ask the user to connect the wallet that holds the NFT
- wallet-score gates should not imply that a fresh embedded wallet can pass
- the Mini App may link out to the full Pirate app for wallet-dependent gates in v0

## Community-Owned Bot Model

Community-specific Telegram surfaces should use a Telegram bot owned or operated for that
community, not the Pirate platform bot.

Reasoning:

- Telegram users see the bot identity in group joins, group assistant replies, and direct
  messages. A site-wide bot such as `Pirate_dev_bot` makes a community chat feel like a
  Pirate support channel instead of the community's own chat.
- Community assistants are already community-owned Pirate state: policy, prompt, model,
  credential, and chat history are scoped to `community_id`.
- Join-request approval is a community operation. The bot that approves access should be the
  bot the owner intentionally added to that community's Telegram group.

v0 owner flow:

1. The owner creates a bot with Telegram `@BotFather`.
2. The owner copies the bot token into Pirate.
3. Pirate calls Telegram `getMe` with that token and stores:
   - bot Telegram user id
   - bot username
   - bot display name
   - encrypted bot token
   - generated webhook secret
   - generated webhook route id
   - verification status
4. Pirate registers that bot's webhook with Telegram:
   - URL: `/telegram/community-bots/{bot_webhook_id}/webhook`
   - secret token: the bot row's stored webhook secret
   - allowed updates: `["message", "chat_join_request"]`
5. The owner adds the bot to the Telegram group as admin.
6. The owner starts the existing setup-intent chat picker flow through that community bot.

Suggested storage:

- `telegram_community_bots`
  - `telegram_community_bot_id`
  - `community_id`
  - `bot_telegram_user_id`
  - `bot_username`
  - `bot_display_name` nullable
  - `bot_token_ciphertext`
  - `bot_token_nonce`
  - `bot_token_key_version`
  - `webhook_id`
  - `webhook_secret_hash`
  - `status`
  - `verification_status`
  - `last_verified_at` nullable
  - `last_webhook_registered_at` nullable
  - `created_by_user_id`
  - `created_at`
  - `updated_at`
  - `revoked_at` nullable

Suggested `status` values:

- `active`
- `revoked`
- `disabled`

Suggested `verification_status` values:

- `verified`
- `token_invalid`
- `webhook_registration_failed`
- `permission_check_failed`

Constraints:

- one active community bot per community in v0
- `webhook_id` must be unique and unguessable; generate it with at least 256 bits of
  cryptographic randomness, for example `twh_${randomHex(32)}`
- `bot_telegram_user_id` should be unique among active rows unless Pirate explicitly
  supports reusing one Telegram bot across multiple communities later
- bot token plaintext must never be returned by the API and must not be logged

Token encryption:

- Community bot tokens are dynamic community-provided secrets, so they should be stored in
  the control-plane database encrypted at rest.
- Use an environment-level envelope key such as `TELEGRAM_BOT_TOKEN_WRAP_KEY`.
- Encrypt tokens with AES-256-GCM using a per-bot random nonce and authenticated associated
  data including `telegram_community_bot_id` and `community_id`.
- Store the key version so rotation can be introduced without rewriting the table shape.
- This mirrors the existing posture used for other community-scoped wrapped secrets such as
  Turso community database credentials.

Public API:

- `GET /communities/{community}/telegram-bot`
  - owner/moderator only
  - returns bot status, username, display name, verification status, and timestamps
  - does not return token material
- `POST /communities/{community}/telegram-bot`
  - owner only
  - accepts `{ bot_token }`
  - verifies with Telegram `getMe`
  - encrypts and stores the token
  - creates webhook id and webhook secret
  - registers the Telegram webhook
  - returns the bot resource
- `POST /communities/{community}/telegram-bot/revoke`
  - owner only
  - marks the bot revoked
  - unregisters webhook when possible
  - prevents future setup intents for that bot
  - existing linked chats remain recorded for audit and moderator visibility, but they are
    treated as inactive for webhook dispatch and access approval until a verified bot is
    connected again

Webhook routing:

- Platform-level webhook route remains available for the Pirate platform bot:
  `/telegram/webhook`.
- Community bot route is:
  `/telegram/community-bots/{bot_webhook_id}/webhook`.
- The community bot webhook handler must:
  - load the bot row by `bot_webhook_id`
  - reject inactive or revoked bots
  - verify `X-Telegram-Bot-Api-Secret-Token` against `webhook_secret_hash`
  - decrypt the bot token only for outbound Telegram API calls
  - dispatch to the same setup, join-request, and assistant handlers used today
- Telegram Bot API calls must take an explicit bot token from the loaded bot context. They
  must not read `TELEGRAM_BOT_TOKEN` for community-specific operations.

Reusable implementation:

- `join-request-service.ts` remains mostly unchanged because it resolves community context
  through `telegram_linked_chats.telegram_chat_id`.
- `community-chat-service.ts` remains the setup/linking authority, but setup intents and
  linked chats need to reference `telegram_community_bot_id`.
- `assistant-service.ts` remains mostly unchanged because it routes by
  `telegram_chat_id -> community_id`.
- The current environment-bot webhook handler should be refactored into shared dispatch
  functions that receive a bot context: token, username, webhook id, and scope.

## Community Assistant Surfaces

Pirate already models community assistants as community-owned policy, prompt, model,
credential, and chat state. Telegram should expose that community assistant through the
community-owned Telegram bot configured above.

Operational model:

- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET` are optional
  environment-level platform bot secrets for Pirate-level Mini App launch, Telegram account
  exchange, and global discovery. They are not the source of truth for community group bots.
- community assistant identity, prompt, model, context settings, retention settings, and
  OpenRouter credential remain per-community Pirate state.
- `telegram_linked_chats.telegram_chat_id` maps a Telegram group or supergroup to the
  community assistant for group surfaces.
- `telegram_linked_chats.telegram_community_bot_id` identifies the bot authorized to act in
  that group.
- a short-lived assistant direct-message launch intent maps a Telegram private chat to a
  community assistant session for one-to-one surfaces through the community bot.

Existing code anchors:

- Telegram linking is implemented in `api/services/api/src/lib/telegram/community-chat-service.ts`
  and `api/services/api/src/routes/telegram.ts`.
- Community assistant policy and credential state are implemented in
  `api/services/api/src/lib/communities/assistant-policy/service.ts` and
  `credential-service.ts`.
- Community assistant chat is implemented in
  `api/services/api/src/lib/communities/assistant-policy/chat-service.ts` and currently
  assumes an authenticated Pirate actor.
- The current assistant context builder includes viewer membership state when
  `contextSources.membershipState = true`; that path is suitable for private user surfaces
  but must not be reused directly for Telegram group responses.

Telegram API constraints that shape the implementation:

- Bot deep-link `start` payloads are short strings; Pirate should use compact opaque tokens
  such as `tgsetup_*` and `tgassist_*` instead of stuffing large state into the link.
- `KeyboardButtonRequestChat` and `chat_shared` remain the correct owner chat-picker flow.
- Telegram retries webhook updates on non-2xx responses, so the webhook must acknowledge
  handled and intentionally rejected assistant updates with `200`.
- Telegram privacy mode does not eliminate all group-message exposure. Bots added as group
  admins can receive all messages, so Pirate must ignore non-trigger messages and avoid
  storing them.

The community assistant should support multiple surfaces:

- web community page
- Telegram Mini App community page
- Telegram group bot
- Telegram direct-message bot

The same runtime may be reused, but the context audience must differ by surface.

Suggested runtime input:

```ts
type CommunityAssistantSurface =
  | "web"
  | "telegram_mini_app"
  | "telegram_group"
  | "telegram_dm"

type CommunityAssistantContextAudience =
  | "public_group"
  | "private_user"
  | "moderator"
```

Rules:

- Mini App and direct-message assistant may use private viewer context only after the
  Telegram account has been reconciled to a Pirate user and the viewer can access the
  community.
- Group assistant responses must not reveal private viewer context, even if the sender's
  Telegram account is linked to a Pirate member.
- Group assistant should be command-triggered or reply-triggered only in v0.
- Mention-only triggers may be added after the parser is proven reliable in Telegram groups;
  they should not require disabling privacy mode.
- The bot should keep Telegram privacy mode on in v0, but the webhook must still ignore
  non-trigger group messages because admin bots may receive them.
- The group bot should be `answer_only` in v0 regardless of the community's broader
  `actionMode`.
- Write actions should be drafts requiring moderator approval and should not execute from
  Telegram in v0.
- If the assistant is disabled, missing a usable OpenRouter credential, or the linked chat
  is not active, Telegram should send a short non-sensitive failure message and return `200`
  to Telegram.

## Community Context Pack

Pirate should build a reusable community context pack for assistant calls.

Suggested context sections:

- community identity
  - display name
  - description
  - route slug
  - avatar and banner metadata
- community policy
  - membership mode
  - membership gate summaries
  - guest comment policy
  - agent posting policy
  - anonymous identity policy
- rules and reference links
- recent posts
  - thread cards
  - thread bodies when allowed
  - top comments when allowed
- commerce
  - regional pricing enabled state
  - pricing policy version
  - verification provider requirement for regional pricing
  - money policy funding preference
  - accepted funding assets
  - donation policy and partner
  - public listing availability
- live and events
  - active live rooms
  - scheduled live rooms when modeled
- Telegram integration
  - linked chat title
  - linked chat username
  - link mode
  - bot admin status
- viewer state, only for private audiences
  - membership state
  - role
  - missing gate capabilities
  - verification state needed for join guidance

Rules:

- posts, comments, profile text, and external links are untrusted context, not instructions
- community owner or moderator-authored descriptions, rules, and settings also enter the
  model as quoted data, not as system instructions
- member-only posts may enter context only when the assistant audience is authorized to see them
- group-chat assistant context should prefer public and member-safe summaries
- moderator-only context must be limited to moderator surfaces

### Context Pack Implementation Notes

The existing `sendCommunityAssistantMessage` flow should be split or parameterized before
Telegram group support ships.

Suggested internal API:

```ts
type CommunityAssistantTransport = "web" | "telegram_mini_app" | "telegram_dm" | "telegram_group"

type CommunityAssistantAudience = "private_user" | "public_group" | "moderator"

type CommunityAssistantRequest = {
  transport: CommunityAssistantTransport
  audience: CommunityAssistantAudience
  communityId: string
  actorUserId?: string | null
  telegramUserId?: string | null
  telegramChatId?: string | null
  assistantChatId?: string | null
  message: string
}
```

Rules:

- `private_user` requests may call the current membership-aware context path after the actor
  is resolved.
- `public_group` requests must call a group-safe context builder that omits viewer
  membership, wallet state, verification state, purchase state, private chat history, and
  moderator-only queues.
- group-safe context should include only community profile, rules, reference links, linked
  Telegram chat metadata, public or group-safe thread summaries, and pricing-policy
  explanations that do not include personalized quotes.
- the context builder must add the untrusted-context warning for posts, comments, profile
  text, rules, descriptions, and owner-authored prompt-adjacent content.
- `telegram_group` must force `actionMode = answer_only` at runtime.
- `telegram_dm` may use the community's configured `actionMode`, but v0 should still decline
  direct wallet, purchase, or moderation actions.

## Pricing Boundary For Assistants

The assistant may explain pricing policy, but purchase quote endpoints remain authoritative.

Rules:

- the assistant must not invent exact personalized prices
- the assistant may say whether regional pricing is enabled
- the assistant may explain that Self nationality verification is required for regional pricing
- the assistant should direct users to the purchase flow for exact quotes
- exact pricing must come from quote services that snapshot policy version and verification state

## Telegram Group Assistant

Telegram group bot behavior:

- only respond to `/ask`, `/ask@{community_bot_username}`, or a direct reply to the bot
- resolve `telegram_chat_id` to `community_id`
- resolve `telegram_user_id` to `user_id` when possible
- use a group-safe assistant context pack
- never include private viewer context in a group response
- optionally check Pirate membership to personalize refusal or Mini App guidance, but not to
  expand group-visible context
- rate limit by chat, user, and community
- reply in the same Telegram thread or message context when available
- log prompt and response metadata for audit

Trigger parsing:

- `/ask question` is accepted in private groups, supergroups, and forum topics.
- `/ask@CommunityBot question` is accepted when the bot username matches the linked
  community bot.
- direct replies to a bot-authored message are accepted when the reply text is non-empty.
- plain mentions such as `@CommunityBot question` are deferred for v0 because privacy-mode
  and admin-message behavior can differ by chat setup.
- all other group messages are ignored without persistence.

Response behavior:

- send responses with `reply_parameters.message_id` targeting the triggering message.
- if the inbound message has `message_thread_id`, include it in `sendMessage` so forum topic
  replies stay in the same topic.
- keep Telegram messages under Telegram's text limit by truncating with a clear suffix and
  optionally linking to the Mini App for longer answers.
- if the answer needs private membership, wallet, verification, purchase, or gate state,
  tell the user to open the Mini App or private assistant DM instead of answering publicly.

Rate limiting:

- v0 uses a 60-second window backed by `telegram_assistant_events`.
- per Telegram user: 5 accepted assistant prompts per minute.
- per Telegram chat: 20 accepted assistant prompts per minute.
- per community: 60 accepted assistant prompts per minute.
- rate-limited prompts are persisted with `status = "rate_limited"`, send a public
  retry-later response, and must not call OpenRouter.

Suggested storage:

- `telegram_assistant_events`
  - `event_id`
  - `community_id`
  - `telegram_chat_id`
  - `telegram_message_id`
  - `telegram_user_id`
  - `user_id` nullable
  - `trigger_type`
  - `prompt`
  - `assistant_message_ref` nullable
  - `status`
  - `created_at`
  - `completed_at` nullable

Suggested `trigger_type` values:

- `ask_command`
- `ask_command_mention`
- `reply_to_bot`

Suggested `status` values:

- `received`
- `ignored`
- `answered`
- `failed`
- `rate_limited`

`prompt` should store the extracted assistant question, not the entire Telegram update. Raw
Telegram updates should only be stored in bounded debug metadata when needed.

The group assistant should tell users to open the Mini App when the answer requires private
membership, wallet, verification, purchase, or gate state.

## Telegram Direct-Message Assistant

The one-to-one Telegram bot can be more personal than the group bot.

Useful v0 prompts:

- "Which communities can I join?"
- "Why can't I join this community?"
- "What gate do I need to pass?"
- "What are the rules?"
- "Summarize recent posts in this community."
- "Open this community in the Mini App."

Recommended v0 entry point:

1. User opens the community in the Telegram Mini App or web app.
2. Pirate creates a short-lived Telegram assistant DM intent.
3. The client opens `https://t.me/{community_bot_username}?start=tgassist_{token}`.
4. The bot receives `/start tgassist_{token}` in a private chat.
5. The bot validates the intent, binds the Telegram private chat to the intended community
   and Telegram account, and sends a short ready message.
6. The user's next private messages route to that community assistant until the session is
   changed or expires.

Suggested storage:

- `telegram_assistant_dm_intents`
  - `telegram_assistant_dm_intent_id`
  - `community_id`
  - `user_id` nullable
  - `telegram_user_id` nullable
  - `setup_token_hash`
  - `status`
  - `private_chat_id` nullable
  - `assistant_chat_id` nullable
  - `created_at`
  - `expires_at`
  - `completed_at` nullable

- `telegram_assistant_dm_sessions`
  - `telegram_assistant_dm_session_id`
  - `community_id`
  - `user_id`
  - `telegram_user_id`
  - `private_chat_id`
  - `assistant_chat_id` nullable
  - `status`
  - `created_at`
  - `updated_at`
  - `last_message_at` nullable

Rules:

- direct-message assistant may use private viewer context after Telegram account
  reconciliation and community access checks
- direct-message assistant may create Mini App deep links
- direct-message assistant should not complete wallet, purchase, or moderation actions directly in v0
- a `tgassist_*` token bound to one Telegram user must not activate for another Telegram user
- if the Telegram user is not linked to a Pirate user, the bot should return a Mini App link
  to complete Telegram session exchange before answering with private context
- direct-message sessions should reuse `community_assistant_chats` where possible so web,
  Mini App, and Telegram DM history can share the same retention policy
- users should be able to change the active community assistant by opening a new
  `tgassist_*` link
- DM sessions must have an inactivity timeout. If `last_message_at` or `updated_at` is older
  than the configured TTL, the next private message should ask the user to reopen the
  community assistant link instead of routing to stale community context.
- opening a new `tgassist_*` link should replace the active DM session for that Telegram
  private chat and community-aware user context.

## Security And Privacy

Rules:

- bot token must be treated as an auth secret
- community bot tokens must be encrypted with `TELEGRAM_BOT_TOKEN_WRAP_KEY` and decrypted
  only inside bot-specific webhook or registration flows
- platform bot environment secrets must not be used for community-specific group linking,
  join approval, or assistant replies
- Telegram `initData` must be validated server-side
- setup intents and join grants must expire
- Telegram numeric ids are stable identifiers; usernames are display metadata
- invite links must be revocable or short-lived
- bot permission drift must be visible in admin UI
- all Telegram webhooks must be authenticated or secret-routed
- community bot webhook URLs must be unguessable and still require the Telegram secret
  header; the route id alone is not sufficient authentication
- group assistant responses must avoid private user facts
- assistant prompts must include prompt-injection warnings for community content
- rate limits must exist for session exchange, grant issuance, webhook actions, and assistant calls
- the webhook should not persist non-trigger group messages
- Telegram group assistant events should retain only the extracted prompt and bounded
  metadata unless a debug flag explicitly stores more

## Telegram Community Bot Implementation Plan

Because `0099_control_plane_telegram_community_chats.sql` has been applied to staging, the
community-bot pivot must use a follow-up migration rather than editing `0099` in place.

Recommended implementation sequence:

1. Add `0100_control_plane_telegram_community_bots.sql`:
   - `telegram_community_bots`
   - `telegram_setup_intents.telegram_community_bot_id` nullable during rollout
   - `telegram_linked_chats.telegram_community_bot_id` nullable during rollout
   - indexes for active bot by community, webhook lookup, and active bot Telegram user id
2. Add bot token encryption helpers:
   - require `TELEGRAM_BOT_TOKEN_WRAP_KEY`
   - AES-256-GCM encrypt/decrypt
   - associated data includes community and bot ids
   - tests verify wrong associated data and wrong key fail
3. Add community bot management service:
   - verify token with Telegram `getMe`
   - create bot row with encrypted token and hashed webhook secret
   - register webhook with Telegram `setWebhook`
   - revoke bot and unregister webhook where possible
4. Add owner API endpoints:
   - `GET /communities/{community}/telegram-bot`
   - `POST /communities/{community}/telegram-bot`
   - `POST /communities/{community}/telegram-bot/revoke`
5. Adapt setup intents and chat linking:
   - `POST /communities/{community}/telegram-chat/setup-intents` requires an active
     community bot
   - setup intent stores `telegram_community_bot_id`
   - `bot_deep_link` uses the community bot username
   - `chat_shared` completion verifies the webhook bot matches the setup intent bot
   - linked chat stores `telegram_community_bot_id`
6. Refactor Telegram Bot API client:
   - keep platform helpers for `/telegram/webhook` only
   - add explicit-token helpers for community bot calls
   - all community bot sends, approvals, `getChat`, and `getChatMember` use the loaded bot token
7. Add community bot webhook route:
   - `POST /telegram/community-bots/{bot_webhook_id}/webhook`
   - load bot row by webhook id
   - verify the Telegram secret header against the stored hash
   - decrypt token
   - dispatch setup `/start`, `chat_shared`, `chat_join_request`, and assistant messages
   - always acknowledge valid Telegram-delivered updates with `200`
8. Update moderator UI:
   - first section: connect or revoke community Telegram bot
   - second section: connect group using that bot
   - show bot username, verification status, webhook registration status, and linked group
   - disable group connect until a verified bot exists
9. Add DM assistant launch intents and sessions:
   - create a `tgassist_*` intent from Mini App or web
   - deep link to the community bot username
   - bind intent to Telegram user when available
   - create or reuse `community_assistant_chats` after user reconciliation
   - route private messages to `private_user` context

Already-built implementation that should be preserved:

- setup intent and `chat_shared` lifecycle
- linked chat settings and moderator UI shape
- join-request grant decision service
- group assistant trigger parsing, rate limiting, and group-safe context
- safe webhook acknowledgement and safe Telegram send/approve wrappers

## Telegram Assistant Test Plan

Focused route tests should extend `api/services/api/tests/routes/communities/community-telegram-routes.test.ts`
and reuse the OpenRouter mocking pattern from
`community-assistant-chat-routes.test.ts`.

Required automated tests:

- community bot registration:
  - owner can register a bot token; API calls Telegram `getMe`, stores encrypted token, and
    returns only non-secret bot metadata
  - non-owner cannot register or revoke a bot
  - invalid token returns a safe error and stores no active bot
  - webhook registration failure marks `verification_status = webhook_registration_failed`
  - encrypted token cannot be decrypted with the wrong associated data
- setup flow with community bot:
  - setup intent requires an active verified community bot
  - setup intent deep link uses the community bot username, not `TELEGRAM_BOT_USERNAME`
  - `/start tgsetup_*` through the community bot webhook arms the setup intent
  - `/start tgsetup_*` through the wrong community bot webhook is rejected with `200` ack
  - `chat_shared` completion stores `telegram_community_bot_id` on the linked chat
- webhook routing:
  - unknown `bot_webhook_id` returns `404` or safe `401` before dispatch
  - wrong Telegram secret header is rejected
  - revoked bot does not dispatch updates
  - valid community bot webhook decrypts the token and uses that token for outgoing Telegram API calls
- setup regression tests remain green:
  - private `/start tgsetup_*` sends the `request_chat` keyboard
  - group `/start tgsetup_*` sends private-chat instructions and does not arm the intent
  - `chat_shared` completes the link
  - wrong `request_id`, expired intent, and failed Telegram `sendMessage` still return `200`
- group assistant trigger parsing:
  - `/ask question` routes to the assistant
  - `/ask@{community_bot_username} question` routes to the assistant
  - reply to a bot message routes to the assistant
  - non-trigger group messages return `200`, do not call OpenRouter, and do not write
    `telegram_assistant_events`
- group assistant routing:
  - unknown `telegram_chat_id` is acknowledged with `200` and no provider call
  - linked chat with disabled assistant sends a safe failure message and no provider call
  - linked chat with missing or invalid OpenRouter credential sends a safe failure message
    and no provider call
  - linked chat with enabled assistant calls OpenRouter with the community model and sends
    a Telegram reply
- group assistant privacy:
  - OpenRouter system context for `telegram_group` does not contain `Viewer membership`
  - OpenRouter system context does not include private chat history
  - runtime action mode is forced to `answer_only` even if policy stores a broader mode
  - replies include `reply_parameters.message_id`
  - forum-topic messages include `message_thread_id`
- group assistant audit and rate limiting:
  - answered prompts create `telegram_assistant_events` with `trigger_type` and `status`
  - repeated prompts from the same Telegram user hit the per-user window after five
    accepted prompts
  - provider failures mark the event `failed` and still return `200`
  - rate-limited prompts mark the event `rate_limited`, do not call OpenRouter, and return
    `200`
- join-request gates:
  - unknown Telegram chat ids return `200` without approval or persistence
  - unmapped Telegram users create pending grants and receive a Mini App join link through
    `user_chat_id`
  - mapped users who are already joined or currently joinable call `approveChatJoinRequest`
    and mark the grant approved
  - mapped users who are not joinable create pending grants and receive a Mini App join link
  - prompt failures and approve failures mark the grant failed while still returning `200`
- DM assistant launch:
  - `/start tgassist_*` in a private chat completes a pending DM intent
  - a token bound to a different Telegram user is rejected without provider calls
  - expired DM intents are marked expired and acknowledged with `200`
  - a private message after a completed DM session calls the existing assistant runtime with
    `private_user` context
  - the resulting `community_assistant_chats` history is private to the resolved Pirate user
- webhook robustness:
  - malformed assistant updates return `200`
  - Telegram API timeout in response sending is swallowed by safe send
  - OpenRouter failure does not produce a webhook non-2xx

Manual Telegram smoke tests:

1. Create a community bot with `@BotFather`.
2. Register that bot token in the staging community's Telegram moderator page.
3. Enable a community assistant and save an OpenRouter credential.
4. Add the community bot to the Telegram group as admin with invite-user permission.
5. Connect the group through the community bot setup flow.
6. In the group, send `/ask what are the rules?` and confirm the reply uses community
   rules or board context and does not reveal private user state.
7. In a forum topic, send the same command and confirm the reply stays in the topic.
8. Open the "Ask in Telegram" DM link for the same community and confirm private follow-up
   questions use the member's allowed context.

## MVP Build Order

Recommended build order:

1. community bot registration:
   - follow-up migration
   - encrypted token storage
   - owner API
   - moderator UI
   - per-bot webhook registration
2. migrate existing setup/linking flow to community bots:
   - setup intent uses community bot username
   - community bot webhook handles `/start` and `chat_shared`
   - linked chat records bot id
3. Telegram assistant context refactor: `private_user` vs `public_group`
4. Telegram group `/ask` assistant through the community bot
5. join-request gate handling through the community bot:
   - `chat_join_request` updates
   - `approveChatJoinRequest`
   - `telegram_join_grants`
   - prompt to Mini App when verification is missing
6. `/tg` directory backed by linked chats and join eligibility
7. `/tg/c/{community_id}` join grant flow
8. proof-of-work gate support in the Mini App
9. Self and Very app-switch verification flows
10. Telegram direct-message assistant launch intents

Deferred:

- automatic wallet creation
- NFT and wallet-score gates inside Telegram
- role sync
- topic mapping
- announcements
- post sharing
- direct Telegram purchase flows
