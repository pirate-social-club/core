# Telegram Study — Spec & Build State

**Status:** LIVE in production (2026-08-01). First real voice exercise graded end-to-end
in the Music community. This document is the single source of truth for what's built,
what's broken, and what's next.
**History:** v1 of this doc specified a Mini-App-first flow; the product pivoted to
**chat-native** study on 2026-07-31 (user decision). Mini App remains deployed as a
secondary surface (see §8). Superseded v1 content was removed; consult git history if
needed.
**Builder note:** verify every `file:line` against `origin/main` before relying on it
(FETCH-FIRST). This repo's audits found that local checkouts drift.

---

## 1. Product definition (locked)

- **One community bot per community** (BYO BotFather token, encrypted at rest). The bot
  IS the study product for its community. No platform-bot fallback for study.
- **Chat-native flow:** `/start` → welcome + inline menu (📚 Study songs · 💬 Ask the
  assistant · 🌐 Open community) → song picker (inline buttons, paginated) → exercises
  in chat: **multiple choice via inline buttons, say-it-back via native Telegram voice
  messages** → completion summary message (score, streak).
- `/study` = direct entry, same flow. Payload `/start` (tgsetup_/join_) untouched.
- **Identity:** Telegram sender id → Pirate user (implicit, no repeated auth). Unlinked
  users get the account-linking flow. Attempts, FSRS state, streaks, and Lit reward
  qualification all attribute to the Pirate user via the same `submitPostStudyAttempt`
  path as web.
- **Entitlement:** public, published, study-ready songs in study-enabled communities;
  no membership required (parity with web). Locked/paid songs still gated.
- **Gating:** ONE switch for the whole surface: `TELEGRAM_STUDY_VOICE_ENABLED` +
  `TELEGRAM_STUDY_VOICE_COMMUNITY_IDS` allowlist (wrangler.jsonc vars, NOT secrets).
  Currently enabled for: Music (`cmt_fb2bacac74b144eaa58802b476eb9f3b`,
  @karaoke_english_bot) + the Tame Impala canary.

### 1.1 Telegram lesson presentation (locked 2026-08-08)

This section supersedes every earlier progress and feedback presentation proposal in
this document. Web is the behavioral reference; Telegram renders the server-owned
lesson state and MUST NOT implement its own retry or requeue rules.

- **Progress:** no bar, cells, fraction, percentage, duration estimate, or lesson-start
  message. Each prompt has a localized, standalone `#️⃣ Questions left: N` line, where
  `N = lesson.total_count - lesson.resolved_count`. The value describes questions
  remaining in the lesson, may remain unchanged after a miss, and is never an ETA.
  Completion replaces a would-be `0` prompt.
- **Review:** `lesson.next.is_reappearance` alone adds a localized `🔁 Review` line
  above the remaining count. `retry_in_place` is an immediate retry, not a review.
- **Multiple choice:** correct renders localized `✅ Correct`. Incorrect renders
  localized `❌ Incorrect` plus `✅ <correct option>`; retain the answer reveal for
  parity with Web.
- **Spoken recall:** correct renders localized `✅ Correct`. Incorrect with a non-empty
  transcript renders localized `❌ Incorrect` and `You said: "<transcript>"` only;
  an empty transcript renders only `❌ Incorrect`. Never render `The line was`,
  `Missed`, `Extra`, a target-line echo, or a token diff. The renderer has no overlap
  gate. Server-side ungradable behavior is separate and remains disabled.
- **Transcription failures:** temporary, terminal, and non-chat continuation failures
  are localized technical failures. They do not submit an answer, consume an attempt,
  or advance lesson progress.
- **Completion:** localized `🎉 Lesson complete`, then
  `✅ first_pass_correct_count/served_count`, then a localized `🔥 N days` streak.
  The score comes only from an authoritative completed session. Omit it when that
  session is unavailable or `served_count <= 0`; never substitute daily engagement
  counters or `required_correct_count`.
- **Localization:** all surrounding chrome uses the helper language in `en`, `zh`,
  `ar`, `ka`, and `ru`; only the studied lyric or phrase remains in its learning
  language. Locale copy owns word order and number handling.
- **Scope:** presentation only. No engine, contract, migration, reward, ranking, or
  feature-flag changes. `SONG_STUDY_UNGRADABLE_RERECORD_ENABLED` stays off.

