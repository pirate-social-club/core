ALTER TABLE purchase_allocation_legs RENAME TO purchase_allocation_legs_old;

CREATE TABLE purchase_allocation_legs (
    purchase_allocation_leg_id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    community_id TEXT NOT NULL,
    recipient_type TEXT NOT NULL CHECK (
        recipient_type IN ('creator', 'performer', 'charity', 'community_treasury')
    ),
    recipient_ref TEXT,
    waterfall_position INTEGER NOT NULL CHECK (
        waterfall_position >= 0
    ),
    share_bps INTEGER NOT NULL CHECK (
        share_bps >= 0 AND share_bps <= 10000
    ),
    amount_usd REAL NOT NULL CHECK (
        amount_usd >= 0
    ),
    settlement_strategy TEXT NOT NULL CHECK (
        settlement_strategy IN ('story_payout', 'provider_payout', 'treasury_payout')
    ),
    status TEXT NOT NULL CHECK (
        status IN ('quoted', 'pending', 'confirmed', 'failed')
    ),
    settlement_ref TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    provider_receipt_ref TEXT,
    tax_receipt_ref TEXT,
    submitted_at TEXT,
    confirmed_at TEXT,
    failed_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id),
    FOREIGN KEY (quote_id) REFERENCES purchase_quotes(quote_id),
    FOREIGN KEY (community_id) REFERENCES communities(community_id)
);

INSERT INTO purchase_allocation_legs (
    purchase_allocation_leg_id, purchase_id, quote_id, community_id, recipient_type, recipient_ref,
    waterfall_position, share_bps, amount_usd, settlement_strategy, status, settlement_ref,
    failure_reason, created_at, updated_at, provider_receipt_ref, tax_receipt_ref,
    submitted_at, confirmed_at, failed_at, attempt_count
)
SELECT
    purchase_allocation_leg_id, purchase_id, quote_id, community_id, recipient_type, recipient_ref,
    waterfall_position, share_bps, amount_usd, settlement_strategy, status, settlement_ref,
    failure_reason, created_at, updated_at, provider_receipt_ref, tax_receipt_ref,
    submitted_at, confirmed_at, failed_at, attempt_count
FROM purchase_allocation_legs_old;

DROP TABLE purchase_allocation_legs_old;

CREATE INDEX idx_purchase_allocation_legs_purchase
    ON purchase_allocation_legs(purchase_id, waterfall_position ASC, created_at ASC);
