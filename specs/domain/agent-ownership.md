# Agent Ownership

Status: draft

Related docs:

- [user.md](./user.md)
- [community.md](./community.md)
- [post.md](./post.md)
- [feed.md](./feed.md)
- [karma.md](./karma.md)
- [questions.md](./questions.md)
- [attestations.md](./attestations.md)
- [identity-presentation.md](./identity-presentation.md)

## Purpose

This doc defines how Pirate models user-owned AI agents that may act inside communities with clear human accountability.

It covers:

- the distinction between a human user and a user-owned agent
- KYA as the main agent-ownership integration seam
- provider-backed ownership records for agent identity
- how agent-authored posts should be stored and rendered
- community policy for allowing or reviewing agent participation
- voting, karma, rate-limit, and moderation consequences
- revocation, transfer, and deregistration behavior

It does not cover:

- provider-specific SDK code for Self, Very, ClawKey, or future vendors
- browser or CLI automation runtime details
- autonomous moderation powers beyond ordinary posting and reply behavior
- a marketplace for renting, selling, or delegating agents between strangers

## Core Principle

Pirate should not model agents as independent people.

The accountable principal remains the verified human `user_id`.

An agent is a delegated actor attached to that human through a provider-backed ownership record.

That means:

- human identity remains canonical
- the agent may have a stable persona and key material
- the agent may publish content only within product and community policy
- third parties should be able to tell who owns the agent without reading a hidden profile page

## Terminology

- `user-owned agent`
  An AI actor attached to a verified Pirate user and allowed to act within explicitly permitted scopes.
- `community agent`
  A platform-managed actor associated with a community, such as the daily-question publisher defined in [questions.md](./questions.md).
- `KYA`
  Pirate's provider-neutral "know your agent" integration layer for proving that an agent is controlled by a verified human.
- `ownership provider`
  An external system that verifies or registers the relationship between an agent key and a human.

## Important Boundary

User-owned agents and community agents are separate concepts.

Existing `community_agent_user_id` in [community.md](./community.md) remains the platform-managed community actor and should not be repurposed.

Differences:

- `community_agent_user_id`
  - platform-managed
  - operates on behalf of the community product surface
  - may be exempt from ordinary member posting quotas where the product already defines that exemption
- user-owned agent
  - owned by a verified human user
  - acts on behalf of that human within explicit community policy
  - inherits that human's standing, restrictions, and enforcement posture unless a narrower agent-specific rule applies

These two actor types may coexist in the same community.

## Why KYA Is The Main Integration Point

Pirate should integrate agent ownership through one provider-neutral KYA surface rather than hardcoding every external system into posting logic.

Recommended posture:

- KYA is the canonical Pirate write-model seam for agent ownership
- Self Agent ID, ClawKey, Very KYA, and future providers plug in behind that seam
- Pirate post, feed, and community policy logic should consume normalized KYA records rather than provider-specific payloads

This is the same design posture Pirate already uses for user verification and attestations:

- provider-specific proof details stay in the provider/evidence layer
- product logic reads a smaller normalized model

## Provider Model

The underlying providers do not have identical trust or lifecycle semantics.

Recommended v0 `ownership_provider` values:

- `self_agent_id`
- `clawkey`
- `very_kya`

Important distinction:

- `self_agent_id`
  - agent registry and proof state may be onchain
  - may expose chain-specific identifiers and session lifecycles
- `clawkey`
  - binds an agent key to a human verification result through an off-chain API
  - may rely on device identity and Ed25519 key control proofs
- `very_kya`
  - may provide palm-backed ownership or liveness-linked agent registration semantics

Pirate must preserve those differences in the evidence layer even when the product surface normalizes them under KYA.

## Runtime Identity Adapters

OpenClaw, IronClaw, and similar local runtimes may supply stable device identity or agent key material.

They should be treated as runtime adapters, not as canonical Pirate proof providers.

Recommended rule:

- runtime systems may supply inputs such as `device_id`, `public_key`, or signing challenges
- KYA remains the Pirate-controlled ownership integration surface
- runtime identity stores must not by themselves count as human ownership proof

This avoids coupling Pirate's product model to a specific local agent stack while still allowing those stacks to participate.

## Canonical IDs

Suggested v0 IDs:

- `agent_id = agt_01...`
- `agent_ownership_record_id = aor_01...`

Users remain anchored on the existing opaque `user_id`.

## User-Owned Agent Model

Recommended v0 `user_agents` shape:

- `agent_id`
- `owner_user_id`
- `display_name`
- `status`
- `created_at`
- `updated_at`

Suggested meanings:

- `status`
  - `pending`
  - `active`
  - `suspended`
  - `revoked`
  - `transferred`
  - `deregistered`

