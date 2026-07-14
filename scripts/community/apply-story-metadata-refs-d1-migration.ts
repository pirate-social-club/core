/**
 * Operator script: apply community-template migration 1127_asset_story_metadata_refs.sql
 * across the allocated+loaded community D1 fleet.
 *
 * The machinery lives in ./lib/fleet-d1-migration.ts — every safety property
 * (read-only by default, resumable fleet writes, fail-closed on anything not
 * positively understood, ledger+DDL atomicity) is implemented once there rather
 * than re-derived per migration. This file is only the spec.
 *
 * 1127 is plain ADD COLUMN, so replaying it where the columns already exist would
 * fail with "duplicate column name". Where the columns are present but the ledger
 * row is missing, the shared machinery backfills the LEDGER ONLY — never the DDL.
 *
 * Usage (read-only classification first, always):
 *
 *   bun scripts/community/apply-story-metadata-refs-d1-migration.ts \
 *     --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc --prod
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

// Re-exported so the existing unit test keeps importing it from this path.
export { extractWranglerJson } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1127_asset_story_metadata_refs.sql",
  label: "community-template",
  requiredTables: ["assets"],
  creates: {
    kind: "columns",
    table: "assets",
    columns: [
      "story_ip_metadata_uri",
      "story_ip_metadata_hash",
      "story_nft_metadata_uri",
      "story_nft_metadata_hash",
    ],
  },
  // Plain ADD COLUMN: replaying it where the columns exist fails.
  replayableDdl: false,
  description: "Story IP/NFT metadata refs on assets. The pinned prod API reads these in commerce/queries.ts.",
}

if (import.meta.main) await runFleetMigration(SPEC, "scripts/community/apply-story-metadata-refs-d1-migration.ts")
