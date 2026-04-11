# Onboarding Reddit Bootstrap Storybook Spec

Status: draft

Related docs:

- [onboarding.md](/home/t42/Documents/pirate-v2/specs/domain/onboarding.md)
- [profile.md](/home/t42/Documents/pirate-v2/specs/domain/profile.md)
- [user.md](/home/t42/Documents/pirate-v2/specs/domain/user.md)
- [onboarding.yaml](/home/t42/Documents/pirate-v2/specs/api/src/components/schemas/onboarding.yaml)
- [onboarding-paths.yaml](/home/t42/Documents/pirate-v2/specs/api/src/paths/onboarding.yaml)

## Purpose

This doc defines the product and view-model shape for the onboarding step that:

- verifies control of a Reddit username
- triggers a one-time Reddit history snapshot import
- uses that snapshot to seed interests, club suggestions, and external trust context
- can be handed to a separate model to implement as Storybook compositions

This is a UI spec and Storybook handoff, not a final visual design doc.

## Product Review

The existing onboarding direction is mostly correct:

- Reddit is optional
- verification happens before import
- import is a snapshot, not a live sync
- expensive ingestion is async

The main gaps are product-shape gaps, not policy gaps.

### Gaps To Close

#### 1. Source ambiguity

The current onboarding doc says "another tool snapshots historical subreddit activity and karma breakdowns" but does not name the source.

For UI and copy, Pirate should be explicit that:

- the import is backed by Pirate's archival Reddit ingestion pipeline
- the initial source is the Pushpull-backed historical API/service
- coverage may be historical or partial rather than perfectly live

The UI should avoid words like:

- live sync
- mirror
- always current

Preferred language:

- historical snapshot
- one-time import
- archival Reddit activity

#### 2. API state is too coarse for Storybook

Current API shapes give:

- `reddit_verification_status`
- `reddit_import_status`
- optional `verification_hint`

That is enough for transport, but not enough for a convincing composition spec.

Storybook needs richer derived states such as:

- username entered but not submitted
- verification code ready
- checking for proof
- verified and ready to import
- import queued
- import running
- import succeeded with rich data
- import succeeded with sparse data
- import partially covered
- source temporarily unavailable

#### 3. Missing post-import summary contract

If onboarding asks the user to wait through ingestion, the UI needs a payoff.

The current API tells the client whether import finished, but not what the user gained from it.

Storybook should assume a result summary that can show:

- verified Reddit username
- account age
- global karma if available
- top subreddits
- moderator communities
- inferred interests
- suggested communities
- warnings about incomplete coverage

#### 4. Failure states need product meaning

"failed" is not specific enough for onboarding UX.

The UI needs distinct treatments for:

- verification code not found yet
- username typo or nonexistent account
- rate limiting
- source outage
- no meaningful importable history
- partial archival coverage

#### 5. Continue-path must stay obvious

Because import is optional and async, onboarding should never feel blocked on Pushpull.

The user must always be able to:

- skip Reddit entirely
- continue while import runs
- return later if import is still processing

## Product Stance

Recommended v0 structure:

1. Generate default `.pirate` handle.
2. Offer an optional Reddit bootstrap step.
3. Verify control of a Reddit username using profile-code placement.
4. After verification, trigger a background historical snapshot import from Pirate's Reddit ingestion service.
5. Show a compact summary of what Pirate learned.
6. Offer lightweight club suggestions and optional handle cleanup suggestion.
7. Let the user continue regardless of whether import is skipped, running, or complete.

This keeps the current domain intent but makes the step legible.

## UX Rules

- Treat verification and ingestion as separate moments.
- Verification can feel interactive and quick.
- Ingestion should feel backgrounded and resumable.
- Never imply that Pirate imports private Reddit data.
- Never imply that imported Reddit karma becomes native Pirate karma.
- Make the reward concrete: better suggestions, better cold start, possible handle cleanup suggestion.
- Explain archival uncertainty without sounding broken or apologetic.

## Component Boundaries

The onboarding surface is split into three compositions with clean boundaries:

- `OnboardingRedditOptional`: verify/import/summary/skip/continue only. No username or handle state.
- `OnboardingChoosePirateUsername`: single visible name decision only. Receives an optional Reddit-derived `handleSuggestion` for prefill, but never receives `generatedHandle` or `cleanupRenameAvailable`. The generated handle is kept in outer flow/session state only.
- `OnboardingCommunitySuggestions`: post-name destination choice.

`generatedHandle` and `cleanupRenameAvailable` are removed from the Reddit composition. They remain in backend and domain state but are not first-run UI concerns.

`handleSuggestion` is kept but moves to the username composition as the prefill source. When Reddit verification succeeds, the suggestion flows from the Reddit step into the username step. When Reddit is skipped, no suggestion is provided and the username input starts empty.

The regenerate button is removed in v0. The user either types their own name or accepts the Reddit-derived suggestion.

## Recommended Composition

Suggested Storybook targets:

