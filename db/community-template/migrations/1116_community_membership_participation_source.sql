-- participation_source distinguishes a subscriber (joined the community) from a
-- drive-by inline-PoW commenter who was auto-enrolled solely to author a comment
-- in a PoW-gated community (Reddit-style: commenting != subscribing).
--
-- Subscriber-semantics reads (member counts, member rosters) MUST filter
-- participation_source = 'join'. Reads that intentionally include participants
-- (e.g. a "recent commenters" surface) must say so explicitly.
--
-- Upsert semantic (enforced in upsertCommunityMembership, pinned by test):
-- 'join' wins. A comment-driven upsert sets 'comment_pow' only on INSERT and
-- never clobbers an existing value on conflict; a later real join upgrades
-- 'comment_pow' -> 'join'.
--
-- Reversibility: ROLL-FORWARD ONLY. The community shard migration runner applies
-- numbered migrations in order and has no paired down-migration convention
-- (no *.down.sql). Reverting is a new forward migration. This change is additive
-- with a safe DEFAULT 'join', so pre-existing rows and older code paths that do
-- not reference the column are unaffected.
ALTER TABLE community_memberships
  ADD COLUMN participation_source TEXT NOT NULL DEFAULT 'join'
  CHECK (participation_source IN ('join', 'comment_pow'));
