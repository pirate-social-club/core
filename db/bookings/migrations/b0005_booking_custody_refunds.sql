-- Preserve booking payments that reached operator custody but cannot satisfy
-- the immutable quote. These rows are refund obligations, not verification
-- rejections. `refunded` is the single terminal payment-intent state for both
-- custody mismatches and exact late-payment orphan refunds.

ALTER TABLE bookings.payment_intents
  DROP CONSTRAINT payment_intents_status_check,
  ADD COLUMN custody_observed_amount_atomic NUMERIC(78,0),
  ADD COLUMN custody_sender_address TEXT,
  ADD COLUMN custody_reason TEXT,
  ADD COLUMN custody_detected_at TIMESTAMPTZ,
  ADD COLUMN custody_refund_tx_ref TEXT,
  ADD COLUMN custody_refund_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN custody_refund_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN custody_refund_last_error_code TEXT,
  ADD COLUMN custody_refunded_at TIMESTAMPTZ,
  ADD CONSTRAINT payment_intents_status_check CHECK (status IN (
    'active', 'verifying', 'verified', 'verification_failed', 'verification_rejected',
    'custody_refund_pending', 'consumed', 'expired', 'refunded', 'superseded'
  )),
  ADD CONSTRAINT bookings_payment_intents_custody_amount_check
    CHECK (custody_observed_amount_atomic IS NULL OR custody_observed_amount_atomic > 0),
  ADD CONSTRAINT bookings_payment_intents_custody_reason_check
    CHECK (custody_reason IS NULL OR custody_reason IN ('wrong_transfer_amount')),
  ADD CONSTRAINT bookings_payment_intents_custody_attempt_count_check
    CHECK (custody_refund_attempt_count >= 0),
  ADD CONSTRAINT bookings_payment_intents_custody_pending_shape_check
    CHECK (
      status <> 'custody_refund_pending'
      OR (
        claimed_tx_ref IS NOT NULL
        AND consumed_wallet_attachment_id IS NOT NULL
        AND custody_observed_amount_atomic IS NOT NULL
        AND custody_sender_address IS NOT NULL
        AND custody_reason IS NOT NULL
        AND custody_detected_at IS NOT NULL
        AND custody_refunded_at IS NULL
      )
    ),
  ADD CONSTRAINT bookings_payment_intents_refunded_shape_check
    CHECK (
      status <> 'refunded'
      OR (
        claimed_tx_ref IS NOT NULL
        AND custody_refund_tx_ref IS NOT NULL
        AND custody_refunded_at IS NOT NULL
      )
    );

CREATE UNIQUE INDEX idx_bookings_payment_intents_custody_refund_tx
  ON bookings.payment_intents(custody_refund_tx_ref)
  WHERE custody_refund_tx_ref IS NOT NULL;

CREATE INDEX idx_bookings_payment_intents_custody_refund_worklist
  ON bookings.payment_intents(custody_detected_at, payment_intent_id)
  WHERE status = 'custody_refund_pending';

-- Custody mismatches may be sub-cent atomic amounts and deliberately never
-- form a booking. Extend the existing booking settlement-effect ledger rather
-- than bypassing it or creating a second money authority.
ALTER TABLE bookings.settlement_effects
  ALTER COLUMN booking_id DROP NOT NULL,
  ALTER COLUMN amount_cents DROP NOT NULL,
  ADD COLUMN payment_intent_id TEXT REFERENCES bookings.payment_intents(payment_intent_id),
  ADD COLUMN amount_atomic NUMERIC(78,0),
  ADD CONSTRAINT bookings_settlement_effects_owner_check
    CHECK ((booking_id IS NOT NULL)::integer + (payment_intent_id IS NOT NULL)::integer = 1),
  ADD CONSTRAINT bookings_settlement_effects_amount_shape_check
    CHECK (
      (amount_cents IS NOT NULL AND amount_cents > 0 AND amount_atomic IS NULL)
      OR
      (amount_cents IS NULL AND amount_atomic IS NOT NULL AND amount_atomic > 0)
    );

CREATE UNIQUE INDEX idx_bookings_settlement_effects_payment_intent_kind
  ON bookings.settlement_effects(payment_intent_id, effect_kind)
  WHERE payment_intent_id IS NOT NULL;
