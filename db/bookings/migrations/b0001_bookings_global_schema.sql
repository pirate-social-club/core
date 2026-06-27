-- Global bookings ledger: a bounded `bookings` schema in the shared Postgres cluster (NOT public/
-- "control plane"). Bookings are GLOBAL — communities are optional discovery/referral attribution
-- only (source_community_id, nullable, never a validity gate). This consolidates the host config
-- (was control-plane public.booking_*) and the lifecycle/settlement rows (were per-community D1) into
-- one transactional ledger so confirmation + lifecycle transitions are atomic.
--
-- Mechanics replace D1 workarounds with native Postgres: TIMESTAMPTZ / TIME / arrays / NUMERIC and
-- real constraints (not TEXT/GLOB). A btree_gist range-exclusion constraint enforces double-booking
-- protection in the database. State machines, idempotency keys, and CAS guards are preserved exactly.
-- FKs stay INSIDE this schema (no cross-schema FKs to users/communities) so the schema extracts to a
-- dedicated database cleanly and financial records survive user/community deletion.
-- Ledger: shared public.schema_migrations (globally-unique b0001_ name); a separate ledger is deferred
-- until bookings moves to its own database.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS bookings;

-- ---------------------------------------------------------------------------------------------------
-- Host configuration (host-global; no community)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE bookings.profiles (
    host_user_id                   TEXT PRIMARY KEY,                 -- global user id (no cross-schema FK)
    display_headline               TEXT,
    bio                            TEXT,
    topics                         JSONB,
    intro_video_ref                TEXT,
    host_timezone                  TEXT NOT NULL,
    base_price_cents               INTEGER NOT NULL CHECK (base_price_cents > 0),
    default_slot_duration_seconds  INTEGER NOT NULL CHECK (default_slot_duration_seconds > 0),
    platform_fee_bps               INTEGER NOT NULL DEFAULT 1000 CHECK (platform_fee_bps BETWEEN 0 AND 10000),
    payout_wallet_address          TEXT,
    is_published                   BOOLEAN NOT NULL DEFAULT false,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A weekday set is a SMALLINT[] of 0=Sun..6=Sat (replaces the JSON blob); local times are TIME.
CREATE TABLE bookings.availability_rules (
    rule_id                 TEXT PRIMARY KEY,
    host_user_id            TEXT NOT NULL REFERENCES bookings.profiles(host_user_id) ON DELETE CASCADE,
    by_weekday              SMALLINT[] NOT NULL CHECK (array_length(by_weekday, 1) >= 1 AND by_weekday <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
    start_local             TIME NOT NULL,
    end_local               TIME NOT NULL CHECK (end_local > start_local),
    slot_duration_seconds   INTEGER NOT NULL CHECK (slot_duration_seconds > 0),
    effective_from_utc      TIMESTAMPTZ,
    effective_until_utc     TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_availability_rules_host ON bookings.availability_rules(host_user_id);

CREATE TABLE bookings.availability_exceptions (
    exception_id   TEXT PRIMARY KEY,
    host_user_id   TEXT NOT NULL REFERENCES bookings.profiles(host_user_id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('block', 'open')),
    start_utc      TIMESTAMPTZ NOT NULL,
    end_utc        TIMESTAMPTZ NOT NULL CHECK (end_utc > start_utc),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_availability_exceptions_host ON bookings.availability_exceptions(host_user_id, start_utc);

CREATE TABLE bookings.price_rules (
    price_rule_id           TEXT PRIMARY KEY,
    host_user_id            TEXT NOT NULL REFERENCES bookings.profiles(host_user_id) ON DELETE CASCADE,
    match_weekday           SMALLINT[] CHECK (match_weekday IS NULL OR match_weekday <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
    match_local_start       TIME,
    match_local_end         TIME,
    match_duration_seconds  INTEGER CHECK (match_duration_seconds IS NULL OR match_duration_seconds > 0),
    price_cents             INTEGER NOT NULL CHECK (price_cents > 0),
    priority                INTEGER NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_price_rules_host ON bookings.price_rules(host_user_id, priority DESC);

-- ---------------------------------------------------------------------------------------------------
-- Coordination: global per-host slot locks. Double-booking is enforced by the DATABASE: at most one
-- ACTIVE lock may overlap a given [start,end) range per host. source_community_id is attribution only.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE bookings.host_slot_locks (
    lock_id              TEXT PRIMARY KEY,
    host_user_id         TEXT NOT NULL REFERENCES bookings.profiles(host_user_id) ON DELETE CASCADE,
    slot_start_utc       TIMESTAMPTZ NOT NULL,
    slot_end_utc         TIMESTAMPTZ NOT NULL CHECK (slot_end_utc > slot_start_utc),
    hold_id              TEXT,
    booking_id           TEXT,
    status               TEXT NOT NULL CHECK (status IN ('active', 'released')),
    source_community_id  TEXT,            -- nullable discovery/referral attribution; never a validity gate
    expires_at_utc       TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- DB-enforced no-overlap for ACTIVE locks per host (btree_gist): supersedes the old advisory
    -- unique-on-start index and protects against partial-overlap races the start-only index missed.
    CONSTRAINT bookings_host_slot_locks_no_overlap
        EXCLUDE USING gist (
            host_user_id WITH =,
            tstzrange(slot_start_utc, slot_end_utc, '[)') WITH &&
        ) WHERE (status = 'active')
);
CREATE INDEX idx_bookings_host_slot_locks_expiry ON bookings.host_slot_locks(status, expires_at_utc);
CREATE INDEX idx_bookings_host_slot_locks_hold ON bookings.host_slot_locks(hold_id);
CREATE INDEX idx_bookings_host_slot_locks_booking ON bookings.host_slot_locks(booking_id);

-- ---------------------------------------------------------------------------------------------------
-- Lifecycle: holds
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE bookings.holds (
    hold_id              TEXT PRIMARY KEY,
    host_user_id         TEXT NOT NULL,
    booker_user_id       TEXT NOT NULL,
    slot_start_utc       TIMESTAMPTZ NOT NULL,
    slot_end_utc         TIMESTAMPTZ NOT NULL CHECK (slot_end_utc > slot_start_utc),
    price_cents          INTEGER NOT NULL CHECK (price_cents > 0),
    status               TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'expired')),
    source_community_id  TEXT,            -- nullable attribution captured at hold creation
    expires_at_utc       TIMESTAMPTZ NOT NULL CHECK (expires_at_utc > created_at),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_holds_expiry ON bookings.holds(status, expires_at_utc);
CREATE INDEX idx_bookings_holds_host ON bookings.holds(host_user_id, slot_start_utc);
CREATE INDEX idx_bookings_holds_booker ON bookings.holds(booker_user_id, slot_start_utc);

-- ---------------------------------------------------------------------------------------------------
-- Lifecycle: bookings (the financial record). source_community_id is copied from the hold at
-- confirmation and is IMMUTABLE attribution (the confirm path never re-accepts it). Legacy
-- quote_id/purchase_id dropped. live_room_id retained for the 1:1 session.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE bookings.bookings (
    booking_id                TEXT PRIMARY KEY,
    hold_id                   TEXT REFERENCES bookings.holds(hold_id),
    host_user_id              TEXT NOT NULL,
    booker_user_id            TEXT NOT NULL,
    slot_start_utc            TIMESTAMPTZ NOT NULL,
    slot_end_utc              TIMESTAMPTZ NOT NULL CHECK (slot_end_utc > slot_start_utc),
    gross_cents               INTEGER NOT NULL CHECK (gross_cents > 0),
    platform_fee_bps          INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 0 AND 10000),
    platform_fee_cents        INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
    host_payout_cents         INTEGER NOT NULL CHECK (host_payout_cents >= 0),
    refund_cents              INTEGER CHECK (refund_cents IS NULL OR (refund_cents >= 0 AND refund_cents <= gross_cents)),
    status                    TEXT NOT NULL CHECK (status IN (
        'hold', 'quoted', 'pending_payment', 'confirmed', 'live', 'completed', 'settled',
        'expired_hold', 'cancelled_before_payment', 'cancelled_by_host', 'cancelled_by_booker',
        'no_show_host', 'no_show_booker', 'refunded', 'disputed'
    )),
    funding_tx_ref            TEXT,        -- verified on-chain pay-in (custody-in)
    payout_tx_ref             TEXT,        -- operator payout to host (custody-out)
    refund_tx_ref             TEXT,        -- operator refund to booker (custody-out)
    funding_wallet_address    TEXT,        -- verified payer (refund destination snapshot)
    host_payout_wallet_address TEXT,       -- host payout destination snapshot
    live_room_id              TEXT,
    source_community_id       TEXT,        -- nullable, immutable attribution copied from the hold
    confirmed_at              TIMESTAMPTZ,
    completed_at              TIMESTAMPTZ,
    settled_at                TIMESTAMPTZ,
    cancelled_at              TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- money snapshot must balance (matches computeAllocation: hostPayout = gross - platformFee)
    CONSTRAINT bookings_money_balances CHECK (platform_fee_cents + host_payout_cents = gross_cents)
);
-- One booking per hold; one ACTIVE-slot booking per host; defensive funding-tx uniqueness.
CREATE UNIQUE INDEX idx_bookings_hold ON bookings.bookings(hold_id) WHERE hold_id IS NOT NULL;
CREATE UNIQUE INDEX idx_bookings_active_slot ON bookings.bookings(host_user_id, slot_start_utc)
    WHERE status IN ('pending_payment', 'confirmed', 'live', 'completed', 'settled');
CREATE UNIQUE INDEX idx_bookings_funding_tx ON bookings.bookings(funding_tx_ref) WHERE funding_tx_ref IS NOT NULL;
-- Global access patterns (host/booker/time/status) — no community-leading indexes.
CREATE INDEX idx_bookings_host ON bookings.bookings(host_user_id, slot_start_utc);
CREATE INDEX idx_bookings_booker ON bookings.bookings(booker_user_id, slot_start_utc);
CREATE INDEX idx_bookings_status ON bookings.bookings(status);
CREATE INDEX idx_bookings_host_status ON bookings.bookings(host_user_id, status);

-- ---------------------------------------------------------------------------------------------------
-- Lifecycle: payment intents (amount_atomic is NUMERIC — exact uint256-scale, not a TEXT/GLOB string).
-- One intent per hold (deterministic id); reused-tx protection via UNIQUE(claimed_tx_ref).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE bookings.payment_intents (
    payment_intent_id              TEXT PRIMARY KEY,
    hold_id                        TEXT NOT NULL REFERENCES bookings.holds(hold_id),
    version                        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    chain_id                       INTEGER NOT NULL CHECK (chain_id > 0),
    token_address                  TEXT NOT NULL,
    token_decimals                 INTEGER NOT NULL CHECK (token_decimals BETWEEN 0 AND 36),
    token_symbol                   TEXT NOT NULL,
    recipient_address              TEXT NOT NULL,
    amount_atomic                  NUMERIC(78,0) NOT NULL CHECK (amount_atomic > 0),
    gross_cents                    INTEGER NOT NULL CHECK (gross_cents > 0),
    quote_expires_at               TIMESTAMPTZ NOT NULL,
    hold_expires_at                TIMESTAMPTZ NOT NULL,
    wallet_attachment_required     BOOLEAN NOT NULL DEFAULT true,
    platform_fee_bps               INTEGER,
    platform_fee_cents             INTEGER,
    host_payout_cents              INTEGER,
    status                         TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'verifying', 'verified', 'verification_failed', 'verification_rejected',
        'consumed', 'expired', 'superseded'
    )),
    verification_claim_token       TEXT,
    verification_claim_expires_at  TIMESTAMPTZ,
    claimed_tx_ref                 TEXT,
    verified_sender_address        TEXT,
    verified_at                    TIMESTAMPTZ,
    consumed_wallet_attachment_id  TEXT,
    consumed_at                    TIMESTAMPTZ,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_bookings_payment_intents_hold ON bookings.payment_intents(hold_id);
CREATE UNIQUE INDEX idx_bookings_payment_intents_claimed_tx ON bookings.payment_intents(claimed_tx_ref);

-- ---------------------------------------------------------------------------------------------------
-- Session attendance. Heartbeats keep booking_id but a composite FK enforces it matches the session.
-- (High-frequency heartbeats are expected to be coalesced by a per-booking Durable Object writing
-- durable summaries here, rather than one INSERT per 15-30s.)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE bookings.attendance_sessions (
    session_id    TEXT PRIMARY KEY,
    booking_id    TEXT NOT NULL REFERENCES bookings.bookings(booking_id),
    party         TEXT NOT NULL CHECK (party IN ('host', 'booker')),
    user_id       TEXT NOT NULL,
    agora_uid     INTEGER,
    attached_at   TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, booking_id)   -- enables the composite FK from heartbeats
);
CREATE INDEX idx_bookings_attendance_sessions_booking ON bookings.attendance_sessions(booking_id);

CREATE TABLE bookings.attendance_heartbeats (
    heartbeat_id  TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    booking_id    TEXT NOT NULL,
    seen_at       TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (session_id, booking_id) REFERENCES bookings.attendance_sessions(session_id, booking_id)
);
CREATE INDEX idx_bookings_attendance_heartbeats_session ON bookings.attendance_heartbeats(session_id, seen_at);

-- ---------------------------------------------------------------------------------------------------
-- Settlement effects (operator payout/refund). UNIQUE(idempotency_key) is the existing idempotency
-- guard; UNIQUE(booking_id, effect_kind) is defensive (at most one payout and one refund per booking).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE bookings.settlement_effects (
    booking_settlement_effect_id  TEXT PRIMARY KEY,
    booking_id                    TEXT NOT NULL REFERENCES bookings.bookings(booking_id),
    effect_kind                   TEXT NOT NULL CHECK (effect_kind IN ('booking_payout', 'booking_refund')),
    idempotency_key               TEXT NOT NULL,
    status                        TEXT NOT NULL CHECK (status IN ('submitted', 'confirmed', 'failed')),
    amount_cents                  INTEGER NOT NULL CHECK (amount_cents >= 0),
    recipient_address             TEXT NOT NULL,
    settlement_ref                TEXT,            -- on-chain tx hash once confirmed
    failure_reason                TEXT,
    attempt_count                 INTEGER NOT NULL DEFAULT 0,
    signed_tx                     TEXT,
    broadcast_nonce               INTEGER,
    coordinator_ref               TEXT,
    coordinator_state             TEXT,
    submitted_at                  TIMESTAMPTZ,
    confirmed_at                  TIMESTAMPTZ,
    failed_at                     TIMESTAMPTZ,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_bookings_settlement_effects_idem ON bookings.settlement_effects(idempotency_key);
CREATE UNIQUE INDEX idx_bookings_settlement_effects_booking_kind ON bookings.settlement_effects(booking_id, effect_kind);
CREATE INDEX idx_bookings_settlement_effects_status ON bookings.settlement_effects(status, updated_at);

-- ---------------------------------------------------------------------------------------------------
-- Grants: migrator owns/creates; runtime rw reads+writes; read-only role reads. Queries stay
-- schema-qualified (bookings.*); no role relies on search_path.
-- ---------------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA bookings TO control_plane_api_rw, control_plane_api_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bookings TO control_plane_api_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA bookings TO control_plane_api_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA bookings GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO control_plane_api_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA bookings GRANT SELECT ON TABLES TO control_plane_api_ro;
