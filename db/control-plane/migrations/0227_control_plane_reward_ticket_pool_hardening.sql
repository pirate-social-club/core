-- Harden the shared ticket-pool control plane before any runtime purchase.
-- Migration 0224 established the model; this migration closes the audit gaps
-- that can be enforced at the PostgreSQL boundary.

-- migration-safety: existing-table-check-reviewed: the ticket-pool runtime is unimplemented and has produced no commitment rows; the constraints are fail-closed before first use
ALTER TABLE reward_ticket_beneficiary_commitment_batches
    ADD CONSTRAINT reward_ticket_commitment_batches_publication_kind_check
        CHECK (publication_kind IN ('onchain', 'public_append_only_log')),
    ADD CONSTRAINT reward_ticket_commitment_batches_published_evidence_check CHECK (
        status <> 'published' OR (
            published_at IS NOT NULL
            AND publication_reference IS NOT NULL
            AND BTRIM(publication_reference) <> ''
            AND (
                publication_kind <> 'onchain'
                OR (publication_tx_hash IS NOT NULL AND publication_block_number IS NOT NULL)
            )
        )
    ),
    ADD CONSTRAINT reward_ticket_commitment_batches_drawing_identity_unique
        UNIQUE (
            reward_ticket_beneficiary_commitment_batch_id,
            chain_id,
            jackpot_address,
            drawing_id
        );

-- migration-safety: existing-table-check-reviewed: both completeness timestamps are newly nullable, so every pre-migration drawing satisfies the ordering constraint
ALTER TABLE reward_ticket_pool_drawings
    ADD COLUMN inventory_complete_at TIMESTAMPTZ,
    ADD COLUMN sweep_complete_at TIMESTAMPTZ,
    ADD CONSTRAINT reward_ticket_pool_drawings_identity_unique
        UNIQUE (reward_ticket_pool_drawing_id, chain_id, drawing_id),
    ADD CONSTRAINT reward_ticket_pool_drawings_commitment_identity_fk
        FOREIGN KEY (commitment_batch_id, chain_id, jackpot_address, drawing_id)
        REFERENCES reward_ticket_beneficiary_commitment_batches (
            reward_ticket_beneficiary_commitment_batch_id,
            chain_id,
            jackpot_address,
            drawing_id
        ),
    ADD CONSTRAINT reward_ticket_pool_drawings_sweep_order_check CHECK (
        sweep_complete_at IS NULL OR (
            inventory_complete_at IS NOT NULL AND sweep_complete_at >= inventory_complete_at
        )
    );

ALTER TABLE reward_ticket_inventory
    ADD COLUMN protocol_drawing_id NUMERIC(78, 0);

UPDATE reward_ticket_inventory AS inventory
SET protocol_drawing_id = drawing.drawing_id
FROM reward_ticket_pool_drawings AS drawing
WHERE drawing.reward_ticket_pool_drawing_id = inventory.reward_ticket_pool_drawing_id;

ALTER TABLE reward_ticket_inventory
    ALTER COLUMN protocol_drawing_id SET NOT NULL,
    ADD CONSTRAINT reward_ticket_inventory_protocol_drawing_check
        CHECK (protocol_drawing_id >= 0),
    ADD CONSTRAINT reward_ticket_inventory_expected_drawing_fk
        FOREIGN KEY (reward_ticket_pool_drawing_id, chain_id, protocol_drawing_id)
        REFERENCES reward_ticket_pool_drawings (
            reward_ticket_pool_drawing_id,
            chain_id,
            drawing_id
        );

ALTER TABLE reward_ticket_claim_effects
    ADD COLUMN finalized_at TIMESTAMPTZ;

UPDATE reward_ticket_claim_effects
SET finalized_at = confirmed_at
WHERE status = 'confirmed' AND finalized_at IS NULL;

ALTER TABLE reward_ticket_claim_effects
    ADD CONSTRAINT reward_ticket_claim_effects_finalized_shape_check CHECK (
        status <> 'confirmed' OR finalized_at IS NOT NULL
    );

