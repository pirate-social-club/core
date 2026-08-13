/** Generate a production-free canonical pre-1157 fixture at a row multiplier. */

import { Database } from "bun:sqlite"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { dumpD1CompatibleSql } from "./sanitize-production-shape-rehearsal"

export const BASELINE_ROWS = {
  posts: 29,
  assets: 28,
  post_publish_requests: 22,
  moderation_actions: 3,
} as const

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index === -1 ? undefined : Bun.argv[index + 1]
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = argument(name) ?? (fallback === undefined ? undefined : String(fallback))
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

async function applyPreMigrationSchema(db: Database, migrationsDir: string): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort()
  const target = files.indexOf("1157_generic_assets_learning_foundation.sql")
  if (target < 1) throw new Error("1157 migration not found after a pre-migration history")
  for (const file of files.slice(0, target)) db.exec(await readFile(join(migrationsDir, file), "utf8"))
}

export async function generateScaleFixture(input: {
  database: string
  migrationsDir: string
  factor: number
  paddingBytes: number
}): Promise<Record<string, number>> {
  if (input.factor !== 100 && input.factor !== 1000) throw new Error("factor must be exactly 100 or 1000")
  const db = new Database(input.database, { create: true, strict: true })
  try {
    await applyPreMigrationSchema(db, input.migrationsDir)
    db.exec("PRAGMA foreign_keys = OFF")
    const padding = "x".repeat(input.paddingBytes)
    const transaction = db.transaction(() => {
      db.query(`
        INSERT INTO communities (
          community_id, display_name, status, artist_governance_state,
          membership_mode, default_age_gate_policy, donation_policy_mode,
          donation_partner_status, governance_mode, created_by_user_id,
          created_at, updated_at
        ) VALUES (
          'synthetic_community', 'Synthetic rehearsal', 'active', 'fan_run',
          'open', 'none', 'none', 'unconfigured', 'centralized',
          'synthetic_operator', '2026-08-13', '2026-08-13'
        )
      `).run()
      const post = db.prepare(`
        INSERT INTO posts (
          post_id, community_id, author_user_id, identity_mode, post_type, status,
          title, body, analysis_state, content_safety_state, age_gate_policy,
          created_at, updated_at, idempotency_key
        ) VALUES (?1, 'synthetic_community', ?2, 'public', 'text', 'published',
                  ?3, ?3, 'allow', 'safe', 'none', '2026-08-13', '2026-08-13', ?4)
      `)
      const postRows = BASELINE_ROWS.posts * input.factor
      for (let index = 0; index < postRows; index += 1) {
        const id = `synthetic_post_${input.factor}_${String(index).padStart(8, "0")}`
        post.run(id, `synthetic_user_${String(index).padStart(8, "0")}`, padding, `idem_${id}`)
      }

      const asset = db.prepare(`
        INSERT INTO assets (
          asset_id, community_id, source_post_id, creator_user_id, asset_kind,
          rights_basis, access_mode, primary_content_ref, primary_content_hash,
          publication_status, story_status, locked_delivery_status,
          display_title, created_at, updated_at
        ) VALUES (?1, 'synthetic_community', ?2, ?3, 'song_audio', 'original',
                  'public', ?4, ?5, 'draft', 'none', 'none', ?6,
                  '2026-08-13', '2026-08-13')
      `)
      const assetRows = BASELINE_ROWS.assets * input.factor
      for (let index = 0; index < assetRows; index += 1) {
        const suffix = String(index).padStart(8, "0")
        asset.run(
          `synthetic_asset_${input.factor}_${suffix}`,
          `synthetic_post_${input.factor}_${suffix}`,
          `synthetic_user_${suffix}`,
          `synthetic:content:${suffix}`,
          `sha256:synthetic:${suffix}`,
          padding,
        )
      }

      const publish = db.prepare(`
        INSERT INTO post_publish_requests (
          post_publish_request_id, community_id, post_id, publish_mode,
          request_body_hash, listing_draft_json, publish_options_json, status,
          created_at, updated_at
        ) VALUES (?1, 'synthetic_community', ?2, 'async', ?3, ?4, ?4,
                  'succeeded', '2026-08-13', '2026-08-13')
      `)
      const publishRows = BASELINE_ROWS.post_publish_requests * input.factor
      for (let index = 0; index < publishRows; index += 1) {
        const suffix = String(index).padStart(8, "0")
        publish.run(
          `synthetic_publish_${input.factor}_${suffix}`,
          `synthetic_post_${input.factor}_${suffix}`,
          `sha256:request:${suffix}`,
          JSON.stringify({ padding }),
        )
      }

      const moderation = db.prepare(`
        INSERT INTO moderation_actions (
          moderation_action_id, moderation_case_id, community_id, post_id,
          actor_user_id, action_type, note, created_at,
          previous_post_status, next_post_status
        ) VALUES (?1, ?2, 'synthetic_community', ?3, 'synthetic_operator',
                  'hide', ?4, '2026-08-13', 'published', 'hidden')
      `)
      const moderationCase = db.prepare(`
        INSERT INTO moderation_cases (
          moderation_case_id, community_id, post_id, status, queue_scope,
          priority, opened_by, created_at, updated_at, resolved_at
        ) VALUES (?1, 'synthetic_community', ?2, 'resolved', 'community',
                  'low', 'platform_analysis', '2026-08-13', '2026-08-13', '2026-08-13')
      `)
      const moderationRows = BASELINE_ROWS.moderation_actions * input.factor
      for (let index = 0; index < moderationRows; index += 1) {
        const suffix = String(index).padStart(8, "0")
        const caseId = `synthetic_case_${input.factor}_${suffix}`
        const postId = `synthetic_post_${input.factor}_${suffix}`
        moderationCase.run(caseId, postId)
        moderation.run(
          `synthetic_action_${input.factor}_${suffix}`,
          caseId,
          postId,
          padding,
        )
      }
    })
    transaction.immediate()
    const foreignKeyViolations = db.query<Record<string, unknown>, []>("PRAGMA foreign_key_check").all()
    if (foreignKeyViolations.length !== 0) {
      throw new Error(`synthetic fixture has ${foreignKeyViolations.length} foreign-key violations`)
    }
    db.exec("PRAGMA optimize")
    return Object.fromEntries(Object.entries(BASELINE_ROWS).map(([table, rows]) => [table, rows * input.factor]))
  } finally {
    db.close()
  }
}

async function main(): Promise<void> {
  const factor = positiveInteger("--factor")
  const paddingBytes = positiveInteger("--padding-bytes", 1024)
  const database = resolve(argument("--database") ?? `tmp/generic-assets-scale-${factor}.sqlite`)
  const outputSql = resolve(argument("--output-sql") ?? `tmp/generic-assets-scale-${factor}.sql`)
  const manifest = resolve(argument("--manifest") ?? `tmp/generic-assets-scale-${factor}.json`)
  const migrationsDir = resolve(argument("--migrations-dir") ?? "db/community-template/migrations")
  await mkdir(dirname(database), { recursive: true })
  const rowCounts = await generateScaleFixture({ database, migrationsDir, factor, paddingBytes })
  await dumpD1CompatibleSql(database, outputSql)
  const output = {
    generated_at: new Date().toISOString(),
    factor,
    padding_bytes: paddingBytes,
    row_counts: rowCounts,
    database_size_bytes: Bun.file(database).size,
    sql_size_bytes: Bun.file(outputSql).size,
  }
  await writeFile(manifest, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify(output, null, 2))
}

if (import.meta.main) await main()