Required regression coverage: no `▰`/`▱`; remaining count holds on incorrect and no
`0` prompt is sent; review appears only for `is_reappearance`; feedback variants and
all transcription-failure branches match the rules above in all five locales; stale
callbacks use refreshed lesson state; completion never reads score from
`study_progress` or `required_correct_count`; missing session data omits score. The
completion ratio is currently honest because every served question is stored with
`qualifies_for_reward = 1`. Pin that invariant in a test: if a future non-qualifying
question such as `say_translation` enters lessons, the test MUST fail until the score
uses a genuine all-question first-attempt numerator.

## 2. As-built architecture (api)

- **Webhook entry:** `POST /telegram/community-bots/:webhookId/webhook` (per-bot
  secret, timing-safe). Dispatch order in `routes/telegram.ts`: `callback_query`
  (menu handler → study handler) → `chat_join_request` → `chat_shared` → `/start` →
  private-chat voice (study) → assistant. Assistant stays reachable for ordinary text.
- **Chat sessions:** `telegram_chat_study_sessions` (control-plane migration 0175) —
  one live session per `(telegram_community_bot_id, telegram_user_id)` (partial unique
  index), lifecycle `selecting → active → processing → completed|canceled|failed`,
  rotating `action_token` makes stale buttons inert, 30-min TTL (read-side).
- **Message dedupe:** `telegram_chat_study_message_deliveries` (0176) — keyed
  `(bot, user, message_id)`, `processing → consumed|failed` with 2-min lease; human
  re-tap of a consumed menu gets guidance; concurrent redeliveries silent.
- **Callback dedupe (exercise buttons):** `telegram_chat_study_callback_deliveries` —
  PK `callback_query_id` upsert + session-token CAS. Opaque 27-byte
  `study:<token>:<index>` callback data; correct answers never leave the server before
  the attempt is spent.
- **Voice loop:** `telegram_study_voice_intents` (0172) — full attempt coordinates,
  idempotency key minted at creation (attempt table is UNIQUE(user_id,
  idempotency_key)), per-(bot,user) active-intent scoping, CAS claim, 3-attempt cap
  with terminal notify, retryable failures extend TTL and clear voice ids, grading via
  `waitUntil` **wrapped in `withBackgroundControlPlaneClients`** (api#714 trap — the
  test env structurally cannot detect this wrapper being removed; treat it as
  hand-guarded).
- **Prompt-delivery uncertainty:** 0173 — Telegram sends recorded `uncertain` on
  timeout, never blind-retried.
- **Account linking:** cross-context link-intent (0174): Mini App mints intent →
  external browser Pirate auth consumes → provider link reassigned. Conservative rule:
  never auto-merge two established users.

## 3. Live-fire lessons (both invisible to CI — synthetic webhook posts bypass them)

1. **`allowed_updates` filter:** community-bot webhooks were registered with
   `["message","chat_join_request"]` — Telegram never delivered ANY button tap. Fixed:
   `callback_query` added + owner "Refresh webhook" action. **Any future update type
   (e.g. `message_reaction`) needs BOTH code handling AND webhook re-registration.**
2. **Identity-bridge asymmetry — FIXED in api#976 (`11fbe3c7`):**
   `resolveTelegramAccount` now materializes the missing `telegram_accounts` row on a
   provider-link fallback hit (conflict-safe: active provider link authoritative,
   insert only when neither side is already represented, `ON CONFLICT DO NOTHING`,
   still returns the linked user when the safety guard skips the insert). Voice-intent
   creation additionally accepts the originating Telegram user id for the chat path.
   Regression-watch only.

## 4. Open defects (verified in code 2026-08-01)