-- v1 deliberately has one custody backing domain for each exact USDC asset.
-- Rotation requires a reviewed migration rather than silently mixing balances
-- backed by different wallets under one user-visible liability class.
CREATE TABLE reward_ticket_custody_backing_domains (
    chain_id INTEGER NOT NULL CHECK (chain_id > 0),
    token_address TEXT NOT NULL CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
    custody_address TEXT NOT NULL CHECK (custody_address ~ '^0x[0-9a-fA-F]{40}$'),
    status TEXT NOT NULL CHECK (status IN ('active', 'operational_hold', 'retired')),
    terms_hash TEXT NOT NULL CHECK (terms_hash ~ '^[0-9a-f]{64}$'),
    activated_at TIMESTAMPTZ,
    operational_held_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, token_address),
    UNIQUE (chain_id, token_address, custody_address),
    CONSTRAINT reward_ticket_custody_backing_domains_status_shape_check CHECK (
        (status = 'active' AND activated_at IS NOT NULL)
        OR (status = 'operational_hold' AND operational_held_at IS NOT NULL)
        OR (status = 'retired' AND retired_at IS NOT NULL)
    )
);

-- The runtime is not built and there should be no pool rows. This backfill is
-- intentionally fail-closed if an environment nevertheless contains two
-- custody addresses for the same asset.
INSERT INTO reward_ticket_custody_backing_domains (
    chain_id, token_address, custody_address, status, terms_hash, activated_at
)
SELECT DISTINCT
    chain_id, usdc_token_address, custody_address, 'active', terms_hash, created_at
FROM reward_ticket_pools;

ALTER TABLE reward_ticket_pools
    ADD CONSTRAINT reward_ticket_pools_custody_backing_domain_fk
        FOREIGN KEY (chain_id, usdc_token_address, custody_address)
        REFERENCES reward_ticket_custody_backing_domains (
            chain_id, token_address, custody_address
        );

ALTER TABLE reward_ticket_custody_solvency_observations
    ADD CONSTRAINT reward_ticket_custody_solvency_backing_domain_fk
        FOREIGN KEY (chain_id, token_address, custody_address)
        REFERENCES reward_ticket_custody_backing_domains (
            chain_id, token_address, custody_address
        );

