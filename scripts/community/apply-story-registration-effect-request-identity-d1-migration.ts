/** Apply migration 1130 across every allocated and loaded community shard. */
import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1130_story_registration_effect_request_identity.sql",
  label: "community-template",
  requiredTables: ["story_registration_effects"],
  creates: {
    kind: "columns",
    table: "story_registration_effects",
    columns: ["chain_id", "signer_address", "call_data_hash"],
  },
  replayableDdl: false,
  description: "Immutable chain, signer, and call-data identity for Story registration effects.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-story-registration-effect-request-identity-d1-migration.ts",
  )
}