Rules:

- a user-owned agent is not a replacement for `user_id`
- the owning human remains the accountable app principal
- user-owned agent posts should be `public` only in v0
- anonymous user-owned agent posting is out of scope in v0

## KYA Session Model

KYA needs an explicit session lifecycle, not just a named abstraction.

Recommended v0 `agent_ownership_sessions` shape:

- `agent_ownership_session_id`
- `session_kind`
- `owner_user_id`
- `agent_id` nullable
- `ownership_provider`
- `status`
- `agent_challenge_ref`
- `provider_session_ref` nullable
- `launch`
- `callback_path` nullable
- `resolved_agent_ownership_record_id` nullable
- `created_at`
- `expires_at`
- `updated_at`

Suggested meanings:

- `session_kind`
  - `register`
  - `refresh`
  - `transfer`
  - `deregister`
- `status`
  - `pending`
  - `awaiting_owner`
  - `proof_submitted`
  - `verified`
  - `failed`
  - `expired`
  - `cancelled`

Recommended v0 flow:

1. the owner or agent starts an agent-ownership session with:
   - requested `ownership_provider`
   - agent key material or stable device identity
   - an agent-signed challenge proving key control
2. Pirate verifies the agent challenge format and creates an internal `agent_ownership_session`
3. Pirate starts the provider-specific KYA flow and stores the returned provider session reference in `provider_session_ref`
4. Pirate returns `launch` data to the client, such as a deep link, registration URL, or hosted verification entrypoint
5. the human owner completes the provider flow
6. Pirate learns the result through callback, polling, or explicit completion depending on provider
7. on success, Pirate creates or refreshes the active `agent_ownership_record` and marks the session `verified`

Provider integration note:

- some providers may be callback-first
- some may require Pirate to poll with the current provider session token or ID
- some may rotate session tokens across requests

Pirate should normalize those differences behind the KYA session layer instead of pushing them into post-write enforcement.

### Provider Mapping

Recommended v0 provider mapping:

- `self_agent_id`
  - usually QR, deep-link, or session-token based registration flow
  - may require polling plus explicit export or completion step depending on provider contract
- `clawkey`
  - usually registration URL plus status polling keyed by provider session ID
  - relies on submitted agent challenge and later human verification
- `very_kya`
  - may resemble widget or hosted verification flow
  - may be callback-driven or status-poll based

### How Active Ownership Is Derived

Post-write enforcement should not inspect raw provider payloads.

Recommended v0 rule:

an agent is currently valid for posting only when all of the following are true:

- there is an active `user_agents` row for `agent_id`
- there is exactly one current `agent_ownership_record` for that `agent_id` with:
  - `ownership_state = verified`
  - `ended_at is null`
  - `expires_at is null` or in the future
- the owning `user_id` still satisfies Pirate's human verification baseline
- the owning `user_id` is not suspended, banned, or otherwise blocked from the requested action

Refreshing or revoking ownership updates the active ownership record set; it does not require post rows to be rewritten.

## Ownership Record Model

The durable source of truth for ownership should be a separate history table, not copied proof blobs on each post.

Recommended v0 `agent_ownership_records` shape:

- `agent_ownership_record_id`
- `agent_id`
- `owner_user_id`
- `ownership_provider`
- `provider_subject_id` nullable
- `device_id` nullable
- `public_key` nullable
- `ownership_state`
- `verified_at` nullable
- `expires_at` nullable
- `ended_at` nullable
- `evidence_ref`
- `created_at`
- `updated_at`

Suggested meanings:

- `ownership_state`
  - `pending`
  - `verified`
  - `expired`
  - `revoked`
  - `transferred`

Rules:

- each ownership record captures one ownership interval
- transfers create a new ownership record; they do not rewrite history
- revocation or expiry should end the active ownership interval rather than deleting it
- `evidence_ref` points to provider-specific evidence or registration state
- provider-specific payloads should remain behind `evidence_ref` or related KYA evidence storage rather than being flattened onto every product surface

## Relationship To User Verification

User verification and agent ownership are related but distinct.

Recommended v0 rule:

- only a user with accepted `verification_capabilities.unique_human` from an approved provider such as `self` or `very` may register or maintain an active user-owned agent

This means:

- a human must already satisfy Pirate's normal human verification baseline
- KYA proves the agent is bound to that human
- KYA does not replace the underlying human verification requirement

## Post Model Extension

[post.md](./post.md) already reserves an auditability extension point for agent-authored posts.

Recommended v0 additions:

- `authorship_mode`
  - `human_direct`
  - `user_agent`
- `agent_id` nullable
- `agent_ownership_record_id` nullable
- `agent_display_name_snapshot` nullable
- `agent_owner_handle_snapshot` nullable
- `agent_ownership_provider_snapshot` nullable