-- A cashout is an external money effect, not merely a pair of mutable ledger
-- rows. It receives the same ambiguity/reconciliation shape as purchases and
-- claims, and confirmation records a canonical finalized receipt.
CREATE TABLE reward_ticket_cashout_effects (
    reward_ticket_cashout_effect_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    chain_id INTEGER NOT NULL CHECK (chain_id > 0),
    token_address TEXT NOT NULL CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
    custody_address TEXT NOT NULL CHECK (custody_address ~ '^0x[0-9a-fA-F]{40}$'),
    destination_address TEXT NOT NULL CHECK (destination_address ~ '^0x[0-9a-fA-F]{40}$'),
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN (
        'reserved', 'submitted', 'confirmed', 'released', 'failed', 'needs_review'
    )),
    amount_atomic NUMERIC(78, 0) NOT NULL CHECK (amount_atomic > 0),
    tx_hash TEXT CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
    submitted_block_number BIGINT CHECK (
        submitted_block_number IS NULL OR submitted_block_number >= 0
    ),
    confirmed_block_number BIGINT CHECK (
        confirmed_block_number IS NULL OR confirmed_block_number >= 0
    ),
    confirmed_block_hash TEXT CHECK (
        confirmed_block_hash IS NULL OR confirmed_block_hash ~ '^0x[0-9a-fA-F]{64}$'
    ),
    lease_token TEXT,
    lease_expires_at TIMESTAMPTZ,
    review_deadline_at TIMESTAMPTZ,
    next_reconciliation_at TIMESTAMPTZ,
    reconciliation_attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (reconciliation_attempt_count >= 0),
    failure_reason TEXT,
    submitted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    finalized_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id, chain_id, token_address)
        REFERENCES reward_ticket_usdc_balances(user_id, chain_id, token_address),
    FOREIGN KEY (chain_id, token_address, custody_address)
        REFERENCES reward_ticket_custody_backing_domains (
            chain_id, token_address, custody_address
        ),
    CONSTRAINT reward_ticket_cashout_effects_lease_shape_check
        CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
    CONSTRAINT reward_ticket_cashout_effects_submitted_shape_check CHECK (
        status <> 'submitted' OR (tx_hash IS NOT NULL AND submitted_at IS NOT NULL)
    ),
    CONSTRAINT reward_ticket_cashout_effects_confirmed_shape_check CHECK (
        status <> 'confirmed' OR (
            tx_hash IS NOT NULL
            AND confirmed_block_number IS NOT NULL
            AND confirmed_block_hash IS NOT NULL
            AND confirmed_at IS NOT NULL
            AND finalized_at IS NOT NULL
        )
    ),
    CONSTRAINT reward_ticket_cashout_effects_released_shape_check
        CHECK (status <> 'released' OR released_at IS NOT NULL),
    CONSTRAINT reward_ticket_cashout_effects_failed_shape_check
        CHECK (status <> 'failed' OR failed_at IS NOT NULL),
    CONSTRAINT reward_ticket_cashout_effects_review_shape_check CHECK (
        status <> 'needs_review' OR (
            review_deadline_at IS NOT NULL AND next_reconciliation_at IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX reward_ticket_cashout_effects_tx_unique
    ON reward_ticket_cashout_effects (chain_id, tx_hash)
    WHERE tx_hash IS NOT NULL;

CREATE INDEX reward_ticket_cashout_effects_work_idx
    ON reward_ticket_cashout_effects (
        status, next_reconciliation_at, lease_expires_at, reward_ticket_cashout_effect_id
    );

-- migration-safety: existing-table-check-reviewed: the ticket-pool runtime is unimplemented and has produced no ledger rows; every first cashout entry must bind its effect
ALTER TABLE reward_ticket_usdc_ledger_entries
    ADD COLUMN reward_ticket_cashout_effect_id TEXT
        REFERENCES reward_ticket_cashout_effects(reward_ticket_cashout_effect_id),
    ADD CONSTRAINT reward_ticket_usdc_ledger_cashout_source_check CHECK (
        (entry_kind = 'pool_allocation_credit' AND reward_ticket_cashout_effect_id IS NULL)
        OR (
            entry_kind IN ('cashout_reservation', 'cashout_release', 'cashout_payment')
            AND reward_ticket_cashout_effect_id IS NOT NULL
        )
    );

CREATE UNIQUE INDEX reward_ticket_usdc_ledger_cashout_kind_unique
    ON reward_ticket_usdc_ledger_entries (reward_ticket_cashout_effect_id, entry_kind)
    WHERE reward_ticket_cashout_effect_id IS NOT NULL;

-- Zero allocations are required when proceeds are smaller than the frozen
-- beneficiary count. They do not create ledger credits, but they preserve the
-- complete deterministic allocation proof.
-- migration-safety: existing-table-check-reviewed: changing amount_atomic from positive to nonnegative widens the accepted set, so every existing row remains valid
ALTER TABLE reward_ticket_allocations
    DROP CONSTRAINT reward_ticket_allocations_amount_atomic_check,
    ADD CONSTRAINT reward_ticket_allocations_amount_atomic_check CHECK (amount_atomic >= 0);

CREATE OR REPLACE FUNCTION apply_reward_ticket_usdc_ledger_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    available_atomic NUMERIC(78, 0);
    cashout reward_ticket_cashout_effects%ROWTYPE;
BEGIN
    INSERT INTO reward_ticket_usdc_balances (user_id, chain_id, token_address)
    VALUES (NEW.user_id, NEW.chain_id, NEW.token_address)
    ON CONFLICT (user_id, chain_id, token_address) DO NOTHING;

    SELECT credited_atomic - cashout_reserved_atomic - paid_atomic
    INTO available_atomic
    FROM reward_ticket_usdc_balances
    WHERE user_id = NEW.user_id
      AND chain_id = NEW.chain_id
      AND token_address = NEW.token_address
    FOR UPDATE;

    IF NEW.entry_kind = 'pool_allocation_credit' THEN
        IF NEW.amount_atomic <= 0 OR NOT EXISTS (
            SELECT 1
            FROM reward_ticket_allocations AS allocation
            JOIN reward_ticket_allocation_batches AS batch
              ON batch.reward_ticket_allocation_batch_id = allocation.reward_ticket_allocation_batch_id
            JOIN reward_ticket_pool_drawings AS drawing
              ON drawing.reward_ticket_pool_drawing_id = batch.reward_ticket_pool_drawing_id
            JOIN reward_ticket_pools AS pool
              ON pool.reward_ticket_pool_id = drawing.reward_ticket_pool_id
            WHERE allocation.reward_ticket_allocation_id = NEW.reward_ticket_allocation_id
              AND allocation.user_id = NEW.user_id
              AND allocation.amount_atomic = NEW.amount_atomic
              AND batch.status = 'credited'
              AND pool.chain_id = NEW.chain_id
              AND pool.usdc_token_address = NEW.token_address
        ) THEN
            RAISE EXCEPTION 'ticket-pool credit does not match a finalized allocation'
                USING ERRCODE = '23514';
        END IF;

        UPDATE reward_ticket_usdc_balances
        SET credited_atomic = credited_atomic + NEW.amount_atomic,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND chain_id = NEW.chain_id
          AND token_address = NEW.token_address;
        RETURN NEW;
    END IF;

    SELECT * INTO cashout
    FROM reward_ticket_cashout_effects
    WHERE reward_ticket_cashout_effect_id = NEW.reward_ticket_cashout_effect_id
    FOR UPDATE;

    IF NOT FOUND
       OR cashout.user_id <> NEW.user_id
       OR cashout.chain_id <> NEW.chain_id
       OR cashout.token_address <> NEW.token_address
       OR cashout.amount_atomic <> NEW.amount_atomic THEN
        RAISE EXCEPTION 'cashout ledger entry does not match its effect'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.entry_kind = 'cashout_reservation' THEN
        IF cashout.status <> 'reserved' OR available_atomic < NEW.amount_atomic THEN
            RAISE EXCEPTION 'cashout reservation is not funded or not reservable'
                USING ERRCODE = '23514';
        END IF;
        UPDATE reward_ticket_usdc_balances
        SET cashout_reserved_atomic = cashout_reserved_atomic + NEW.amount_atomic,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND chain_id = NEW.chain_id
          AND token_address = NEW.token_address;
    ELSIF NEW.entry_kind = 'cashout_release' THEN
        IF cashout.status NOT IN ('released', 'failed') THEN
            RAISE EXCEPTION 'cashout release requires a released or failed effect'
                USING ERRCODE = '23514';
        END IF;
        UPDATE reward_ticket_usdc_balances
        SET cashout_reserved_atomic = cashout_reserved_atomic - NEW.amount_atomic,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND chain_id = NEW.chain_id
          AND token_address = NEW.token_address
          AND cashout_reserved_atomic >= NEW.amount_atomic;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cashout release exceeds reserved balance'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.entry_kind = 'cashout_payment' THEN
        IF cashout.status <> 'confirmed' OR cashout.finalized_at IS NULL THEN
            RAISE EXCEPTION 'cashout payment requires a finalized confirmed effect'
                USING ERRCODE = '23514';
        END IF;
        UPDATE reward_ticket_usdc_balances
        SET cashout_reserved_atomic = cashout_reserved_atomic - NEW.amount_atomic,
            paid_atomic = paid_atomic + NEW.amount_atomic,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND chain_id = NEW.chain_id
          AND token_address = NEW.token_address
          AND cashout_reserved_atomic >= NEW.amount_atomic;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'cashout payment exceeds reserved balance'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER reward_ticket_usdc_ledger_apply
BEFORE INSERT ON reward_ticket_usdc_ledger_entries
FOR EACH ROW EXECUTE FUNCTION apply_reward_ticket_usdc_ledger_entry();

CREATE OR REPLACE FUNCTION enforce_reward_ticket_allocation_batch_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    batch_id TEXT;
    batch_row reward_ticket_allocation_batches%ROWTYPE;
    drawing_row reward_ticket_pool_drawings%ROWTYPE;
    inventory_count BIGINT;
    nonterminal_inventory_count BIGINT;
    allocation_count BIGINT;
    allocation_sum NUMERIC(78, 0);
    claim_sum NUMERIC(78, 0);
    quotient NUMERIC(78, 0);
    remainder NUMERIC(78, 0);
BEGIN
    IF TG_TABLE_NAME = 'reward_ticket_allocation_batches' THEN
        batch_id := COALESCE(NEW.reward_ticket_allocation_batch_id, OLD.reward_ticket_allocation_batch_id);
    ELSIF TG_TABLE_NAME = 'reward_ticket_allocations' THEN
        batch_id := COALESCE(NEW.reward_ticket_allocation_batch_id, OLD.reward_ticket_allocation_batch_id);
    ELSE
        batch_id := COALESCE(NEW.reward_ticket_allocation_batch_id, OLD.reward_ticket_allocation_batch_id);
    END IF;

    SELECT * INTO batch_row
    FROM reward_ticket_allocation_batches
    WHERE reward_ticket_allocation_batch_id = batch_id;

    IF NOT FOUND OR batch_row.status <> 'credited' THEN
        RETURN NULL;
    END IF;

    SELECT * INTO STRICT drawing_row
    FROM reward_ticket_pool_drawings
    WHERE reward_ticket_pool_drawing_id = batch_row.reward_ticket_pool_drawing_id;

    IF drawing_row.inventory_complete_at IS NULL OR drawing_row.sweep_complete_at IS NULL THEN
        RAISE EXCEPTION 'credited allocation requires completed inventory and sweep'
            USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE status NOT IN ('no_win', 'claimed'))
    INTO inventory_count, nonterminal_inventory_count
    FROM reward_ticket_inventory
    WHERE reward_ticket_pool_drawing_id = drawing_row.reward_ticket_pool_drawing_id;

    IF inventory_count <> drawing_row.ticket_count OR nonterminal_inventory_count <> 0 THEN
        RAISE EXCEPTION 'credited allocation requires complete terminal inventory'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM reward_ticket_inventory AS inventory
        WHERE inventory.reward_ticket_pool_drawing_id = drawing_row.reward_ticket_pool_drawing_id
          AND inventory.status = 'claimed'
          AND NOT EXISTS (
              SELECT 1
              FROM reward_ticket_claim_tickets AS claim_ticket
              JOIN reward_ticket_claim_effects AS claim_effect
                ON claim_effect.reward_ticket_claim_effect_id = claim_ticket.reward_ticket_claim_effect_id
              JOIN reward_ticket_allocation_batch_claims AS batch_claim
                ON batch_claim.reward_ticket_claim_effect_id = claim_effect.reward_ticket_claim_effect_id
              WHERE claim_ticket.reward_ticket_inventory_id = inventory.reward_ticket_inventory_id
                AND batch_claim.reward_ticket_allocation_batch_id = batch_id
                AND claim_effect.reward_ticket_pool_drawing_id = drawing_row.reward_ticket_pool_drawing_id
                AND claim_effect.status = 'confirmed'
                AND claim_effect.finalized_at IS NOT NULL
          )
    ) OR EXISTS (
        SELECT 1
        FROM reward_ticket_claim_effects AS claim_effect
        WHERE claim_effect.reward_ticket_pool_drawing_id = drawing_row.reward_ticket_pool_drawing_id
          AND claim_effect.status = 'confirmed'
          AND NOT EXISTS (
              SELECT 1
              FROM reward_ticket_allocation_batch_claims AS batch_claim
              WHERE batch_claim.reward_ticket_allocation_batch_id = batch_id
                AND batch_claim.reward_ticket_claim_effect_id = claim_effect.reward_ticket_claim_effect_id
          )
    ) OR EXISTS (
        SELECT 1
        FROM reward_ticket_allocation_batch_claims AS batch_claim
        JOIN reward_ticket_claim_effects AS claim_effect
          ON claim_effect.reward_ticket_claim_effect_id = batch_claim.reward_ticket_claim_effect_id
        WHERE batch_claim.reward_ticket_allocation_batch_id = batch_id
          AND (
              claim_effect.reward_ticket_pool_drawing_id <>
                  drawing_row.reward_ticket_pool_drawing_id
              OR claim_effect.status <> 'confirmed'
              OR claim_effect.finalized_at IS NULL
          )
    ) THEN
        RAISE EXCEPTION 'credited allocation does not cover every finalized winning claim'
            USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(SUM(claim_effect.received_amount_atomic), 0)
    INTO claim_sum
    FROM reward_ticket_allocation_batch_claims AS batch_claim
    JOIN reward_ticket_claim_effects AS claim_effect
      ON claim_effect.reward_ticket_claim_effect_id = batch_claim.reward_ticket_claim_effect_id
    WHERE batch_claim.reward_ticket_allocation_batch_id = batch_id
      AND claim_effect.reward_ticket_pool_drawing_id = drawing_row.reward_ticket_pool_drawing_id
      AND claim_effect.status = 'confirmed'
      AND claim_effect.finalized_at IS NOT NULL;

    IF claim_sum <> batch_row.proceeds_atomic THEN
        RAISE EXCEPTION 'allocation proceeds do not equal finalized claim receipts'
            USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*), COALESCE(SUM(amount_atomic), 0)
    INTO allocation_count, allocation_sum
    FROM reward_ticket_allocations
    WHERE reward_ticket_allocation_batch_id = batch_id;

    IF allocation_count <> batch_row.beneficiary_count
       OR batch_row.beneficiary_count <> drawing_row.beneficiary_count
       OR allocation_sum <> batch_row.proceeds_atomic
       OR batch_row.allocated_atomic <> batch_row.proceeds_atomic THEN
        RAISE EXCEPTION 'credited allocation rows do not conserve proceeds'
            USING ERRCODE = '23514';
    END IF;

    quotient := DIV(batch_row.proceeds_atomic, batch_row.beneficiary_count);
    remainder := MOD(batch_row.proceeds_atomic, batch_row.beneficiary_count);

    IF EXISTS (
        SELECT 1
        FROM reward_ticket_allocations AS allocation
        JOIN reward_ticket_pool_beneficiaries AS beneficiary
          ON beneficiary.reward_ticket_pool_drawing_id = allocation.reward_ticket_pool_drawing_id
         AND beneficiary.reward_identity_id = allocation.reward_identity_id
        WHERE allocation.reward_ticket_allocation_batch_id = batch_id
          AND (
              allocation.reward_ticket_pool_drawing_id <> drawing_row.reward_ticket_pool_drawing_id
              OR allocation.user_id <> beneficiary.user_id
              OR allocation.canonical_position <> beneficiary.canonical_position
              OR allocation.amount_atomic <> quotient + CASE
                    WHEN allocation.canonical_position < remainder THEN 1 ELSE 0 END
              OR allocation.received_remainder_unit <>
                    (allocation.canonical_position < remainder)
          )
    ) THEN
        RAISE EXCEPTION 'allocation rows violate deterministic equal_v1 rounding'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER reward_ticket_allocation_batches_complete
