# Questions

Status: current working spec

Related docs:

- [community.md](./community.md)
- [post.md](./post.md)
- [artist-catalog.md](./artist-catalog.md)
- [karma.md](./karma.md)
- [feed.md](./feed.md)

## Purpose

This doc defines Pirate's lightweight club question system.

It covers:

- daily club questions
- backend or agent-generated prompts
- relationship to club posts
- answer and reward mechanics
- relationship to karma

## Non-goals

This doc does not define:

- a Duolingo-style study product
- FSRS or spaced repetition
- streak contracts
- onchain question registries
- a classroom-style language-learning UX

## Core Principle

Questions are club engagement content, not a separate study product.

They should:

- seed daily participation
- create meaningful low-friction activity
- fit naturally into the club board/feed
- award small community karma when answered correctly

Language learning may happen as a side effect, but it is not the primary frame.

## Community Agent

Questions should usually be posted by a community-associated bot or agent.

Recommended v0 model:

- each club may have a `community_agent_user_id` or equivalent app-level system actor
- the agent is platform-managed in v0
- the agent may post system-tagged club content such as daily questions
- moderators may disable or review agent-generated questions
- when the community agent publishes system-tagged question content in v0, it is exempt from ordinary member posting quotas; see [community.md](./community.md)

Important boundary:

- the community agent is not an independent governance authority
- it is a product actor operating within community settings and moderation rules

## Relationship To Posts

Questions should appear as normal club posts with attached question metadata.

Recommended v0 shape:

- a question has a backing `post_id`
- the visible board thread is just a normal post authored by the community agent
- comments and discussion happen on that post as usual

Suggested question fields:

- `question_id`
- `post_id`
- `community_id`
- `author_user_id`
- `question_kind`
- `prompt`
- `choices_json` nullable
- `correct_answer_ref`
- `explanation` nullable
- `source_type`
- `source_ref`
- `status`
- `published_at`
- `expires_at` nullable
- `created_at`
- `updated_at`

Suggested meanings:

- `question_kind`
  - `meaning`
  - `slang_context`
  - `song_id`
  - `artist_fact`
  - `translation`
- `source_type`
  - `lyrics`
  - `annotation`
  - `artist_catalog`
  - `club_lore`
- `status`
  - `draft`
  - `published`
  - `closed`
  - `revealed`

Rules:

- rewardable v0 questions should use multiple-choice answers
- for rewardable multiple-choice questions, both `correct_answer_ref` and `selected_answer_ref` should use the same format
- in v0, that format should be a zero-based index into `choices_json`
- when `expires_at` passes, the question should stop granting new karma rewards even if the thread remains readable
- expired questions should move to `closed` or `revealed`; they should not remain indefinitely rewardable

## Generation Model

Questions are generated from club-relevant source material.

Good v0 inputs:

- lyrics refs
- annotation content
- artist metadata
- known track catalog
- club-linked reference material

Recommended v0 flow:

1. backend or community agent generates candidate questions
2. club may optionally review or approve them
3. one question is published as the daily club question
4. users answer through the product UI
5. answer reveal and explanation may be posted later

## Daily Cadence

Questions work best as a lightweight cadence mechanic.

Recommended v0 default:

- at most one rewardable daily question per club per day
- communities may choose to disable daily questions entirely
- later versions may support more frequent prompts, but v0 should stay simple

Interpretation:

- for cadence enforcement, `per day` should evaluate over the previous rolling 24 hours from publish time rather than a calendar-day bucket

This keeps the loop legible and reduces spam in smaller communities.

## Answer Model

Suggested v0 answer fields:

- `question_answer_id`
- `question_id`
- `user_id`
- `selected_answer_ref`
- `is_correct`
- `submitted_at`
- `rewarded_at` nullable

Rules:

- one rewarded answer per user per question in v0
- communities may still allow answer discussion in comments even after a user has answered
- answers are app-level records, not onchain objects
- individual submitted answers should remain private to the answering user, moderators, and the community agent until reveal or close

## Karma Relationship

Correct answers may grant small community karma.

Recommended v0 rules:

- a correct answer may emit a small positive club-karma event
- wrong answers should not create negative karma in v0
- question-reward karma should be capped or low-weight relative to post and comment contribution
- one daily question should not be enough to dominate trust-tier progression

This makes questions a bootstrap mechanism, not a farmable reputation exploit.

Canonical karma rules live in [karma.md](./karma.md).

## Question Types

Recommended v0 question kinds:

- `meaning`
  What does this line mean?
- `slang_context`
  What cultural or slang context explains this line?
- `song_id`
  Which song is this lyric or clue from?
- `artist_fact`
  Fact-based question grounded in artist metadata or known context
- `translation`
  Which translation or interpretation best matches this line?

Important rule:

- `translation` should be treated as one question flavor, not a separate language-learning product mode

## Moderation And Review

Questions should remain auditable and moderator-controllable.

Recommended v0 behavior:

- moderators may disable the community agent's question posting
- moderators may remove a bad question post like any other post
- communities may require review before a generated question is published

## On-chain vs Off-chain

Recommended v0 split:

- questions are app-level content
- answers are app-level records
- karma rewards from correct answers are app-level karma events
- no onchain question registry or attempt contract is needed in v0
- optional streaks, if Pirate wants them later, should start as app-level product state

## Open Questions

- Should answer reveal happen automatically after a fixed time window, or only when the community agent posts the explanation?
- Should communities be allowed to show aggregate answer distributions before reveal, or should all answer visibility stay private until reveal?
- Should communities be allowed to choose between multiple daily questions, or should Pirate keep the cadence to one default question in v0?
- Should open-ended question formats be supported in v0, or should all rewardable questions stay multiple-choice at first?
