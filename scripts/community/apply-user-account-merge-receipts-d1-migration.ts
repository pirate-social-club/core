/** Apply resumable user-account merge receipts across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1152_user_account_merge_receipts.sql",
  label: "community-template",
  // The receipt table is independent and safe to install on legacy loaded pool
  // databases. Runtime account merges still preflight only ready communities.
  requiredTables: [],
  creates: {
    kind: "schema_objects",
    columns: [],
    tables: ["user_account_merge_receipts"],
    indexes: ["idx_user_account_merge_receipts_canonical"],
  },
  replayableDdl: false,
  description: "Idempotency receipts for scoped Telegram account consolidation.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-user-account-merge-receipts-d1-migration.ts",
  )
}
