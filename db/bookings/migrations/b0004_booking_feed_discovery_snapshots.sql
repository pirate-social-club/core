-- Cached, canonical booking discovery for hot feed reads.
--
-- The snapshot is derived by the API with @pirate/bookings-domain resolveSlots
-- over the same 14-day window exposed by the booking sheet. Feed reads only
-- consult this compact table; they never approximate prices from unmatched
-- pricing rules or enumerate availability on the request path.
CREATE TABLE bookings.feed_discovery_snapshots (
    host_user_id TEXT PRIMARY KEY
        REFERENCES bookings.profiles(host_user_id) ON DELETE CASCADE,
    has_available_slot BOOLEAN NOT NULL,
    starting_price_cents INTEGER,
    window_start_utc TIMESTAMPTZ NOT NULL,
    window_end_utc TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT bookings_feed_discovery_window_check
        CHECK (window_end_utc > window_start_utc),
    CONSTRAINT bookings_feed_discovery_expiry_check
        CHECK (valid_until > computed_at),
    CONSTRAINT bookings_feed_discovery_price_check CHECK (
        (
            has_available_slot = TRUE
            AND starting_price_cents IS NOT NULL
            AND starting_price_cents > 0
        )
        OR
        (has_available_slot = FALSE AND starting_price_cents IS NULL)
    )
);

CREATE INDEX idx_bookings_feed_discovery_snapshots_expiry
    ON bookings.feed_discovery_snapshots(valid_until);

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE bookings.feed_discovery_snapshots
TO control_plane_api_rw;

GRANT SELECT
ON TABLE bookings.feed_discovery_snapshots
TO control_plane_api_ro;
