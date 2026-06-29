-- Spend intents: the Telegram-conversation-first funding-acquisition lifecycle.
--
-- An intent is born in the bot dialogue (Telegram identity is the only thing known up front),
-- then progressively resolves a requested item, shows a priced confirmation, takes a wallet
-- approval, and tracks async cross-chain funding until a canonical Base USDC receipt exists.
-- It lives in control-plane (not a community DB) because its early lifecycle precedes any
-- community/listing resolution. Once funding_receipt_tx_ref exists and the target is resolved,
-- the existing per-community settlement path (purchase_settlement_effects, purchases) remains
-- the community-local source of truth. There is intentionally no purchase_quotes FK here
-- (that table is community-local) and quote_id is carried as an opaque resolved reference.

CREATE TABLE spend_intents (
    spend_intent_id TEXT PRIMARY KEY,

    -- Conversation phase: known the moment the bot dialogue starts.
    telegram_user_id TEXT NOT NULL,
    user_id TEXT,
    bot_session_ref TEXT,

    -- Resolution phase: null until the server resolves the requested item.
    community_id TEXT,
    listing_id TEXT,
    asset_id TEXT,
    quote_id TEXT,
    purchase_id TEXT,

    -- Confirmation phase: populated when the priced confirmation is shown or approved.
    buyer_address TEXT,
    -- ton_testnet_transfer is a dev-only provider for the TON Connect approval/UX loop. It is
    -- never a canonical funding receipt (real funding is confirmed only from a Base USDC txRef).
    funding_source_provider TEXT CHECK (
        funding_source_provider IS NULL
        OR funding_source_provider IN ('pirate_checkout', 'omniston_ton', 'ton_testnet_transfer')
    ),
    funding_source_quote_hash TEXT,
    checkout_quote_hash TEXT,
    -- Cross-chain funding can land after the checkout quote TTL. This reservation window, not
    -- the quote TTL, governs whether a late receipt settles or routes to refund.
    price_reservation_expires_at TIMESTAMPTZ,

    -- Funding phase correlation.
    -- Omniston route/order id. May exist before or without a TON tx, so it is a durable handle
    -- for reconciling pending/failed cross-chain funding. Audit only, never trusted.
    funding_route_ref TEXT,
    -- Originating leg such as a TON tx or message hash. Audit and refund only, never trusted.
    funding_source_tx_ref TEXT,
    -- Canonical Base USDC tx. Bound exactly once. Global-unique guards cross-intent double-bind.
    funding_receipt_tx_ref TEXT,

    -- funding_confirming/funding_confirmed are the terminal states for this funding path: the
    -- Base USDC receipt is verified + recorded. settled is RESERVED for full purchase completion
    -- (Story royalty payment, entitlement mint, purchase rows) wired in a later slice. Do not
    -- treat funding_confirmed as purchase-complete / asset-unlocked.
    status TEXT NOT NULL CHECK (
        status IN (
            'proposed', 'approved', 'funding_pending', 'funded',
            'funding_confirming', 'funding_confirmed', 'settled', 'failed', 'refundable'
        )
    ),
    failure_reason TEXT,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    -- community_id resolves before settlement. The nullable FK matches existing control-plane
    -- convention (cf. 0117 community_database_routing.turso_database_binding_id).
    FOREIGN KEY (community_id) REFERENCES communities(community_id),

    -- Once funds are bound (funded) or confirming/confirmed/settled, the canonical Base receipt
    -- must exist. The refundable status is exempt: a late receipt is bound but routed to refund.
    CONSTRAINT chk_spend_intents_funded_has_receipt CHECK (
        status NOT IN ('funded', 'funding_confirming', 'funding_confirmed', 'settled')
        OR funding_receipt_tx_ref IS NOT NULL
    )
);

-- Exactly-once invariants relied on by the acquisition state machine.
CREATE UNIQUE INDEX idx_spend_intents_idempotency
    ON spend_intents(idempotency_key);

-- A given Base USDC tx may fund at most one intent. NULLs are distinct (both SQLite and
-- Postgres), so many intents may sit pre-receipt with no binding yet.
CREATE UNIQUE INDEX idx_spend_intents_funding_receipt
    ON spend_intents(funding_receipt_tx_ref);

-- Bot UX lists a Telegram user open intents. Poller scans by provider and status. Correlation
-- looks up by originating source tx.
CREATE INDEX idx_spend_intents_telegram_user
    ON spend_intents(telegram_user_id, status);

CREATE INDEX idx_spend_intents_provider_status
    ON spend_intents(funding_source_provider, status);

CREATE INDEX idx_spend_intents_source_tx
    ON spend_intents(funding_source_tx_ref);

-- Reconcile cross-chain funding by Omniston route/order id.
CREATE INDEX idx_spend_intents_route_ref
    ON spend_intents(funding_route_ref);