AFTER INSERT OR UPDATE ON reward_ticket_allocation_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_reward_ticket_allocation_batch_complete();

CREATE CONSTRAINT TRIGGER reward_ticket_allocations_complete
AFTER INSERT OR UPDATE OR DELETE ON reward_ticket_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_reward_ticket_allocation_batch_complete();

CREATE CONSTRAINT TRIGGER reward_ticket_allocation_batch_claims_complete
AFTER INSERT OR UPDATE OR DELETE ON reward_ticket_allocation_batch_claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_reward_ticket_allocation_batch_complete();

CREATE OR REPLACE FUNCTION enforce_reward_ticket_credited_drawing_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'credited' AND NOT EXISTS (
        SELECT 1
        FROM reward_ticket_allocation_batches AS batch
        WHERE batch.reward_ticket_pool_drawing_id = NEW.reward_ticket_pool_drawing_id
          AND batch.status = 'credited'
    ) THEN
        RAISE EXCEPTION 'credited drawing requires a credited allocation batch'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER reward_ticket_pool_drawings_credited_complete
AFTER INSERT OR UPDATE ON reward_ticket_pool_drawings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_reward_ticket_credited_drawing_complete();

CREATE OR REPLACE FUNCTION reject_reward_ticket_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'reward ticket financial evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER reward_ticket_allocations_immutable
BEFORE UPDATE OR DELETE ON reward_ticket_allocations
FOR EACH ROW EXECUTE FUNCTION reject_reward_ticket_append_only_mutation();

