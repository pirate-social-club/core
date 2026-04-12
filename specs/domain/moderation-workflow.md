# Moderation Workflow

Status: draft

Related docs:

- [moderation.md](./moderation.md)
- [community.md](./community.md)
- [post.md](./post.md)
- [notifications.md](./notifications.md)

## Purpose

This doc defines Pirate's minimal v0 moderation workflow.

It is the operational companion to [moderation.md](./moderation.md).

This doc focuses on:

- the minimal moderation objects Pirate should create
- when a moderation case should or should not exist
- how platform signals and user reports become work
- how a creator or single moderator resolves that work

## Non-goals

This doc does not define:

- multi-moderator voting or quorum
- appeals
- assignment workflows
- moderator chat or XMTP integration
- detailed automod rule authoring
- configurable thresholds

Those may be added later without changing the core v0 object model.

## V0 Design Goal

Pirate should ship the smallest system that can support:

- platform-analysis signals
- user reports
- single-creator or single-moderator communities
- one review surface for unresolved cases
- a clean path to future multi-moderator governance

The central object should be a `moderation_case`.

Signals and reports create or enrich cases.

Actions resolve cases.

Implementation note:

- the current v0 implementation supports user-report cases and explicit review-required or blocked analysis outcomes that already hold content
- the `flag_only` bucket described below is still deferred until Pirate emits normalized non-blocking moderation signals plus community-policy evaluation for those signals
- pre-publish `acrcloud_*` review holds are intentionally treated as operational or rights/compliance publish gates rather than moderation-case producers, so those holds do not enter `Needs Review` in v0 unless another moderation-producing input exists

## Core Objects

Pirate v0 should use exactly four moderation objects:

1. `moderation_signal`
2. `user_report`
3. `moderation_case`
4. `moderation_action`

### moderation_signal

`moderation_signal` is the moderation-facing normalized signal object created from platform analysis.

Suggested fields:

- `moderation_signal_id`
- `community_id`
- `post_id`
- `analysis_result_ref`
- `source`
  - `platform_analysis`
- `signal_type`
- `severity`
  - `low`
  - `medium`
  - `high`
- `provider`
- `provider_label`
- `evidence_ref` nullable
- `created_at`

Rules:

- this object is the canonical moderation-facing store for normalized platform signals
- the analysis row may still retain `content_safety_signals_json` or equivalent provider evidence snapshots
- the analysis row is evidence-oriented
- `moderation_signal` is workflow-oriented
- Pirate should not treat the JSON blob on the analysis row as the primary operational object for queues or case linkage

### user_report

`user_report` is a user-submitted flag on a post.

Suggested fields:

- `user_report_id`
- `community_id`
- `post_id`
- `reporter_user_id`
- `reason_code`
  - `spam`
  - `harassment`
  - `hate`
  - `sexual_content`
  - `graphic_content`
  - `misleading`
  - `other`
- `note` nullable
- `created_at`

Rules:

- v0 reports should remain simple
- the report reason taxonomy should be user-facing and legible, not provider-facing
- user reports are independent moderation inputs even when no platform signal exists

### moderation_case

`moderation_case` is the canonical review object.

Suggested fields:

- `moderation_case_id`
- `community_id`
- `post_id`
- `status`
  - `open`
  - `resolved`
- `queue_scope`
  - `community`
  - `platform`
- `priority`
  - `low`
  - `medium`
  - `high`
- `opened_by`
  - `platform_analysis`
  - `user_report`
  - `mixed`
- `created_at`
- `updated_at`
- `resolved_at` nullable

Rules:

- there should be at most one open case per `post_id` per community in v0
- additional signals or reports should attach to the same open case rather than creating duplicates
- `opened_by` is a derived convenience field, not the authoritative source of truth
- the authoritative source of truth is the attached `moderation_signal` and `user_report` records

### moderation_action

`moderation_action` is the creator or moderator's resolution log.

Suggested fields:

- `moderation_action_id`
- `moderation_case_id`
- `community_id`
- `post_id`
- `actor_user_id`
- `action_type`
  - `dismiss`
  - `hide`
  - `remove`
  - `restore`
  - `age_gate`
- `note` nullable
- `created_at`

Rules:

- v0 should keep the action set narrow
- `dismiss` is required because most moderation review ends with "leave it up"
- `age_gate` is required because a moderator may need to tighten adult handling without otherwise removing the post
- v0 does not require `lock`, `unlock`, or user-penalty actions here

## Relationship To Post And Analysis State

Moderation workflow should not become a second source of truth for core publishability.

Rules:

- post publishability still comes from the base `analysis_state` and `content_safety_state` merge rule defined in [post.md](./post.md)
- moderation cases record review workflow
- moderation actions may mutate the post's visible state or age-gate state
- moderation signals and reports explain why work exists

Interpretation:

- case existence does not itself determine whether a post is public
- a case may exist for a post that is already public
- a case may also exist for a post that is already held by platform analysis

## Case Creation Rules

This is the most important v0 rule set.

Pirate should not create a moderation case for every weak classifier signal.

### Three-Way Split

Every analysis result should fall into one of three buckets:

1. `clean_or_non_actionable`
2. `flag_only`
3. `platform_risk`

#### clean_or_non_actionable

Meaning:

- no moderation work should be created

Behavior:

- retain analysis evidence if useful
- optionally create no `moderation_signal` at all for clearly irrelevant results
- create no case

#### flag_only

Meaning:

- the content may be relevant to community moderation or later ranking/labeling, but does not itself justify immediate work

Behavior:

- create one or more `moderation_signal` rows
- create a case only if:
  - the community policy for the matched category is `review`, or
  - a user report later arrives

Examples:

- legal slur-containing content in a community that reviews slurs
- adult content that is allowed but may need `18_plus`
- graphic content that is lawful but community-sensitive

#### platform_risk

Meaning:

- the content matches a platform-floor category or otherwise requires immediate platform-level review

Behavior:

- create a `moderation_signal`
- always create a `moderation_case`
- route the case to the `platform` scope
- hold or block publication when the underlying post state machine requires it

Examples:

- credible threats
- likely illegal exploitation content
- ambiguous sexual-age cases
- likely unlawful incitement or criminal solicitation

## User Report Rules

User reports are first-class inputs.

Rules:

- a user report should attach to an existing open case for the same post if one exists
- otherwise the report should create a new `moderation_case`
- if later evidence indicates the case is platform-floor relevant, the case may be escalated from `community` to `platform`

Interpretation:

- reports do not require a supporting platform signal to matter
- repeated reports can increase priority even without classifier support

## queue_scope Derivation

`queue_scope` should be derived by rule, not chosen arbitrarily.

Rules:

- if the triggering signal matches a platform-floor category, `queue_scope = platform` regardless of community settings
- otherwise, if the case exists because of community policy review or because a user report needs moderator attention, `queue_scope = community`

This means the platform floor always wins routing.

## Priority Derivation

Priority should be hardcoded in v0.

Suggested v0 rules:

- `high`
  - platform-floor case
  - or 3+ `user_report` records within the last 24 hours
- `medium`
  - 2 `user_report` records within the last 24 hours
  - or a case opened because community policy says `review`
- `low`
  - 1 `user_report` with no supporting platform signal
  - or another low-confidence case that still became work

Rules:

- v0 should not expose priority tuning to communities
- priority is an operational aid, not a visible governance decision

## Resolution Semantics

Each moderation action should map clearly back to post state.

Suggested v0 mapping:

- `dismiss`
  - leave the post state unchanged
- `hide`
  - set `post.status = hidden`
- `remove`
  - set `post.status = removed`
- `restore`
  - restore the post from `hidden` or `removed` to the prior visible state allowed by product rules
- `age_gate`
  - set `age_gate_policy = 18_plus`
  - optionally tighten `content_safety_state` where needed for consistency

Rules:

- moderation actions should not silently mutate unrelated post state
- the case resolution should be auditable from the action log

## Minimal Queue Model

V0 needs only one review surface:

- `Needs Review`

That surface may still display labels derived from `queue_scope`.

Suggested visible case labels:

- `Flagged by Pirate`
- `Reported by member`
- `Needs platform review`
- `Reported and flagged`

Rules:

- v0 does not need separate queue tabs yet
- one list plus clear labels is enough for single-creator communities

## Minimal Case Detail Model

Each case detail view should show:

- the post or content preview
- why the case exists
  - attached signals
  - attached reports
- the post's current visible state
- the available moderator actions
- prior moderation actions

This is enough to support creator moderation without building a full Trust and Safety console.

## Minimal UI Surfaces

V0 should only require three moderation-facing surfaces:

1. `Report Post`
2. `Needs Review`
3. `Case Detail`

### Report Post

User-facing report dialog.

Required inputs:

- report reason
- optional note

### Needs Review

Creator or moderator-facing list of open cases.

Recommended visible fields:

- post preview
- source label
- priority
- created time
- current post status

### Case Detail

Creator or moderator-facing review panel for one case.

Required controls:

- dismiss
- hide
- remove
- restore
- age-gate

## Future Compatibility

This model should be designed so later governance features are additive.

Later additions may include:

- `case_comment`
- `case_assignment`
- `moderator_vote`
- `appeal`
- `discussion_thread_ref`

Those should attach to `moderation_case` rather than replacing it.

## Bottom Line

Pirate v0 moderation should be:

- signal-driven
- case-based
- simple for single creators
- strict about not creating work from every weak classifier output

The system should begin with:

- platform signals
- user reports
- one canonical case object
- one action log
- one review list

That is enough to ship and is still structurally correct for later growth.