- `Compositions/OnboardingRedditOptional`
- `Compositions/OnboardingChoosePirateUsername`
- `Compositions/OnboardingCommunitySuggestions`

The existing `Compositions/OnboardingRedditBootstrap` is deprecated in favor of these three.

### Layout Anatomy

**OnboardingRedditOptional:**

1. Intro/value section
2. Reddit username capture row
3. Verification instruction card
4. Import status card
5. Snapshot summary card
6. Continue/skip footer

**OnboardingChoosePirateUsername:**

1. Username input with `.pirate` suffix
2. Optional handle suggestion prefill (from prior Reddit step)
3. Inline availability feedback via global `.pirate` availability read-model
4. Continue footer

**OnboardingCommunitySuggestions:**

1. Suggested communities or interests section
2. Continue/skip footer

### Content Hierarchy

Primary message:

- import your Reddit history to improve your start on Pirate

Supporting points:

- verify you control the account
- Pirate captures a one-time historical snapshot
- this helps suggestions and bootstrap trust
- you can skip this

## View-Model Contract

The canonical API can stay small.
The Storybook surface should use a richer UI model derived from onboarding status, verification responses, job status, and result payloads.

### OnboardingRedditOptional Props

```ts
type OnboardingRedditOptionalProps = {
  canSkip: boolean;
  canContinue: boolean;
  reddit: {
    usernameValue: string;
    verifiedUsername?: string;
    verificationState:
      | "not_started"
      | "code_ready"
      | "checking"
      | "verified"
      | "failed"
      | "rate_limited";
    verificationHint?: string;
    codePlacementSurface?: "profile" | "bio" | "about";
    lastCheckedAt?: string;
    errorTitle?: string;
    errorBody?: string;
  };
  importJob: {
    sourceLabel: "Pushpull archival snapshot";
    status:
      | "not_started"
      | "ready"
      | "queued"
      | "running"
      | "partial_success"
      | "succeeded"
      | "failed"
      | "source_unavailable";
    progressLabel?: string;
    queueNote?: string;
    warning?: string;
    errorTitle?: string;
    errorBody?: string;
  };
  snapshot?: {
    accountAgeDays?: number;
    globalKarma?: number | null;
    topSubreddits: Array<{
      subreddit: string;
      karma?: number | null;
      posts?: number | null;
      rankSource?: "karma" | "posts" | "source_order";
    }>;
    moderatorOf: string[];
    inferredInterests: string[];
    suggestedCommunities: Array<{ communityId: string; name: string; reason: string }>;
    coverageNote?: string;
  };
  actions: {
    primaryLabel: string;
    secondaryLabel?: string;
    tertiaryLabel?: string;
  };
};
```

### OnboardingChoosePirateUsername Props

```ts
type OnboardingChoosePirateUsernameProps = {
  inputValue: string;
  handleSuggestion?: {
    suggestedLabel: string;
    source: "verified_reddit_username";
    reason?: string;
  };
  availability:
    | "unknown"
    | "checking"
    | "available"
    | "taken"
    | "reserved"
    | "invalid";
  errorText?: string;
  canContinue: boolean;
  actions: {
    primaryLabel: string;
    secondaryLabel?: string;
  };
};
```

`generatedHandle` and `cleanupRenameAvailable` are intentionally absent. The generated handle exists only in outer flow/session state for backend continuity. The username composition receives an optional `handleSuggestion` for prefill; when absent, the input starts empty.

`handleSuggestion.source` is intentionally limited to `"verified_reddit_username"`. In the Reddit-skip path, no suggestion is provided and the input starts empty.

Inline availability validation should use the dedicated global `.pirate` availability read-model, not the profile rename route.

`inputValue` is the current visible field value. It starts from `handleSuggestion.suggestedLabel` when a suggestion is present, otherwise `""`.

`availability` is the live validation state for the current `inputValue`, not the suggestion. This is what powers states like custom input available, taken, reserved, or invalid while the user types.

The username step is the required visible Pirate-name decision in the normal signup flow. `canContinue` should be `true` only when `inputValue` is non-empty and the current `availability` state allows the requested label to be claimed.

Confirming the `.pirate` handle in this step consumes the free cleanup rename.

### OnboardingCommunitySuggestions Props

```ts
type OnboardingCommunitySuggestionsProps = {
  communities: Array<{
    communityId: string;
    name: string;
    reason: string;
  }>;
  actions: {
    primaryLabel: string;
    tertiaryLabel?: string;
  };
};
```

This shape is intentionally permissive for Storybook.
If it becomes runtime app code, it should be converted into a discriminated union keyed by `phase` and/or the verification/import state so impossible combinations are unrepresentable.

## Mapping From Existing API

Suggested derived UI mapping:

