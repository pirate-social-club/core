# Rights Review

Status: draft

Related docs:

- [livestream.md](./livestream.md)
- [live-segments.md](./live-segments.md)
- [marketplace.md](./marketplace.md)
- [monetization.md](./monetization.md)
- [royalty-graph.md](./royalty-graph.md)
- [asset.md](./asset.md)

## Purpose

This doc defines how Pirate handles manual rights review for content that may implicate third-party music rights.

It covers:

- ACRCloud-triggered review
- review-case identity
- review authority
- evidence submission
- payout hold and release outcomes

## Core Principle

Rights review is a Pirate platform function in v0.

Recommended v0 rule:

- ACRCloud and related analysis systems produce evidence
- Pirate platform review decides whether that evidence is cleared, linked to upstream rights, or blocked
- club owners, TLD owners, hosts, and performers may submit context, but they do not have unilateral final-clearance authority for flagged third-party rights cases

## Review Triggers

Typical review triggers include:

- ACRCloud candidate matches on a replay asset
- ACRCloud candidate matches on the live mix when Pirate treats them as rights-relevant
- detected audio use that appears inconsistent with the declared rights path
- disputes or operator escalations on a replay or monetized performance

## Canonical Object

Suggested v0 `rights_review_cases` shape:

- `rights_review_case_id`
- `subject_type`
- `subject_id`
- `community_id`
- `status`
- `trigger_source`
- `analysis_result_ref` nullable
- `submitted_evidence_refs_json` nullable
- `resolution`
- `resolver_user_id` nullable
- `created_at`
- `updated_at`
- `resolved_at` nullable

Suggested meanings:

- `subject_type`
  - `asset`
  - `live_room`
  - `replay_asset`
- `status`
  - `open`
  - `under_review`
  - `resolved`
  - `blocked`
- `trigger_source`
  - `acrcloud_match`
  - `manual_report`
  - `operator_escalation`
- `resolution`
  - `clear`
  - `clear_with_upstream_refs`
  - `block`
  - `needs_more_evidence`

## Review Authority

Recommended v0 authority model:

- Pirate platform review is the final authority
- in practice, the Pirate platform operator may personally perform this review in v0
- club owners, TLD owners, hosts, guests, and other involved parties may submit evidence or context
- community-local governance does not override Pirate platform review for flagged third-party rights cases

## Evidence Submission

Evidence may include:

- claimed license documents
- official-catalog or community-affiliation evidence
- performer declarations
- manually supplied song lists or setlists
- links to Story records or other upstream rights records
- segment-level declared-versus-detected mismatch context

Recommended v0 stance:

- evidence submission is an operational workflow first, not a public self-serve API requirement
- a later API may expose structured evidence submission for hosts or club owners

## Outcomes

### `clear`

Use when:

- no valid third-party rights issue remains
- candidate matches are rejected or deemed non-blocking

Effect:

- held replay publication may proceed
- held rights-sensitive payouts may release

### `clear_with_upstream_refs`

Use when:

- the match is accepted as a real upstream reference
- Pirate can attach the required derivative links or royalty-graph edges

Effect:

- accepted upstream references are attached
- monetization may proceed under the required payout path
- held payouts may release only after the reference state is valid

### `block`

Use when:

- the detected use is not permitted
- required rights context cannot be established
- the replay or monetization path should not continue

Effect:

- replay publication or replay sale remains blocked
- held payouts remain blocked or move to later refund/remediation policy

### `needs_more_evidence`

Use when:

- Pirate cannot safely clear or block the case yet

Effect:

- replay remains in review
- payouts remain on rights-review hold

## Relationship To Livestream Replay

For livestreams:

- `replay_status = review_pending` should correspond to an open rights-review case when the trigger is rights-related
- replay should not advance to publishable or sellable state until the review case resolves

## Relationship To Payouts

Rights review creates a narrow exception to immediate payout release.

Recommended v0 rule:

- if a live room or replay is flagged for rights review, rights-sensitive payout release may enter a pending hold
- this exception should remain narrow and tied to flagged rights cases, not become a general escrow model

## Open Questions

- Should operator-only rights review tooling become a documented internal API surface, or remain operational playbook territory in v0?
- When structured evidence submission is exposed later, should it attach to the review case or directly to the replay asset / live room?
