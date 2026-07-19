import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1037_rebuild_comments_guest_authorship.sql",
  label: "community-template",
  requiredTables: ["communities", "comments"],
  creates: {
    kind: "table_sql_contains",
    table: "comments",
    fragments: ["'guest'"],
  },
  replayableDdl: true,
  description: "Read-only ledger audit for the 1037 comment-authorship sibling migration.",
}

if (import.meta.main) {
  if (process.argv.includes("--execute")) throw new Error("audit scripts are read-only")
  await runFleetMigration(SPEC, "scripts/community/audit-1037-comment-authorship-d1-migration.ts")
}