- `reddit_verification_status = not_started` -> `verificationState = not_started`
- `reddit_verification_status = pending` plus returned hint -> `verificationState = code_ready`
- client polling after submit -> `verificationState = checking`
- `reddit_verification_status = verified` -> `verificationState = verified`
- `reddit_verification_status = failed` -> `verificationState = failed`
- `reddit_import_status = not_started` and verification complete -> `importJob.status = ready`
- `reddit_import_status = queued` -> `importJob.status = queued`
- `reddit_import_status = running` -> `importJob.status = running`
- `reddit_import_status = succeeded` -> `importJob.status = succeeded`
- `reddit_import_status = failed` -> `importJob.status = failed`

Storybook-only states that may be derived from richer backend payloads later:

- `rate_limited`
- `partial_success`
- `source_unavailable`

Migration note:

- `suggested_community_ids` in the current onboarding API is too thin for this composition
- v0 UI can hydrate those IDs through a separate club read model if needed
- preferred future API shape is to augment or replace bare IDs with display-ready suggestion objects such as `{ community_id, name, reason }`

## Storybook Scenarios

These are the minimum stories the design/implementation model should build.

### OnboardingRedditOptional

#### Core Flow

- `Reddit / Intro`
- `Reddit / Username Entered`
- `Reddit / Verification Code Ready`
- `Reddit / Verification Checking`
- `Reddit / Verified Ready To Import`
- `Reddit / Import Queued`
- `Reddit / Import Running`
- `Reddit / Import Success`
- `Reddit / Continue Without Reddit`
- `Reddit / Recovery / Return To Running Import`

#### Edge And Recovery

- `Reddit / Error / Verification Failed`
- `Reddit / Error / Username Not Found`
- `Reddit / Error / Rate Limited`
- `Reddit / Error / Pushpull Unavailable`
- `Reddit / Result / Sparse History`
- `Reddit / Result / Partial Coverage`

#### Responsive

- `Reddit / Mobile / Verification Code Ready`
- `Reddit / Mobile / Import Success`

### OnboardingChoosePirateUsername

- `Username / Empty (Reddit skipped)`
- `Username / Prefilled From Reddit`
- `Username / Prefilled Reddit Suggestion Taken`
- `Username / Custom Input Available`
- `Username / Custom Input Taken`
- `Username / Custom Input Reserved`
- `Username / Custom Input Invalid`
- `Username / Mobile`

### OnboardingCommunitySuggestions

- `Communities / With Suggestions`
- `Communities / Empty (skip)`

### Cross-Composition Integration

- `Integration / Full Flow With Reddit`
- `Integration / Full Flow Without Reddit`

## Story Expectations

Each story should show concrete sample data, not placeholders.

Use realistic examples such as:

- `u/technohippie`
- top subreddits with recognizable community names
- club suggestions tied to those communities
- a clear historical coverage note where relevant

The composition should make these states obvious without needing controls first.

## Data Display Rules

- `globalKarma` may be null and should not collapse the layout.
- `topSubreddits` should show a short ranked list, ideally `3-5`.
- each `topSubreddits` entry should expose at least one ranking basis through `karma`, `posts`, or `rankSource = source_order`
- when both `karma` and `posts` are absent, preserve upstream source order rather than inventing a fake sort
- `moderatorOf` should only appear when non-empty.
- `inferredInterests` should stay broad and non-creepy.
- `coverageNote` should appear when the imported snapshot is incomplete or stale.

Good interest labels:

- hip-hop
- local politics
- fantasy football
- design
- left-field electronic

Bad labels:

- contrarian personality
- right-wing male
- depressed

## Suggested Copy Direction

Use product language that is plain and specific.

Good:

- Verify your Reddit account
- Import a historical snapshot of your Reddit activity
- Pirate uses this to improve suggestions and bootstrap reputation context
- You can skip this and continue

Avoid:

- Sync your Reddit forever
- We analyze who you really are
- Import your identity

## Recommended Backend Additions

These are not required to start Storybook, but they would reduce future redesign churn.

- add an import result summary payload for completed onboarding imports
- add machine-readable import warnings such as `partial_coverage` or `source_unavailable`
- add a more specific verification error code surface
- add a dedicated global `.pirate` availability endpoint or read-model for inline username validation during onboarding. The existing profile rename route is not sufficient for a good typing experience. This endpoint should support debounced label-checking as the user types, returning availability status and optionally a suggested alternative when the label is taken.
- expose a handle-suggestion result once verification succeeds, to be passed as prefill into the username composition
- prefer structured progress fields over a freeform `progressLabel` if backend job progress becomes meaningful
- parameterize import-source metadata if Pirate later supports more than one archival ingestion backend

## Handoff Notes For The Design Model

The design model should treat this as three compositions:

- `OnboardingRedditOptional`: verify/import/summary/skip/continue
- `OnboardingChoosePirateUsername`: single visible name decision
- `OnboardingCommunitySuggestions`: post-name destination choice

The design model should not redesign the information architecture away from that sequence unless there is a strong product argument.

`generatedHandle` and `cleanupRenameAvailable` must not appear in any onboarding composition. The generated handle is outer flow/session state only.