| # | Defect | Fix |
|---|---|---|
| D1 | Identity asymmetry (§3.2) | **SHIPPED api#976** — regression-watch only. |
| D2 | **PARTIALLY fixed in #976.** Reorder shipped (intent+prompt now precede the `await_voice` CAS), which fixes the original stranding but introduces the inverse: Telegram can receive "Say this line back" while the session CAS then fails → recording arrives against a session not awaiting voice. (`chat-study-service.ts:632-649` vs prompt delivery `study-voice-service.ts:263-280`.) | **Harden:** split intent creation into prepare/persist vs deliver phases. One control-plane transaction: insert intent + CAS session → `await_voice`, commit, THEN send the Telegram prompt, then record sent/uncertain. DB internally consistent before Telegram sees anything; preserves the uncertain-delivery model. |
| D3 | Earlier feedback shipped a raw token diff and repeated the target line. | **SUPERSEDED by §1.1.** Match Web: transcript only on spoken misses, terse localized verdicts, and retain the MCQ answer reveal. |
| D4 | Voice disclosure repeats on EVERY prompt (`study-voice-service.ts:266-270`, unconditional). | Include the disclosure only when the `chat_study_session_id` has no earlier prompt with status sent/uncertain; suppress on subsequent prompts. No schema migration needed (a `voice_disclosure_sent_at` column is the more explicit later option). Preserve the disclosure for Mini-App/non-chat intents. |
| D5 | Song list = newest-40-then-filter, 8/page; older ready songs invisible; sequential N+1 capability scan | Real pagination over ALL eligible songs; batch capability (and campaign, §5.4) lookups. |
| D6 | Repeat-tap dedupe can't distinguish sequential Telegram redelivery from human re-tap (message_id-keyed) | Dedupe menu taps by `callback_query_id` first, message_id for the human-re-tap signal. Low priority. |
| D7 | ENS: RPC *hang* fails open (3s timeout) but this pattern is hand-guarded; `not_found`-vs-error distinction shipped — keep a test on the error path | Done in #968; regression-watch only. |

## 5. Next slices (agreed 2026-08-01, each independently shippable)

1. **"Stop looking broken" — SHIPPED PROD 2026-08-01 ~09:17Z** (api#979 `1189db07` via
   pin `aee732fa`; D2 atomic tx, D3 reveal + `(nothing detected)` guard, D4 disclosure
   cadence, MCQ dedup — audited + focused suite verified independently). Deploy was
   unblocked by quarantining staging shard DB_CMTY_0295 (D1 7429 overload; core#365,
   pin pair api#982+web#871, same mechanism as 0859 — **review due 2026-08-08**,
   unquarantine when Cloudflare clears). Original plan for reference:
   1. Refactor voice-intent creation into prepare/persist + deliver phases.
   2. Chat-specific control-plane transaction: insert intent + CAS → `await_voice`
      together; deliver only after commit; keep sent/uncertain recording.
   3. Pass transcription context into chat continuation; reveal-format voice feedback.
   4. Suppress the duplicate MCQ verdict message.
   5. Disclosure conditional on prior delivery within the chat session.
   6. Tests for every failure boundary — the ones #976 does NOT cover: intent persisted
      but session CAS fails; prompt delivery fails after the atomic commit; first vs
      subsequent disclosure; voice feedback contains reference + transcript; MCQ
      redundant-verdict suppression.
   7. Run targeted route tests via `scripts/run-route-tests.ts` only (no broad checks).