CREATE TRIGGER reward_ticket_allocation_batch_claims_immutable
BEFORE UPDATE OR DELETE ON reward_ticket_allocation_batch_claims
FOR EACH ROW EXECUTE FUNCTION reject_reward_ticket_append_only_mutation();

CREATE TRIGGER reward_ticket_usdc_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON reward_ticket_usdc_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_reward_ticket_append_only_mutation();

CREATE TRIGGER reward_ticket_custody_solvency_observations_immutable
BEFORE UPDATE OR DELETE ON reward_ticket_custody_solvency_observations
FOR EACH ROW EXECUTE FUNCTION reject_reward_ticket_append_only_mutation();

CREATE OR REPLACE FUNCTION enforce_reward_ticket_allocation_batch_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'reward ticket allocation batches cannot be deleted'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'credited' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'credited reward ticket allocation batches are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reward_ticket_allocation_batches_credited_immutable
BEFORE UPDATE OR DELETE ON reward_ticket_allocation_batches
FOR EACH ROW EXECUTE FUNCTION enforce_reward_ticket_allocation_batch_immutability();

CREATE OR REPLACE FUNCTION enforce_reward_ticket_committed_evidence_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'published' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'published reward ticket commitment evidence is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reward_ticket_commitment_batches_published_immutable
BEFORE UPDATE ON reward_ticket_beneficiary_commitment_batches
FOR EACH ROW EXECUTE FUNCTION enforce_reward_ticket_committed_evidence_immutability();

