-- Multiple independent senders transferring the expected token into one
-- operator receipt prove custody, but do not provide a safe single-recipient
-- refund instruction. Preserve the complete inventory as diagnostic evidence
-- in a non-terminal, operator-owned state. No money executor selects it.

ALTER TABLE bookings.payment_intents
  DROP CONSTRAINT payment_intents_status_check,
  DROP CONSTRAINT bookings_payment_intents_custody_reason_check,
  ADD COLUMN custody_evidence_json JSONB,
  ADD CONSTRAINT payment_intents_status_check CHECK (status IN (
    'active', 'verifying', 'verified', 'verification_failed', 'verification_rejected',
    'custody_refund_pending', 'custody_operator_incident',
    'consumed', 'expired', 'refunded', 'superseded'
  )),
  ADD CONSTRAINT bookings_payment_intents_custody_reason_check
    CHECK (custody_reason IS NULL OR custody_reason IN (
      'wrong_transfer_amount', 'unexpected_sender', 'multiple_senders'
    )),
  ADD CONSTRAINT bookings_payment_intents_custody_refund_reason_check
    CHECK (
      status <> 'custody_refund_pending'
      OR custody_reason IN ('wrong_transfer_amount', 'unexpected_sender')
    ),
  ADD CONSTRAINT bookings_payment_intents_custody_incident_shape_check
    CHECK (
      status <> 'custody_operator_incident'
      OR (
        claimed_tx_ref IS NOT NULL
        AND consumed_wallet_attachment_id IS NOT NULL
        AND custody_reason = 'multiple_senders'
        AND custody_detected_at IS NOT NULL
        AND custody_evidence_json IS NOT NULL
        AND jsonb_typeof(custody_evidence_json) = 'object'
        AND jsonb_typeof(custody_evidence_json -> 'transfers') = 'array'
        AND jsonb_array_length(custody_evidence_json -> 'transfers') > 1
        AND refund_tx_ref IS NULL
        AND refunded_at IS NULL
      )
    );

CREATE INDEX idx_bookings_payment_intents_custody_incident_worklist
  ON bookings.payment_intents(custody_detected_at, payment_intent_id)
  WHERE status = 'custody_operator_incident';

