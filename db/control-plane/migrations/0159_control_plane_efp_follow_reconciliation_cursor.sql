-- Deterministic keyset progress for bounded follow-count reconciliation.
-- Random sampling cannot prove eventual coverage and must not hold the shared
-- scheduled lease for an unbounded full-table scan.
CREATE TABLE efp_follow_reconciliation_cursors (
    reconciliation_key TEXT PRIMARY KEY
        CHECK (reconciliation_key = 'effective-counts'),
    next_wallet_address TEXT,
    completed_cycles BIGINT NOT NULL DEFAULT 0 CHECK (completed_cycles >= 0),
    last_completed_cycle_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT efp_follow_reconciliation_cursor_lowercase
        CHECK (
            next_wallet_address IS NULL
            OR next_wallet_address = lower(next_wallet_address)
        )
);

INSERT INTO efp_follow_reconciliation_cursors (
    reconciliation_key,
    next_wallet_address,
    completed_cycles,
    last_completed_cycle_at,
    updated_at
) VALUES (
    'effective-counts',
    NULL,
    0,
    NULL,
    CURRENT_TIMESTAMP
);
