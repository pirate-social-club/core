-- Global booking settlement review metadata.
--
-- Ambiguous attendance resolution moves bookings to `disputed`; these columns make that state
-- operator-resolvable without relying on community-scoped booking rows.

ALTER TABLE bookings.bookings
  ADD COLUMN settlement_review_status TEXT,
  ADD COLUMN settlement_review_reason TEXT,
  ADD COLUMN settlement_review_resolution TEXT,
  ADD COLUMN settlement_review_opened_at TIMESTAMPTZ,
  ADD COLUMN settlement_review_resolved_at TIMESTAMPTZ,
  ADD COLUMN settlement_review_operator_credential_id TEXT,
  ADD COLUMN settlement_review_operator_actor_id TEXT,
  ADD COLUMN settlement_review_note TEXT,
  ADD COLUMN settlement_review_version INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT bookings_settlement_review_status_check
    CHECK (settlement_review_status IS NULL OR settlement_review_status IN ('pending', 'resolved')),
  ADD CONSTRAINT bookings_settlement_review_reason_check
    CHECK (settlement_review_reason IS NULL OR settlement_review_reason IN ('attendance_ambiguous')),
  ADD CONSTRAINT bookings_settlement_review_resolution_check
    CHECK (settlement_review_resolution IS NULL OR settlement_review_resolution IN ('completed', 'no_show_host', 'no_show_booker')),
  ADD CONSTRAINT bookings_settlement_review_version_check
    CHECK (settlement_review_version >= 0),
  ADD CONSTRAINT bookings_settlement_review_pending_shape_check
    CHECK (
      settlement_review_status <> 'pending'
      OR (
        status = 'disputed'
        AND settlement_review_reason IS NOT NULL
        AND settlement_review_resolution IS NULL
        AND settlement_review_opened_at IS NOT NULL
        AND settlement_review_resolved_at IS NULL
      )
    ),
  ADD CONSTRAINT bookings_settlement_review_resolved_shape_check
    CHECK (
      settlement_review_status <> 'resolved'
      OR (
        settlement_review_reason IS NOT NULL
        AND settlement_review_resolution IS NOT NULL
        AND settlement_review_opened_at IS NOT NULL
        AND settlement_review_resolved_at IS NOT NULL
      )
    );

CREATE INDEX idx_bookings_pending_settlement_review
  ON bookings.bookings(updated_at, booking_id)
  WHERE settlement_review_status = 'pending';