-- No ordinary runtime path may erase ticket-pool money or audit records.
REVOKE DELETE ON TABLE
    reward_ticket_pools,
    reward_ticket_pool_funding_effects,
    reward_ticket_price_quotes,
    reward_ticket_beneficiary_commitment_batches,
    reward_ticket_pool_drawings,
    reward_ticket_pool_beneficiaries,
    reward_ticket_purchase_effects,
    reward_ticket_inventory,
    reward_ticket_claim_effects,
    reward_ticket_claim_tickets,
    reward_ticket_allocation_batches,
    reward_ticket_allocation_batch_claims,
    reward_ticket_allocations,
    reward_ticket_usdc_balances,
    reward_ticket_usdc_ledger_entries,
    reward_ticket_custody_solvency_observations,
    reward_ticket_pool_monitor_state,
    reward_ticket_pool_incidents,
    reward_ticket_custody_backing_domains
FROM control_plane_api_rw;

REVOKE INSERT, UPDATE, DELETE ON TABLE reward_ticket_usdc_balances
FROM control_plane_api_rw;

REVOKE UPDATE ON TABLE
    reward_ticket_allocation_batch_claims,
    reward_ticket_allocations,
    reward_ticket_usdc_ledger_entries,
    reward_ticket_custody_solvency_observations
FROM control_plane_api_rw;

REVOKE ALL ON TABLE reward_ticket_cashout_effects FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE reward_ticket_cashout_effects TO control_plane_api_rw;
GRANT SELECT ON TABLE reward_ticket_cashout_effects TO control_plane_api_ro, control_plane_ops_ro;

REVOKE ALL ON TABLE reward_ticket_custody_backing_domains FROM PUBLIC;
GRANT SELECT ON TABLE reward_ticket_custody_backing_domains
TO control_plane_api_rw, control_plane_api_ro, control_plane_ops_ro;

REVOKE ALL ON FUNCTION apply_reward_ticket_usdc_ledger_entry() FROM PUBLIC;
