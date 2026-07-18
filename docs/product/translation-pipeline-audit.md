# Translation pipeline audit and decisions

Status: verified against the API implementation on 2026-07-18.

## Current architecture

Post and comment translation runs in `api/services/api`. Writes create rows in the shared D1-backed `community_jobs` queue. A scheduled runner polls that queue once per minute, processes at most 25 jobs sequentially, leases work through a Durable Object, retries with exponential backoff, and stops selecting a job after eight attempts.

Post prewarming is limited to `machine_allowed` and `hybrid` policies; the post default is `none`. Published comments prewarm unconditionally. Translation jobs share the FIFO lane with publish finalization, media analysis, asset delivery, live-room work, and other community jobs.

OpenRouter is the sole provider. The default model is the stable `google/gemini-2.5-flash-lite` identifier and can be overridden with `OPENROUTER_TRANSLATION_MODEL`. Responses use temperature zero and a strict JSON schema. A JSON parse failure is retried once with the maximum completion-token allowance; that retry is not currently conditioned on `finish_reason`.

Materialized translations are stored in `content_translations` and keyed by content type, content ID, field key, locale, and source hash. Readers resolve `?locale=`, expose translated fields and `translation_state`, and lazily enqueue missing work. Translation policy is enforced during materialization and reading.

## Findings and decisions

### P0: terminal failures must not create unlimited retry cycles

Previously, queue deduplication recognized only `queued` and `running` rows. A read of content whose translation had exhausted eight attempts created another job, allowing an unlimited sequence of eight-attempt cycles.

Decision:

- Translation job identity includes content ID, locale, and source hash.
- An exhausted failure for that exact identity is reused instead of enqueued again.
- Readers expose `translation_state = failed` for that identity.
- Editing content changes the source hash and therefore permits a fresh attempt cycle.
- Workers compare the queued source hash with the current content before materializing, and complete stale jobs without writing a translation.

This deliberately does not reset failures when only the provider model or prompt changes. A future operator-controlled retry should be explicit and auditable rather than restoring read-driven unlimited retries.

### P0: pin a stable default provider model

The dated preview model identifier was a production retirement risk. The default is now the stable model slug, while the environment override remains the operational control point. A fallback chain remains future work.

### P1: validate semantic translation invariants

Provider validation checks types, enum values, and target-locale echo, but it does not require non-empty translated fields when the outcome is `translated`. Materializers also treat any matching cache row as complete. Add outcome-dependent validation before caching and repair or ignore semantically incomplete existing rows.

### P1: make language detection reliability actionable

Source-language detection is a stopword heuristic. Short text tends to default to English, and false same-language detection suppresses translation until the source hash changes. Confidence and reliability columns exist but are not populated by the create path.

Gate the `same_language` shortcut on reliable detection. For unreliable or short text, reconcile with provider detection instead of permanently caching the heuristic result.

### P1: isolate high-value queue work

Sequential shared processing lets unconditional comment prewarming delay publish finalization and other user-visible work. After the retry leak is closed, introduce priority or separate lanes. Independently, make comment translation lazy-only or constrain prewarming with a per-community locale allowlist.

### P2: align contract and implemented state

Remove dead `song_artifact_bundles.translation_status` and `translated_lyrics_json` contract fields rather than reviving a bundle-level scalar that cannot represent per-locale, per-line completion. Resolve the unused `require_video_transcription` policy and language-detection metadata similarly: implement them end to end or remove them.

### P2: improve failure diagnostics and retry semantics

Retry truncated output only when provider termination metadata supports that diagnosis. Distinguish permanent provider/schema failures from retryable transport failures, and expose operational metrics for terminal translation failures and queue age by job type.

## Dual-language lyric and subtitle path

The blocking data-model problem is canonical lyric-line identity. Karaoke timing hashes are alignment-dependent, while Study IDs are positional over filtered text. Neither can safely own translations.

Sequence:

1. Define canonical lyric lines in `core`, with stable line IDs independent of alignment and Study filtering.
2. Migrate Karaoke timing and Study localization to reference canonical line IDs.
3. Store translations normalized by canonical line ID and locale; reuse Study localizations only after explicit mapping.
4. Ship bilingual Karaoke payloads on song posts as the first user-visible validation.
5. Add an explicit video-to-song relationship and clip timing contract.
6. Add clip-window intersection and WebVTT delivery after linkage and timing accuracy are proven.

Rights for translated lyrics require an explicit product and licensing decision before release.

## Verification note

Focused provider, locale, and localization tests pass. The translation runner fixture currently fails locally before reaching translation assertions when `CONTROL_PLANE_DATABASE_URL` is absent. Confirm whether CI supplies that variable; regardless, the fixture should fail or skip with an explicit environment diagnostic rather than obscuring the cause.
