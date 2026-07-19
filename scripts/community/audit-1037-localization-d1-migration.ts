import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1037_community_text_localization.sql",
  label: "community-template",
  requiredTables: ["communities", "content_translations"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "community_localization_meta", column: "field_key" },
      { table: "content_translations", column: "field_key" },
    ],
    indexes: [
      "idx_community_localization_meta_updated",
      "idx_content_translations_lookup",
      "idx_content_translations_content_updated",
    ],
  },
  replayableDdl: false,
  description: "Read-only fleet audit for the 1037 localization sibling migration.",
}

if (import.meta.main) {
  if (process.argv.includes("--execute")) throw new Error("audit scripts are read-only")
  await runFleetMigration(SPEC, "scripts/community/audit-1037-localization-d1-migration.ts")
}
