/**
 * Operator spec for applying community-template migration
 * 1134_story_settlement_coordinator_mirror.sql across the allocated+loaded D1
 * fleet. The shared fleet library owns read-only classification, resumable
 * writes, checksum validation, and ledger/schema atomicity.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1134_story_settlement_coordinator_mirror.sql",
  label: "community-template",
  requiredTables: ["purchase_settlement_effects"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "purchase_settlement_effects", column: "request_fingerprint" },
      { table: "purchase_settlement_effects", column: "coordinator_plan_ref" },
      { table: "purchase_settlement_effects", column: "coordinator_state" },
      { table: "purchase_settlement_effects", column: "coordinator_version" },
      { table: "purchase_settlement_effects", column: "reconciliation_reason" },
      { table: "purchase_settlement_effects", column: "last_reconciled_at" },
      { table: "purchase_settlement_effects", column: "finality_confirmed_at" },
      { table: "purchase_settlement_transactions", column: "purchase_settlement_transaction_id" },
      { table: "purchase_settlement_transactions", column: "purchase_settlement_effect_id" },
      { table: "purchase_settlement_transactions", column: "step_key" },
      { table: "purchase_settlement_transactions", column: "step_kind" },
      { table: "purchase_settlement_transactions", column: "ordinal" },
      { table: "purchase_settlement_transactions", column: "call_identity_hash" },
      { table: "purchase_settlement_transactions", column: "coordinator_step_ref" },
      { table: "purchase_settlement_transactions", column: "state" },
      { table: "purchase_settlement_transactions", column: "chain_id" },
      { table: "purchase_settlement_transactions", column: "signer_address" },
      { table: "purchase_settlement_transactions", column: "nonce" },
      { table: "purchase_settlement_transactions", column: "tx_hash" },
      { table: "purchase_settlement_transactions", column: "block_number" },
      { table: "purchase_settlement_transactions", column: "block_hash" },
      { table: "purchase_settlement_transactions", column: "attempt_count" },
      { table: "purchase_settlement_transactions", column: "last_error_code" },
      { table: "purchase_settlement_transactions", column: "prepared_at" },
      { table: "purchase_settlement_transactions", column: "broadcast_at" },
      { table: "purchase_settlement_transactions", column: "mined_at" },
      { table: "purchase_settlement_transactions", column: "confirmed_at" },
      { table: "purchase_settlement_transactions", column: "updated_at" },
    ],
    indexes: [
      "idx_purchase_settlement_transactions_effect_step",
      "idx_purchase_settlement_transactions_coordinator_step",
      "idx_purchase_settlement_transactions_signer_nonce",
    ],
  },
  // Plain ADD COLUMN and CREATE TABLE/INDEX statements cannot be replayed when
  // the objects already exist. Existing objects with no ledger row are repaired
  // by ledger backfill only.
  replayableDdl: false,
  description: "Story settlement coordinator shard mirror and per-step transaction evidence.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-story-settlement-coordinator-mirror-d1-migration.ts",
  )
}
