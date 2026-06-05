ALTER TABLE auth_provider_links
    ADD COLUMN transferred_from_user_id TEXT;

ALTER TABLE auth_provider_links
    ADD COLUMN transferred_to_user_id TEXT;

ALTER TABLE auth_provider_links
    ADD COLUMN transfer_intent_id TEXT;

ALTER TABLE auth_provider_links
    ADD COLUMN transferred_at TIMESTAMPTZ;

ALTER TABLE telegram_accounts
    ADD COLUMN transferred_from_user_id TEXT;

ALTER TABLE telegram_accounts
    ADD COLUMN transferred_to_user_id TEXT;

ALTER TABLE telegram_accounts
    ADD COLUMN transfer_intent_id TEXT;

ALTER TABLE telegram_accounts
    ADD COLUMN transferred_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS telegram_link_intents (
    telegram_link_intent_id TEXT PRIMARY KEY,
    community_id TEXT NOT NULL,
    telegram_community_bot_id TEXT NOT NULL,
    link_intent_token_hash TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    init_data_user_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'completing', 'completed', 'failed', 'expired', 'superseded', 'canceled')
    ),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    completing_started_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    superseded_by_intent_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (community_id) REFERENCES communities(community_id),
    FOREIGN KEY (telegram_community_bot_id) REFERENCES telegram_community_bots(telegram_community_bot_id),
    FOREIGN KEY (superseded_by_intent_id) REFERENCES telegram_link_intents(telegram_link_intent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_link_intents_token
    ON telegram_link_intents(link_intent_token_hash);

CREATE INDEX IF NOT EXISTS idx_telegram_link_intents_status_expiry
    ON telegram_link_intents(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_telegram_link_intents_supersession
    ON telegram_link_intents(telegram_user_id, community_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_link_intent_csrf_tokens (
    telegram_link_intent_csrf_token_id TEXT PRIMARY KEY,
    telegram_link_intent_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    csrf_token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (telegram_link_intent_id) REFERENCES telegram_link_intents(telegram_link_intent_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_link_intent_csrf_tokens_hash
    ON telegram_link_intent_csrf_tokens(csrf_token_hash);

CREATE INDEX IF NOT EXISTS idx_telegram_link_intent_csrf_tokens_lookup
    ON telegram_link_intent_csrf_tokens(telegram_link_intent_id, user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS account_link_audit_events (
    account_link_audit_event_id TEXT PRIMARY KEY,
    telegram_user_id TEXT NOT NULL,
    from_user_id TEXT,
    to_user_id TEXT,
    community_id TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN ('created', 'completed', 'superseded', 'expired', 'rejected', 'failed')
    ),
    reason TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (community_id) REFERENCES communities(community_id),
    FOREIGN KEY (intent_id) REFERENCES telegram_link_intents(telegram_link_intent_id)
);

CREATE INDEX IF NOT EXISTS idx_account_link_audit_events_telegram_user
    ON account_link_audit_events(telegram_user_id, created_at DESC);
