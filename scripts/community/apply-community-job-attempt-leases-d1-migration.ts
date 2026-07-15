/** Apply migration 1128 across every allocated and loaded community shard. */
import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1128_community_job_attempt_leases.sql",
  label: "community-template",
  requiredTables: ["community_jobs"],
  creates: {
    kind: "columns",
    table: "community_jobs",
    columns: ["attempt_id", "lease_expires_at"],
  },
  replayableDdl: false,
  description: "Attempt identity and expiring leases for durable community jobs.",
}

if (import.meta.main) {
  await runFleetMigration(
    SPEC,
    "scripts/community/apply-community-job-attempt-leases-d1-migration.ts",
  )
}
