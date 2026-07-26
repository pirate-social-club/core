-- `superseded` has never had a writer and production contains no rows in that
-- state. Keep the payment-intent state space equal to the states the service
-- can actually produce and recover.
ALTER TABLE bookings.payment_intents
  DROP CONSTRAINT payment_intents_status_check,
  ADD CONSTRAINT payment_intents_status_check CHECK (status IN (
    'active', 'verifying', 'verified', 'verification_failed',
    'verification_rejected', 'custody_refund_pending',
    'custody_operator_incident', 'consumed', 'expired', 'refunded'
  ));
