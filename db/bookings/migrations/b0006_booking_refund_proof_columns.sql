-- Refund lifecycle/proof belongs to every paid-and-refunded payment intent,
-- not only custody-mismatch obligations. Keep custody-prefixed columns solely
-- for the classifier evidence that created that specific obligation.

ALTER TABLE bookings.payment_intents
  RENAME COLUMN custody_refund_tx_ref TO refund_tx_ref;

ALTER TABLE bookings.payment_intents
  RENAME COLUMN custody_refund_attempt_count TO refund_attempt_count;

ALTER TABLE bookings.payment_intents
  RENAME COLUMN custody_refund_last_attempt_at TO refund_last_attempt_at;

ALTER TABLE bookings.payment_intents
  RENAME COLUMN custody_refund_last_error_code TO refund_last_error_code;

ALTER TABLE bookings.payment_intents
  RENAME COLUMN custody_refunded_at TO refunded_at;

ALTER INDEX bookings.idx_bookings_payment_intents_custody_refund_tx
  RENAME TO idx_bookings_payment_intents_refund_tx;
