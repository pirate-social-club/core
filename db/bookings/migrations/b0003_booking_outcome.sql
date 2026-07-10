-- Preserve the business outcome after payment finalization collapses a booking
-- to the generic `settled` / `refunded` terminal states.
--
-- Existing terminal rows cannot always be distinguished safely (for example,
-- a full refund may follow either a host cancellation or a host no-show), so
-- only unambiguous in-flight/review rows are backfilled.

ALTER TABLE bookings.bookings
  ADD COLUMN outcome TEXT,
  ADD CONSTRAINT bookings_outcome_check
    CHECK (
      outcome IS NULL
      OR outcome IN (
        'completed',
        'no_show_host',
        'no_show_booker',
        'cancelled_by_host',
        'cancelled_by_booker'
      )
    );

UPDATE bookings.bookings
SET outcome = CASE
  WHEN status IN (
    'completed',
    'no_show_host',
    'no_show_booker',
    'cancelled_by_host',
    'cancelled_by_booker'
  ) THEN status
  WHEN settlement_review_status = 'resolved' THEN settlement_review_resolution
  ELSE NULL
END
WHERE outcome IS NULL;
