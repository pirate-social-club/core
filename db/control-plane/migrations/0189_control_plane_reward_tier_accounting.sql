-- Activate claim-time nationality tier snapshots and bound unresolved claims to
-- the contribution lots that can satisfy their maximum payout.

ALTER TABLE reward_nationality_decisions
    ADD COLUMN resolved_amount_cents INTEGER;

-- Decisions written before tier accounting stored only the immutable result key.
-- Recover their amount from the campaign terms that produced that key before the
-- shape constraint becomes authoritative. Corrupt or out-of-range keys remain
-- NULL and deliberately fail the constraint instead of receiving a guessed value.
UPDATE reward_nationality_decisions AS decision
SET resolved_amount_cents = CASE
    WHEN decision.result_key = 'default' THEN campaign.default_amount_cents
    WHEN decision.result_key ~ '^tier:[0-9]+$' THEN (
        SELECT (tier.value ->> 'amount_cents')::INTEGER
        FROM jsonb_array_elements(campaign.payout_tiers_json)
            WITH ORDINALITY AS tier(value, ordinal)
        WHERE tier.ordinal = substring(decision.result_key FROM '^tier:([0-9]+)$')::INTEGER + 1
    )
    ELSE NULL
END
FROM reward_campaigns AS campaign
WHERE decision.retryability = 'resolved'
  AND campaign.reward_campaign_id = decision.reward_campaign_id;

ALTER TABLE reward_nationality_decisions
    ADD CONSTRAINT reward_nationality_decisions_amount_shape_check CHECK (
        (retryability = 'resolved'
            AND resolved_amount_cents IS NOT NULL
            AND resolved_amount_cents > 0)
        OR (retryability <> 'resolved' AND resolved_amount_cents IS NULL)
    );

ALTER TABLE reward_pending_qualifications
    ADD COLUMN exposure_amount_cents INTEGER;

ALTER TABLE reward_pending_qualifications
    ADD CONSTRAINT reward_pending_qualifications_exposure_check CHECK (
        exposure_amount_cents IS NULL OR exposure_amount_cents > 0
    );

-- An unresolved tier claim exposes its campaign at max_claim_cents. Keeping
-- the campaign id in both composite foreign keys makes it impossible for one
-- song pool to consume another pool's contribution lots.
CREATE UNIQUE INDEX reward_pending_qualifications_campaign_identity_unique
    ON reward_pending_qualifications (
        reward_pending_qualification_id, reward_campaign_id
    );

CREATE UNIQUE INDEX reward_campaign_funding_effect_campaign_identity_unique
    ON reward_campaign_funding_effects (
        reward_campaign_funding_effect_id, reward_campaign_id
    );

CREATE TABLE reward_pending_qualification_funding_exposures (
    reward_pending_qualification_id TEXT NOT NULL,
    reward_campaign_id TEXT NOT NULL,
    reward_campaign_funding_effect_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    exposed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (
        reward_pending_qualification_id,
        reward_campaign_funding_effect_id
    ),
    FOREIGN KEY (reward_pending_qualification_id, reward_campaign_id)
        REFERENCES reward_pending_qualifications(
            reward_pending_qualification_id, reward_campaign_id
        ) ON DELETE CASCADE,
    FOREIGN KEY (reward_campaign_funding_effect_id, reward_campaign_id)
        REFERENCES reward_campaign_funding_effects(
            reward_campaign_funding_effect_id, reward_campaign_id
        )
);

CREATE INDEX reward_pending_exposures_lot_idx
    ON reward_pending_qualification_funding_exposures (
        reward_campaign_funding_effect_id,
        reward_pending_qualification_id
    );

-- Durable, minimal enforcement state for a selected identity document that no
-- longer belongs to the campaign's immutable provider. Raw document evidence
-- remains in the identity domain.
CREATE TABLE reward_identity_binding_enforcements (
    reward_identity_binding_enforcement_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    reward_campaign_id TEXT NOT NULL REFERENCES reward_campaigns(reward_campaign_id),
    status TEXT NOT NULL CHECK (status IN ('open', 'cleared')),
    reason TEXT NOT NULL CHECK (reason = 'identity_binding_mismatch'),
    first_detected_at TIMESTAMPTZ NOT NULL,
    last_detected_at TIMESTAMPTZ NOT NULL,
    cleared_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT reward_binding_enforcement_lifecycle_check CHECK (
        (status = 'open' AND cleared_at IS NULL)
        OR (status = 'cleared' AND cleared_at IS NOT NULL)
    ),
    UNIQUE (user_id, reward_campaign_id)
);

CREATE INDEX reward_binding_enforcements_open_expiry_idx
    ON reward_identity_binding_enforcements (expires_at, reward_identity_binding_enforcement_id)
    WHERE status = 'open';
