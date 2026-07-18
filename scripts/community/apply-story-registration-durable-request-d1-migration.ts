/**
 * Operator spec for applying community-template migration
 * 1139_story_registration_durable_request.sql across the allocated+loaded D1 fleet.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1139_story_registration_durable_request.sql",
  label: "community-template",
  requiredTables: ["story_registration_effects"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "story_registration_effects", column: "durable_request_json" },
    ],
    indexes: [],
  },
  replayableDdl: false,
  description: "Durable immutable Story registration SDK request for persist-and-replay retries.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-story-registration-durable-request-d1-migration.ts",
  )
}
