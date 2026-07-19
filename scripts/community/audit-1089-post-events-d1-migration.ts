import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1089_post_events.sql",
  label: "community-template",
  requiredTables: ["communities", "posts"],
  creates: {
    kind: "schema_objects",
    columns: [
      { table: "post_events", column: "event_start_at" },
      { table: "post_events", column: "event_timezone" },
    ],
    indexes: ["idx_post_events_community_start"],
  },
  replayableDdl: false,
  description: "Read-only fleet audit for the 1089 post-events sibling migration.",
}

if (import.meta.main) {
  if (process.argv.includes("--execute")) throw new Error("audit scripts are read-only")
  await runFleetMigration(SPEC, "scripts/community/audit-1089-post-events-d1-migration.ts")
}