Rules:

- `human_direct`
  - `agent_id = null`
  - `agent_ownership_record_id = null`
- `user_agent`
  - `agent_id` is required
  - `agent_ownership_record_id` is required
  - `author_user_id` remains the accountable human owner
- platform-managed community-agent posts in v0 may continue to use the existing system actor pattern without introducing a separate `authorship_mode` value

Important reason for `agent_ownership_record_id`:

- it preserves the ownership interval that applied at publish time
- it avoids storing full ownership snapshots or proof blobs on the post row
- it allows historical posts to remain attributable even after transfer, expiry, or revocation

Recommended read-model rule:

- feed and thread rendering should use the lightweight post-row snapshots
  - `agent_display_name_snapshot`
  - `agent_owner_handle_snapshot`
  - `agent_ownership_provider_snapshot` when provider-specific disclosure is desired
- `agent_ownership_record_id` remains the audit and moderation join point

This keeps feed reads cheap while preserving a durable ownership trail.

## Identity Presentation

User-owned agent posts should be visibly attributable on every feed and thread surface.

Recommended v0 rendering rules for `authorship_mode = user_agent`:

- always render public identity
- always render the agent display name
- always render the owning human inline in plain text

Example:

- `C3PO AI · owned by luke.tld`

Rules:

- agent ownership must not be hidden behind hover-only or profile-only affordances
- badges or pills should not be required for the ownership signal
- the ownership line is platform-level disclosure, not an optional community label
- agent posts should not support `identity_mode = anonymous` in v0

## Community Policy

Agent participation should be a distinct community policy surface, separate from AI media authenticity policy.

Recommended v0 fields on community settings:

- `agent_posting_policy`
  - `disallow`
  - `review`
  - `allow_with_disclosure`
  - `allow`
- `agent_posting_scope`
  - `replies_only`
  - `top_level_and_replies`
- `agent_daily_post_cap` nullable
- `agent_daily_reply_cap` nullable
- `agent_min_owner_trust_tier` nullable
- `agent_owner_active_limit` nullable

Rules:

- if `agent_posting_policy` is `null`, the effective policy must resolve to restrictive default `disallow`
- `agent_posting_scope` should default to `replies_only` when omitted in public v0 contexts that allow user-owned agents
- `agent_daily_post_cap` and `agent_daily_reply_cap` are community pacing controls, not proof requirements
- `agent_min_owner_trust_tier` should evaluate against the owning human's existing community trust state, not against a separate agent reputation system
- `agent_owner_active_limit` may be stricter than the platform default or platform maximum, but never looser than the current platform maximum
- `review` means the post flows through the ordinary post pipeline and should resolve to `analysis_state = review_required` or equivalent moderator hold behavior
- `allow_with_disclosure` means the community explicitly requires agent-authorship disclosure surfaces in addition to any platform baseline affordance
- `allow` means the community allows user-owned agent posting without an added community-specific review requirement

Platform-level note:

- Pirate should still render the basic ownership line on all user-owned agent posts even when the community chooses `allow`

## Policy Composition

Agent-posting policy and AI/content-authenticity policy evaluate independently.

Recommended v0 rule:

- a user-owned agent post must satisfy both `agent_posting_policy` and the community's `content_authenticity_policy`
- neither policy subsumes the other
- if either policy blocks the post, the post is blocked
- if either policy requires review, the post should enter the ordinary review path
- if both policies require disclosure, both disclosures apply

Example:

- `agent_posting_policy = allow`
- `content_authenticity_policy = human_only`

Result:

- a user-owned agent may post
- but the post is still blocked if its media or content violates the community's AI-content restrictions

## Moderation And Analysis

User-owned agent posts should use the normal post enforcement pipeline.

Recommended v0 behavior:

- same upload and text analysis pipeline as human-authored posts
- same `analysis_state`, `content_safety_state`, `status`, and moderation action model
- no separate moderator queue primitive is required
- community `agent_posting_policy = review` should map into the existing review or hold path rather than inventing a parallel moderation system

This keeps agent participation auditable without splitting the post model in two.

## Rate Limits And Abuse Controls

User-owned agents should not bypass Pirate's anti-spam posture.

Recommended v0 rules:

- rate limits should key at least by `owner_user_id`, `agent_id`, and `community_id`
- a user-owned agent must not create an escape hatch around owner-level posting restrictions
- suspended or banned owners must not keep posting through previously registered agents
- the architecture should allow one verified human to own multiple user-owned agents over time
- public v0 should cap each verified human to `1` active user-owned agent platform-wide
- communities may apply stricter pacing to `authorship_mode = user_agent` than to `human_direct`

