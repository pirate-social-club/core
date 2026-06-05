CREATE INDEX IF NOT EXISTS idx_telegram_link_intents_status_completing
    ON telegram_link_intents(status, completing_started_at)
    WHERE status = 'completing';
