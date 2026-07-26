-- Make feed-discovery invalidation transactional with host authoring and fence
-- stale recomputations across Worker isolates.
ALTER TABLE bookings.profiles
  ADD COLUMN feed_discovery_revision BIGINT NOT NULL DEFAULT 0
  CHECK (feed_discovery_revision >= 0);

ALTER TABLE bookings.feed_discovery_snapshots
  ADD COLUMN source_revision BIGINT NOT NULL DEFAULT 0
  CHECK (source_revision >= 0);

CREATE OR REPLACE FUNCTION bookings.bump_profile_feed_discovery_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.feed_discovery_revision := OLD.feed_discovery_revision + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bookings.invalidate_profile_feed_discovery_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM bookings.feed_discovery_snapshots
   WHERE host_user_id = NEW.host_user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_profiles_feed_discovery_revision
BEFORE UPDATE ON bookings.profiles
FOR EACH ROW
EXECUTE FUNCTION bookings.bump_profile_feed_discovery_revision();

CREATE TRIGGER bookings_profiles_feed_discovery_invalidate
AFTER UPDATE ON bookings.profiles
FOR EACH ROW
EXECUTE FUNCTION bookings.invalidate_profile_feed_discovery_snapshot();

CREATE OR REPLACE FUNCTION bookings.touch_host_feed_discovery_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_host_user_id TEXT;
  new_host_user_id TEXT;
BEGIN
  old_host_user_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.host_user_id ELSE NULL END;
  new_host_user_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.host_user_id ELSE NULL END;

  IF old_host_user_id IS NOT NULL THEN
    UPDATE bookings.profiles
       SET feed_discovery_revision = feed_discovery_revision
     WHERE host_user_id = old_host_user_id;
  END IF;
  IF new_host_user_id IS NOT NULL AND new_host_user_id IS DISTINCT FROM old_host_user_id THEN
    UPDATE bookings.profiles
       SET feed_discovery_revision = feed_discovery_revision
     WHERE host_user_id = new_host_user_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_availability_rules_feed_discovery_touch
AFTER INSERT OR UPDATE OR DELETE ON bookings.availability_rules
FOR EACH ROW
EXECUTE FUNCTION bookings.touch_host_feed_discovery_revision();

CREATE TRIGGER bookings_availability_exceptions_feed_discovery_touch
AFTER INSERT OR UPDATE OR DELETE ON bookings.availability_exceptions
FOR EACH ROW
EXECUTE FUNCTION bookings.touch_host_feed_discovery_revision();

CREATE TRIGGER bookings_price_rules_feed_discovery_touch
AFTER INSERT OR UPDATE OR DELETE ON bookings.price_rules
FOR EACH ROW
EXECUTE FUNCTION bookings.touch_host_feed_discovery_revision();
