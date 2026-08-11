/** Apply the integer-money commerce rebuild across the community D1 fleet. */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1154_commerce_integer_money.sql",
  label: "community-template",
  requiredTables: ["listings", "purchase_quotes", "purchases", "purchase_allocation_legs"],
  creates: {
    kind: "columns_by_table",
    columns: [
      { table: "listings", column: "price_cents" },
      { table: "purchase_quotes", column: "base_price_cents" },
      { table: "purchase_quotes", column: "final_price_cents" },
      { table: "purchases", column: "purchase_price_cents" },
      { table: "purchases", column: "donation_share_bps" },
      { table: "purchases", column: "donation_amount_cents" },
      { table: "purchase_allocation_legs", column: "amount_cents" },
    ],
  },
  // This migration rebuilds four tables. A partially applied rebuild requires
  // operator review; it must never be replayed automatically.
  replayableDdl: false,
  description: "Integer cents and basis points for community commerce money fields.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-commerce-integer-money-d1-migration.ts",
  )
}