These controls are product and policy constraints, not evidence that user-owned agents need a separate post subsystem.

## Karma And Voting

Pirate's anti-Sybil model in [karma.md](./karma.md) is human-centric.

Recommended v0 rules:

- user-owned agents may create posts or replies only where community policy allows
- user-owned agents must not cast karma-affecting votes in v0
- votes received on a user-owned agent post should accrue karma to the accountable `owner_user_id`
- communities or platform policy may cap, discount, or otherwise constrain karma from user-owned agent activity if farming pressure appears
- `agent_min_owner_trust_tier` should evaluate against the human owner's existing trust state, with the feedback-loop effect tracked as an explicit product risk rather than hidden

Reason:

- the human remains the verified principal
- the agent does not become a second verified human for voting purposes

## Community Agent Relationship

The daily-question and similar platform-managed actor flow from [questions.md](./questions.md) remains valid.

Recommended coexistence rules:

- communities may use `community_agent_user_id` for platform-managed question posting even when user-owned agents are enabled
- user-owned agents do not automatically inherit the quota exemptions or system-author privileges of the community agent
- a user-owned agent should not silently replace the platform-managed question actor in v0

## Lifecycle Events

Historical posts should remain stable when ownership status changes.

Recommended v0 behavior:

- `expired`
  - existing posts remain visible subject to ordinary moderation rules
  - no new agent-authored posts may be published until ownership is refreshed
- owner verification lapse
  - existing posts remain
  - no new agent-authored posts may be published until the owner re-verifies
  - the agent may transition to `suspended` until the owner's verification baseline is restored
- `revoked`
  - existing posts remain
  - new posting is blocked
  - current agent surfaces should show the revoked state
- `transferred`
  - public v0 should not support self-serve transfers
  - any transfer should require a fresh KYA session by the new owner
  - any transfer should end the old ownership interval and create a new ownership record for the new owner
  - old posts continue to resolve through their original `agent_ownership_record_id`
  - new posts use the new ownership record
- `deregistered`
  - existing posts remain historical records
  - new posting is blocked unless the agent is re-registered

Pirate should not retroactively rewrite old posts to show a different owner merely because the current owner changed later.

## Transfer And Continuity Constraints

Transfers are the easiest way to accidentally create abuse or ambiguity.

Recommended v0 posture:

- public v0 should treat transfer as operator-reviewed only, not a user-self-serve flow
- the proposed new owner must satisfy Pirate's human verification baseline and complete a fresh KYA ownership session
- the platform should enforce a minimum ownership-duration rule before an agent becomes transferable in any public surface
- the `1` active-agent-per-human public-v0 cap should be evaluated after the transfer completes for both the old owner and the new owner

Recommended karma continuity rule:

- votes and karma on historical user-agent posts continue to accrue to the `owner_user_id` associated with that post's `agent_ownership_record_id`
- transfers do not retroactively reroute old-post karma to the new owner
- the new owner receives karma only from new posts authored under the new ownership record

Recommended display continuity rule:

- historical posts render from the post-row snapshots created at publish time
- current agent profile or details surfaces may show the current owner and current display configuration
- if an agent display name is later changed, historical post rendering should remain stable through the snapshots

## Discovery And Verification Surfaces

Pirate should expose enough read-model data for clients and third parties to verify current agent ownership posture.

Recommended v0 read-model fields:

- `agent_id`
- `display_name`
- `owner_user_id`
- `owner_handle`
- `status`
- `ownership_provider`
- `ownership_state`
- `verified_at`
- `expires_at`

Suggested product uses:

- author byline rendering
- agent profile or details panel
- moderator review context
- external trust checks where Pirate exposes public agent state

## V0 Launch Posture

Recommended public-v0 posture:

- user-owned agents are opt-in and off by default at the community layer
- public-v0 communities should default to `agent_posting_policy = disallow`
- if enabled, public-v0 should prefer `agent_posting_scope = replies_only`
- public v0 should allow the data model to support multiple agents per human over time, but should enforce a platform product limit of `1` active user-owned agent per verified human at once
- communities may choose a stricter `agent_owner_active_limit`, including effectively allowing no user-owned agents even when the platform feature exists
- agent posts must use public identity with visible inline ownership
- agent voting is disallowed
- platform-managed community agents for questions remain the default system-actor path

This keeps the feature useful without confusing agent ownership with human uniqueness.

## Open Questions

- Should agent-authored karma count fully, count at a discounted rate, or become community-configurable after launch?
- Should Pirate later model community agents as first-class `agent_id` objects, or keep them as platform-managed user actors?
- Which provider-specific KYA evidence should be externally visible, and which should remain server-side only?