2. **Song list rebuild — SHIPPED PROD 2026-08-01 10:27Z** (api#985 `7c3e2bf` /
   web#875 `7943f60`; audited): full keyset pagination, one readiness SQL per 40-post
   page + batched funded-campaign lookup, page-relative callback indexes (no 98/99
   collision at any catalog size), `earn up to $X/day` badges gated on
   active+in-window+study-eligible+funded, **parity test** (`assertParity` matrix)
   guards `batchReadyPostIds` ⇄ `resolvePostStudyCapability` divergence with
   bidirectional cross-reference comments. Original scope:
   `resolvePostStudyCapability` AND active-campaign lookup in one pass; render reward
   badge `Song · earn up to $X/day` ONLY for songs with an active, funded campaign
   (honest copy: "up to"; qualification rules + daily caps apply; rewards are LIVE
   Base-mainnet money — never over-promise).
3. **Language + delivery preference — MERGED WITH SLICE ④ (decided: audio prompts ship
   in the same slice; offering a non-functional "audio" choice would look broken).
   Implementation contracts (locked 2026-08-01, second review):**
   - **Storage:** new control-plane table `user_study_preferences`
     (`user_id` PK, `helper_language`, `delivery_mode` CHECK IN
     ('audio','text','both'), `created_at`, `updated_at`) — global per user,
     independent of bot/community, allowlist-validated, upsert semantics. Do NOT
     overload `profiles.preferred_locale` (general UI locale ≠ study helper language).
     Named without a `telegram_` prefix deliberately: web study may share it later.
   - **Picker entry paths (all of them):** `/study`, `/start → Study songs`, and any
     future direct entry show the picker when no preference row exists; existing
     users without a row are first-run. Changing later: a "⚙️ Language & delivery"
     row on the `/start` menu + `/preferences` command → same picker prefilled.
   - **Initial language list (deterministic):** `en, zh, ar, ka` — exactly the
     existing runtime string-catalog locales — in that order, labeled with native
     names (English / 中文 / العربية / ქართული). The selected helper language controls
     BOTH the translation/localization target AND the study-chat UI locale (one
     choice, one meaning). Expanding the list = adding string-catalog coverage first.
   - **Pending localization flow (exact):** song selected → API enqueues localization
     generation for (song, helper_language) if absent → bot sends localized
     "Translation exercises are being prepared" + CONTINUES with voice exercises now +
     inline "Check again" button (re-evaluates readiness, no new session). "Visibly
     mix" acceptance = when both types are ready, a lesson presents ≥1 MCQ and ≥1
     voice exercise (payload order, no artificial filtering) — asserted by test.
   - **Once-ever disclosure detection:** query prior chat-origin intents with
     `prompt_delivery_status IN ('sent','uncertain')` for the (bot, user) pair —
     NOT "any intent" (an undelivered prompt must not suppress it). Mini-App
     disclosures do NOT count toward chat suppression (Mini-App prompts keep their
     own unconditional disclosure, per §5.1-era decision).
   - **Web trust predicate (ships in this slice):** one shared predicate
     `rewardVisible = status==='active' AND in-window AND activity-eligible AND
     daily_reward_cents>0 AND remaining funded balance>0`; `operational_hold`,
     `funding_quoted`, `unfunded`, `exhausted`, `ended`, `paused` produce NO
     learner-facing earn/boosted claims anywhere (start from `SongRewardOffer`,
     `RewardQualificationNotice`, and grep web for "boost" copy). Owner/operator
     status UI may still show "Operational hold". Chat badges already comply.
   - **TTS (absorbed slice ④):** `sendVoice` the study line via existing ElevenLabs
     infra, cached per (community voice, source line); helper language is deliberately
     excluded because it does not change the source-language audio. `delivery_mode`
     audio/both controls it; text mode = current behavior. **Known v1 cost:** Workers
     Cache API entries are per-colo and evictable, so this is a best-effort cache rather
     than durable global reuse; move prompt audio to R2 if real traffic shows repeated
     cross-colo synthesis cost.
   **Product scope (refined 2026-08-01 from live feedback):**
   1. Explicit helper-language picker on first `/study`, offering ONLY allowlisted
      languages; saved **per-user globally** (decided — native language doesn't change
      between communities).
   2. Audio/text/both delivery preference, same storage.
   3. Localized chat string catalog with English fallback, in a location the web/Mini
      App can share; **per-locale punctuation conventions** (en: no terminal periods on
      short statuses — "Correct", "Not quite"; zh keeps native ：。 forms, e.g.
      请跟读：/ 正确 / 不太对 / 原句是：/ 你说的是：). English voice instruction becomes
      **"Say this:"**.
   4. Remove the recording disclosure from every prompt; show it ONCE-EVER per
      (bot, user) — first-ever voice prompt, detected via any prior intent for that
      pair (no migration) — and keep it discoverable (owner copy already in settings).
      Do NOT delete it outright.
   5. Different-language selection must visibly mix MCQs + voice — BUT MCQs require
      per-song localization generation (lazy LLM job on first request): when pending,
      say "translations are being prepared — check back soon" instead of silently
      serving voice-only.
   6. Trust fix (web, ships with this slice): stop presenting "boosted" for campaigns
      under `operational_hold`/unfunded — chat badges already exclude them correctly;
      web copy currently over-promises. (Separately: rewards workstream should explain
      WHY Music's funded campaigns are on operational_hold — possibly the known
      gas-float shortfall.)
   Original scope for reference:
4. **Audio prompts — ABSORBED INTO SLICE ③** (see above; shipping a delivery-mode
   preference without working audio would look broken).
5. **Onboarding follow-up (agreed 2026-08-02, user + both reviewers):**
   1. First-run picker asks ONLY helper language; Telegram `language_code`-inferred
      language sorted first, labeled "Suggested"; one tap confirms.
   2. On language selection, save `delivery_mode='both'` (product call: audio is the
      strongest first experience; text-fallback already covers failures).
      **Consequence:** the natural cost limiter is gone — a per-community daily TTS
      budget moves from backlog to NEXT (ship shortly after this).
   3. Delivery mode LEAVES first-run but STAYS reachable now: `/preferences` keeps a
      second step (language → delivery) so voice notes have an opt-out — do not defer
      it to a future "prompt format" setting with a gap.
   4. Start-menu row renames ⚙️ Language & delivery → **⚙️ Language**.
   5. Replace the "You've already joined <community>" `/start` headline for MEMBERS
      with an actionable welcome ("Welcome to <community> 🎵 / What would you like to
      do?" + Study/Language/Open community buttons). NON-members keep the join CTA as
      the headline; payload `/start`s (tgsetup_/join_) untouched.
   6. Tests: first-run vs returning member `/start`, non-member variant, suggested
      ordering, both-default row, /preferences two-step retained.
   7. **Voice-intent expiry rework (same PR — fixes the adjacent first-session dead
      end):**
      - TTL 30 min (was 10) — and "one staleness window" means the SESSION and the
        intent share it: the session's expires_at is currently fixed at creation, so
        a late prompt could outlive its owning session. In the atomic prepare/CAS
        transaction, refresh BOTH session and intent to now+30min. After confirmed
        learner-visible delivery (successful text OR voice OR text-fallback-after-
        TTS-failure — uncertain Telegram results keep the prepare-time fallback),
        best-effort extend BOTH to delivered_at+30min, token/session-guarded —
        REUSE the existing `prompt_sent_at` column (migration 0173, already written
        on confirmed delivery); no new evidence column needed.
        Expired-audio recovery must validate the session's expires_at, not merely
        status='active'.
      - **Atomic expired-audio recovery:** when a voice note arrives against an
        expired intent AND the session is still `await_voice` for the same study
        session + exercise, ONE control-plane transaction: lock/validate session →
        transition the stale intent `pending → expired` (REQUIRED — expiry is
        read-side, the row still occupies the one-active-intent partial unique
        index) → insert fresh intent (fresh idempotency key, server-derived
        coordinates, already bound to the incoming voice message/file ids) → claim
        it `processing` in the same tx → commit → grade. Never insert-unclaimed-
        then-rediscover (redelivery race).
      - **Rolling window covers ALL prompts, not just voice:** the session is a
        rolling 30-min window refreshed after every learner-visible prompt/action —
        MCQ presentation included (today only `prompt_message_id` updates on MCQ
        send; a late MCQ can expire moments after appearing). Add a late-MCQ test.
      - **Restart button contract:** callback_data
        `study-restart:<chat_study_session_id>` (the opaque session id, NOT the
        mutable action token — the ordinary loader rejects expired sessions, which
        is exactly the state this button serves; ≤64B, same regex family). Handler:
        look up by session id + bot + telegram user WITHOUT requiring
        active/unexpired status → `claimCallback` (callback-id dedupe, idempotent
        redelivery = silent no-op) → start the normal `/study` picker flow (NOT
        resume the dead song — the session that would anchor a resume is exactly
        what's gone). Localized label from the string catalog (en "Start again",
        zh/ar/ka equivalents). Tests: dead session, moved-on session, repeated tap.
      - Tests: late-session prompt cannot outlive its session; late-MCQ rolling
        refresh; text fallback refreshes the window; concurrent redelivery → exactly
        one replacement intent; stale row sheds the incoming voice ids (claimed
        replacement owns them); recovery refuses active-status-but-expired sessions.
      - **Repo boundaries:** onboarding + expiry/recovery = ONE api PR; the
        audio-config settings warning (§5.5.8a) = web PR (current study settings
        mention only the ElevenLabs integration, not the voice-reply-mode + TTS-voice
        requirement — community-study-policy.tsx:54); the fallback ops signal
        (§5.5.8b) = separate api/observability item. Coordinated, not one PR.
   8. **Audio-config surfacing (found live 2026-08-02):** Music's first audio prompt
      silently fell back to text (`last_error_code=telegram_prompt_audio_fell_back_
      to_text`) — TTS needs the community's assistant VOICE POLICY (voice mode +
      selected ElevenLabs voice) configured, not just the credential; with the
      assistant disabled it's never set, so audio mode == text mode invisibly.
      **Cause PROVEN 2026-08-02** via stored `last_error_message` on
      `tsv_28b74d06…`: "Assistant voice replies are disabled for this community" —
      the `assertSpeechPolicy` voice-mode gate. Unblock = configure Music's
      voice-reply mode + TTS voice in settings (no deploy).
      (a) Community settings must warn "audio prompts require a configured voice"
      when the policy gate would refuse; (b) repeated audio-fallbacks per community
      need an ops signal (the error currently lands in a column nobody reads).
      ElevenLabs→Telegram voice note remains UNPROVEN until Music's voice is
      configured and one audio prompt is re-tested.
   **First-run testing recipe (no DB writes):** message the canary bot from the
   second Telegram account (`…9009`, detached from any Pirate user) — auto-exchange
   mints a fresh user with no preference row = true first-run. NO ad-hoc prod
   deletes of `user_study_preferences`; an operator reset route only if live-fire
   testing becomes routine.

## 6. Backlog (non-blocking, recorded)

- Members-only-via-Mini-App voice path: members can route members_only recordings
  through the owner's bot (disclosure ships; POLICY not decided — decide + document).
- Crash-path to the 3-attempt cap is a silent no-op (learner unnotified until TTL).
- Terminal intent doesn't clear voice ids (same-audio resend after exhaustion
  swallowed).
