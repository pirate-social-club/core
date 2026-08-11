/** Apply the paid-asset listing uniqueness constraint across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1155_listings_asset_unique_index.sql",
  label: "community-template",
  requiredTables: ["listings"],
  creates: {
    kind: "schema_objects",
    columns: [],
    indexes: ["idx_listings_community_asset_unique"],
  },
  // The migration creates the unique replacement before dropping the legacy
  // lookup index. A partial application must be reviewed, not replayed.
  replayableDdl: false,
  description: "Unique paid-asset listing per community, with no silent duplicate cleanup.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-listings-asset-unique-index-d1-migration.ts",
  )
}
