import { Database } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const MIGRATIONS_DIR = join(import.meta.dir, "../../db/community-template/migrations")

function migrationFilesThrough(prefix: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql") && file <= prefix)
    .sort()
}

function applyMigrations(db: Database, files: string[]): void {
  for (const file of files) db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
}

describe("community job and Story registration migrations", () => {
  test("fresh databases receive the lease and immutable Story journal schema", () => {
    const db = new Database(":memory:")
    applyMigrations(db, migrationFilesThrough("1130_story_registration_effect_request_identity.sql"))

    const jobColumns = db
      .query<{ name: string }, []>("PRAGMA table_info(community_jobs)")
      .all()
      .map((row) => row.name)
    expect(jobColumns).toContain("attempt_id")
    expect(jobColumns).toContain("lease_expires_at")

    const storyColumns = db
      .query<{ name: string }, []>("PRAGMA table_info(story_registration_effects)")
      .all()
      .map((row) => row.name)
    expect(storyColumns).toContain("chain_id")
    expect(storyColumns).toContain("signer_address")
    expect(storyColumns).toContain("call_data_hash")
    expect(db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_story_registration_effects_reconciliation'",
    ).get()?.name).toBe("idx_story_registration_effects_reconciliation")
  })

  test("upgrading preserves existing running jobs", () => {
    const db = new Database(":memory:")
    applyMigrations(db, migrationFilesThrough("1127_asset_story_metadata_refs.sql"))
    db.query(`
      INSERT INTO communities (
        community_id, display_name, status, artist_governance_state, membership_mode,
        default_age_gate_policy, donation_policy_mode, donation_partner_status,
        governance_mode, created_by_user_id, created_at, updated_at
      ) VALUES (
        'cmt_existing', 'Existing', 'active', 'fan_run', 'open', 'none', 'none',
        'unconfigured', 'centralized', 'usr_existing',
        '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:00.000Z'
      )
    `).run()
    db.query(`
      INSERT INTO community_jobs (
        job_id, community_id, job_type, subject_type, subject_id, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'cjb_existing', 'cmt_existing', 'post_publish_finalize', 'post', 'pst_existing',
        'running', 1, '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:00.000Z'
      )
    `).run()

    applyMigrations(db, [
      "1128_community_job_attempt_leases.sql",
      "1129_story_registration_effects.sql",
      "1130_story_registration_effect_request_identity.sql",
    ])

    expect(db.query<{ status: string; attempt_id: string | null }, []>(
      "SELECT status, attempt_id FROM community_jobs WHERE job_id='cjb_existing'",
    ).get()).toEqual({ status: "running", attempt_id: null })
  })
})
