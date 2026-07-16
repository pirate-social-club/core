/** Apply migration 1132 across every allocated and loaded community shard. */
import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1132_paid_purchase_settlement_recovery.sql",
  label: "community-template",
  requiredTables: ["purchase_quotes", "purchase_settlement_effects"],
  creates: {
    kind: "columns_by_table",
    columns: [
      { table: "purchase_quotes", column: "funding_locked_at" },
      { table: "purchase_settlement_effects", column: "failure_disposition" },
      { table: "purchase_settlement_effects", column: "broadcast_tx_ref" },
    ],
  },
  replayableDdl: false,
  description: "Freeze paid quotes and safely recover pre-broadcast parent-vault settlement failures.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-paid-purchase-settlement-recovery-d1-migration.ts",
  )
}
