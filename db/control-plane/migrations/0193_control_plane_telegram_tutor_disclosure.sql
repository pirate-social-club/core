-- Durable acknowledgement of the one-time AI-provider disclosure shown with a
-- study tutor answer.
--
-- Scoped to the learner and community rather than the chat study session. A
-- session is replaced whenever the learner opens the song picker, changes
-- language, opens settings, or starts a new song, so session grain makes the
-- disclosure recur constantly: one production tester accumulated eight sessions
-- in a day, two of them 32 seconds apart, and saw the disclosure again each
-- time. The community is part of the key because the disclosure names that
-- community's configured AI provider.
--
-- Claimed with INSERT ... ON CONFLICT DO NOTHING so the first writer wins
-- without a select-then-update race.

CREATE TABLE telegram_tutor_disclosure_acknowledgements (
    user_id TEXT NOT NULL,
    community_id TEXT NOT NULL,
    shown_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, community_id)
);
