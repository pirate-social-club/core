/**
 * Operator script: apply community-template migration 1126_reward_qualification_outbox.sql
 * across the allocated+loaded community D1 fleet.
 *
 * Why this is urgent even though rewards are dark
 * ----------------------------------------------
 * Study and Karaoke write a reward qualification into `reward_qualification_outbox`
 * INSIDE the attempt's own transaction:
 *
 *   post-study-service.ts:1332-1333  armed by REWARDS_CAMPAIGNS_ENABLED && REWARDS_ACCRUAL_ENABLED
 *   post-study-service.ts:1433       emit uses `client: tx` — the attempt's transaction
 *   karaoke-attempt-finalize-service.ts:172-173  the same conjunction
 *
 * The table is missing on the production fleet. If both flags are turned on while
 * it is absent, that INSERT fails and rolls back the whole attempt — so Study and
 * Karaoke stop working on every community. That is a fleet-wide outage of a LIVE
 * feature, not merely a broken reward path.
 *
 * Applying this migration is therefore not a reward prerequisite; it is DISARMING
 * a landmine. It is pure CREATE TABLE, so it is safe to apply while rewards are dark.
 *
 * The DDL is `CREATE TABLE` with no IF NOT EXISTS, so it cannot be replayed where
 * the table already exists ("table already exists"). Where the table is present but
 * the ledger row is missing, the shared machinery backfills the LEDGER ONLY.
 *
 * Usage (read-only classification first, always):
 *
 *   bun scripts/community/apply-reward-outbox-d1-migration.ts \
 *     --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc --prod
 *
 *   bun scripts/community/apply-reward-outbox-d1-migration.ts \
 *     --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc --prod \
 *     --execute --confirm-time-travel --resume-file tmp/1126-prod-resume.txt
 *
 *   # then re-run with NO flags to obtain a full read-only verification
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1126_reward_qualification_outbox.sql",
  label: "community-template",
  // The outbox has FKs onto both, so neither may be missing.
  requiredTables: ["posts", "communities"],
  creates: { kind: "tables", tables: ["reward_qualification_outbox"] },
  // Plain CREATE TABLE: replaying it where the table exists fails.
  replayableDdl: false,
  description:
    "Shard-local reward qualification outbox. Study/Karaoke write to it inside the attempt\n" +
    "transaction once the reward flags are on, so its absence would break both features.",
}

if (import.meta.main) await runFleetMigration(SPEC, "scripts/community/apply-reward-outbox-d1-migration.ts")
