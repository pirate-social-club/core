# Onboarding

Status: draft

Related docs:

- [user.md](./user.md)
- [profile.md](./profile.md)
- [guild.md](./guild.md)
- [feed.md](./feed.md)
- [handles.md](./handles.md)

## Purpose

This doc defines Pirate's initial user onboarding flow.

It covers:

- minimum required steps
- generated default identity
- optional interest seeding
- optional Reddit bootstrap import
- what is deferred until later profile editing

## Non-goals

This doc does not define:

- final UI copy
- growth experiments
- notification permission timing
- every future onboarding branch

## Core Principle

Onboarding should be minimal.

Pirate should optimize for:

- getting the user into the product quickly
- creating a usable default identity
- solving cold start without asking too many questions

## Recommended V0 Flow

Recommended v0 steps:

1. Privy sign-in
2. generate a default global Pirate handle
3. optionally let the user rename it once during onboarding
4. optionally import Reddit to seed interests and reputation snapshot
5. optionally join a few suggested guilds
6. land the user in the product

## Generated Default Identity

Every new user should start with a global Pirate identity.

Example:

- `suspicious-code-7234.pirate`

Rules:

- the generated handle should be stable and unique
- it should be safe to show immediately even if the user skips customization
- the user may rename it subject to global-handle policy
- guild-local handles remain separate and optional
- the initial generated handle should not require payment
- the first onboarding cleanup rename should be free in v0
- later upgrades into better `.pirate` inventory may require payment or stricter eligibility
- every user gets one generated `.pirate` handle immediately
- every user may perform one free rename during onboarding or early account setup
- in v0, "early account setup" means the first `7 days` after account creation
- onboarding should not let a user accumulate multiple active global `.pirate` handles
- if Reddit verification is completed during onboarding, Pirate may suggest the verified Reddit username as the preferred cleanup rename

This gives every new user a "sailor without a home" identity before they join any specific guild.

## Reddit Bootstrap Import

Reddit import should be optional.

It is best understood as a bootstrap step for:

- interests
- guild suggestions
- immutable external trust snapshot

It should not be treated as:

- a permanent live Reddit sync
- native Pirate karma
- canonical user identity

### What The Existing Prototypes Prove

Current prototype directions already suggest a clean split:

- one tool verifies control of a Reddit username via profile-code placement
- another tool snapshots historical subreddit activity and karma breakdowns

This implies a strong v0 model:

- first verify control of the Reddit account
- then capture a one-time onboarding snapshot tied to that verified account

### What Pirate Can Infer

Good v0 inferences:

- top subreddits by participation
- subreddit-specific karma totals
- broad interest categories derived from subreddit membership/activity
- possible guild suggestions
- initial handle-eligibility or trust bootstrap

What Pirate should avoid inferring too aggressively:

- detailed personality traits
- political identity
- permanent social labels from noisy subreddit activity

### Real-time vs Snapshot

Recommended v0 rule:

- verification can be near-real-time
- snapshot import is point-in-time and asynchronous

Interpretation:

- profile-code verification can complete quickly after the user updates Reddit
- subreddit/karma/activity import should be treated as a captured onboarding snapshot
- later refresh, if ever supported, should create a new snapshot rather than mutating the old one

So:

- "prove you control u/example" can feel close to real time
- "import your Reddit history" should be treated as a background or async import, not a blocking live sync

### What The User Gets From Reddit Verification

Recommended v0 benefits:

- cleaner suggested `.pirate` handle derived from the verified Reddit username, if available
- better interest seeding
- better guild suggestions
- immutable onboarding trust snapshot that can help with early eligibility flows

This is a stronger onboarding reward than asking the user to manually fill out interests.

## Interest Seeding

If Reddit import is skipped or unavailable, Pirate may still ask for very lightweight interests.

Recommended fallback:

- choose a few broad interests
- optionally pick a few suggested guilds

But Pirate should prefer inferred cold-start hints over long questionnaires when trustworthy imported data exists.

## What Should Not Be In Onboarding

Do not require these in v0 onboarding:

- detailed demographics
- rich profile facets
- location detail
- school
- languages
- extended social preferences

Those belong in later profile editing if Pirate supports them at all.

## On-chain vs Off-chain

Recommended v0 split:

- onboarding flow is fully app-level
- generated global handle is app-level
- Reddit verification and snapshot import are app-level
- no dedicated onboarding contract is needed

## Open Questions

- Should Reddit import happen inline during onboarding, or as a skippable post-signup "improve my feed" step?
