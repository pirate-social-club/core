# Domain Specs

Product and system design docs grouped by domain surface.

## Core Social

- `user.md`
  User identity and account model.
- `profile.md`
  Profile state, public identity, and presentation.
- `post.md`
  Post model and authoring surface.
- `feed.md`
  Feed assembly and read models.
- `market-context.md`
  Related market-context sidecars for claim-bearing posts.
- `messaging.md`
  Direct or threaded messaging model.
- `notifications.md`
  Notification events and inbox behavior.
- `questions.md`
  Question and answer flows.

## Communities And Governance

- `community.md`
  Community creation, settings, and policy surface.
- `community-money-policy.md`
  Community funding preference, route constraints, and settlement-lane policy.
- `community-pricing-policy.md`
  Community-controlled regional pricing, nationality-tier mapping, and quote-pricing audit policy.
- `public-v0-club-enforcement.md`
  Backend enforcement checklist for the locked public v0 club contract.
- `governance-backends.md`
  Shared model for `centralized`, `multisig`, and `majeur` backends.
- `multisig-attachment.md`
  Attaching an external multisig governance backend.
- `majeur-creation.md`
  Creating a community with a Majeur DAO backend.
- `monetization.md`
  Community and creator monetization rules.
- `donations.md`
  Donation-specific product behavior.
- `marketplace.md`
  Commerce, purchase, pricing, and settlement behavior.
- `publish-matrix.md`
  Canonical matrix for what each post, asset, live, and replay surface may publish, sell, and deliver.
- `follow.md`
  Follow graph expectations and migration posture.

## Music And Media

- `artist-catalog.md`
  Artist-side catalog and release model.
- `artist-identity.md`
  Artist identity, attribution, and authority.
- `asset.md`
  Canonical asset model and attachments.
- `karaoke.md`
  Karaoke-specific behavior and assets.
- `scrobbles.md`
  Listening event model and derived product value.
- `livestream.md`
  Live room and broadcast surface.
- `live-access-runtime.md`
  Runtime authorization, reconnect, ticket semantics, and replay relationship for live access.
- `live-segments.md`
  Segmenting and indexing live sessions.
- `replay.md`
  Replay capture and playback model.
- `rights-review.md`
  Rights review and trust workflow.
- `royalty-graph.md`
  Royalty-native payout and ownership graph.
- `story-royalty-commerce.md`
  Story Royalty Module commerce migration and settlement plan.
- `localization.md`
  Translation and locale behavior for content.

## Identity And Namespace

- `agent-ownership.md`
  User-owned AI agent ownership, posting, and KYA model.
- `agent-handles.md`
  Canonical `*.clawitzer` identity for user-owned agents.
- `handles.md`
  Handle issuance and namespace policy.
- `namespace.md`
  Namespace control and product semantics.
- `namespace-root-control.md`
  Root authority and delegation for namespaces.
- `hns-verification-flow.md`
  HNS verification session lifecycle and `namespace_verification_id` handoff.
- `spaces-verification-flow.md`
  Spaces root verification session lifecycle for `@space` community attachment.
- `hns-authoritative-dns.md`
  HNS-native routing, authoritative DNS, and deployment posture for resolvable roots and subdomains.
- `identity-presentation.md`
  Public presentation of identity claims.
- `attestations.md`
  Verification and attestation model.

## Onboarding And UX

- `onboarding.md`
  General onboarding flow.
- `composer.md`
  Composer flows and creation UX.
- `dvpn.md`
  Paid dVPN activation, lazy Sentinel wallet creation, and TUI gating rules.
- `purchase-quote-flow.md`
  Purchase quote and buyer confirmation flow.

UI handoff and runtime-specific docs live outside this index:

- [docs/ux/onboarding-reddit-bootstrap-storybook.md](../../docs/ux/onboarding-reddit-bootstrap-storybook.md)
  Storybook-specific onboarding component notes.
- [docs/tui/tui-auth-home.md](../../docs/tui/tui-auth-home.md)
  TUI auth and home-shell contract for the standalone terminal client.
- [docs/tui/tui-refactor-checklist.md](../../docs/tui/tui-refactor-checklist.md)
  Active implementation checklist for the current TUI refactor.

## System And Policy

- `moderation.md`
  Platform-floor moderation, community-governed policy, and moderator workflow model.
- `moderation-workflow.md`
  Minimal v0 moderation objects, case creation rules, queues, and action semantics.
- `blocks.md`
  Blocking semantics and user safety boundaries.
- `karma.md`
  Reputation and trust signal model.
- `performance.md`
  Performance goals and constraints.

## Reading Order

If you are starting fresh, read in this order:

1. `community.md`
2. `public-v0-club-enforcement.md`
3. `namespace-root-control.md`
4. `hns-verification-flow.md`
5. `spaces-verification-flow.md`
6. `hns-authoritative-dns.md`
7. `governance-backends.md`
8. `asset.md`
9. `marketplace.md`
10. `scrobbles.md`
11. `onboarding.md`