- Link-offer UX in Mini App: unconditional, undismissable, token in query string;
  orphan user rows not retired.
- `waitUntil`-wrapper source-text/lint guard (test env can't catch removal).
- Secret drift: Infisical is source-of-truth but worker secrets don't sync
  (`deploy-staging.sh` only CHECKS) — bit us with `ETHEREUM_RPC_URL`; consider a
  sync step.
- 4096-char message bound unguarded; ~4 bot calls per MCQ tap with no 429 handling.

## 7. Ops runbook

- **Enable a community:** active BYO bot + `study_enabled` + song posts + add
  community id to `TELEGRAM_STUDY_VOICE_COMMUNITY_IDS` (wrangler.jsonc, api PR + pin
  bump; NOT a secret). Then owner: Refresh webhook (settings) if the bot predates the
  current `allowed_updates`.
- **Buttons dead?** First check webhook `allowed_updates` (§3.1), then delivery rows:
  `telegram_chat_study_message_deliveries.last_error_message` /
  `telegram_chat_study_sessions` via control-plane read (Bun `SQL` script +
  `infisical run --env=prod --path=/services/control-plane`; `psql` absent on the
  workstation). Zero rows = updates never arrived (Telegram-side).
- **Live tracing:** `wrangler tail api-core --format json` (NO `--env production` —
  that targets a nonexistent script name). Errors surface as
  `[telegram-webhook] update handling failed` warns.
- **Deploy discipline:** api merges via merge queue (verify `mergedAt`); prod api =
  pin in `web/.github/release-refs/api.sha`; pin-bump push run IS the prod deploy;
  verify `/__version` on both workers, never trust run conclusions.

## 8. Mini App (secondary surface — kept, not canonical)

`/tg/*` routes, Telegram SDK loaded on `/tg` documents only, route-scoped
`frame-ancestors https://web.telegram.org`, community-scoped session auto-exchange
(`context:"study"` = community-bot token only, no platform fallback), study route
`/tg/c/:communityId/p/:postId/study`. BotFather named-app registration is OPTIONAL
(branded entry only; chat flow doesn't need it): short name e.g. `study`, URL
`https://pirate.sc/tg/c/<COMMUNITY_ID>`.

## 9. Testing traps (hard-won)

- Synthetic webhook POSTs bypass Telegram's `allowed_updates` filter AND its media
  pipeline — anything only real Telegram exercises is unproven until a real client
  touches it (this bit twice: callback_query filter, OGG pipeline).
- The libsql test env makes `withBackgroundControlPlaneClients` a no-op — background
  client-scope regressions are undetectable by tests.
- api route tests via `scripts/run-route-tests.ts`; web: never bare `bun test`.
- Live-staging contract gate: wallet-bearing session exchange exercises ENS; a dead
  `ETHEREUM_RPC_URL` on staging times the gate out at 45s (looks like a flaky test,
  is not).
