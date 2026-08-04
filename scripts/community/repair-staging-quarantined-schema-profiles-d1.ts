#!/usr/bin/env bun
/**
 * Converge the two exact, observed staging quarantine schema profiles.
 *
 * This is deliberately not a generic "replay missing ledger rows" tool. These
 * shards have final-head ledgers with historical gaps, and several skipped
 * migrations rebuild tables whose final artifacts already exist. Replaying the
 * ledger gap would therefore be destructive or fail on duplicate objects.
 *
 * The repair creates only the canonical tables proven absent on 2026-08-05:
 * - DB_CMTY_0016: the six booking tables and dance_attempt.
 * - DB_CMTY_FIXTURE / DB_CMTY_PILOT: the three replay tables and two streak tables.
 *
 * Dry-run is the default. Execution is staging-only, requires an origin/main
 * clean checkout, an explicit Time Travel confirmation, a config-known target,
 * and the exact reviewed pre-image. It never updates application rows or the
 * historical schema_migrations ledger; canonical artifact verification remains
 * authoritative, and migration row counts legitimately vary across the fleet.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { shardMap, wranglerJson } from "./lib/fleet-d1-migration"
import { decideRolloutProvenance, probeRolloutProvenance } from "./lib/rollout-provenance"

const PROFILE_BY_DATABASE = {
  "community-d1-pool-0016-staging": "bookings_and_dance",
  "cmty-d1-fixture-staging": "replay_and_streaks",
  "cmty-pilot-staging": "replay_and_streaks",
} as const

type Profile = (typeof PROFILE_BY_DATABASE)[keyof typeof PROFILE_BY_DATABASE]

const PROFILE_TABLES: Record<Profile, readonly string[]> = {
  bookings_and_dance: [
    "booking_holds",
    "bookings",
    "booking_settlement_effects",
    "booking_attendance_sessions",
    "booking_attendance_heartbeats",
    "booking_payment_intents",
    "dance_attempt",
  ],
  replay_and_streaks: [
    "live_room_recordings",
    "live_room_replay_assets",
    "live_room_replay_allocations",
    "song_engagement_days",
    "song_streaks",
  ],
}

const PROFILE_COLUMNS: Record<Profile, readonly { table: string; column: string }[]> = {
  bookings_and_dance: [
    { table: "bookings", column: "funding_wallet_address" },
    { table: "bookings", column: "settlement_review_version" },
    { table: "booking_settlement_effects", column: "signed_tx" },
    { table: "booking_settlement_effects", column: "coordinator_ref" },
    { table: "booking_payment_intents", column: "claimed_tx_ref" },
    { table: "booking_payment_intents", column: "platform_fee_bps" },
    { table: "posts", column: "idempotency_body_hash" },
    { table: "live_rooms", column: "audience_gate_json" },
    { table: "karaoke_attempt", column: "scoring_diagnostics_json" },
    { table: "song_engagement_days", column: "activity_timezone" },
    { table: "song_streaks", column: "timezone" },
    { table: "song_streaks", column: "timezone_updated_at" },
    { table: "song_streaks", column: "active_until_at" },
    { table: "moderation_actions", column: "previous_content_safety_state" },
    { table: "moderation_actions", column: "next_content_safety_state" },
    { table: "moderation_actions", column: "evidence_ref" },
  ],
  replay_and_streaks: [
    { table: "live_rooms", column: "recording_enabled" },
    { table: "live_rooms", column: "replay_asset_id" },
    { table: "live_rooms", column: "replay_listing_id" },
    { table: "live_room_replay_assets", column: "locked_delivery_secret_json" },
    { table: "live_room_replay_assets", column: "story_namespace" },
    { table: "live_room_replay_assets", column: "story_entitlement_token_id" },
    { table: "live_room_replay_assets", column: "story_read_condition" },
    { table: "live_room_replay_assets", column: "story_write_condition" },
    { table: "live_room_replay_assets", column: "locked_delivery_error" },
    { table: "song_engagement_days", column: "activity_timezone" },
    { table: "song_streaks", column: "timezone" },
    { table: "song_streaks", column: "timezone_updated_at" },
    { table: "song_streaks", column: "active_until_at" },
  ],
}

const PROFILE_INDEXES: Record<Profile, readonly string[]> = {
  bookings_and_dance: [
    "idx_booking_holds_active_slot",
    "idx_bookings_active_slot",
    "idx_booking_settlement_effects_idempotency",
    "idx_booking_attendance_sessions_booking",
    "idx_booking_payment_intents_claimed_tx",
    "idx_bookings_settlement_review_pending",
    "idx_dance_attempt_user_post",
    "idx_dance_attempt_revision_score",
    "idx_purchase_settlement_effects_funding_tx_singleuse",
    "idx_song_streaks_active",
  ],
  replay_and_streaks: [
    "idx_live_room_recordings_room",
    "idx_live_room_recordings_community_status",
    "idx_live_room_replay_assets_room",
    "idx_live_room_replay_assets_community_status",
    "idx_live_room_replay_allocations_asset",
    "idx_song_engagement_days_user_post",
    "idx_song_streaks_board",
    "idx_song_streaks_active",
  ],
}

const BOOKING_FOLLOWUP_FAILURES = new Set([
  "missing column posts.idempotency_body_hash",
  "missing column live_rooms.audience_gate_json",
  "missing column karaoke_attempt.scoring_diagnostics_json",
  "missing column song_engagement_days.activity_timezone",
  "missing column song_streaks.timezone",
  "missing column song_streaks.timezone_updated_at",
  "missing column song_streaks.active_until_at",
  "missing column moderation_actions.previous_content_safety_state",
  "missing column moderation_actions.next_content_safety_state",
  "missing column moderation_actions.evidence_ref",
  "missing index idx_purchase_settlement_effects_funding_tx_singleuse",
  "missing index idx_song_streaks_active",
])

type Options = {
  wranglerConfig: string
  cwd: string
  migrationsDir: string
  only: keyof typeof PROFILE_BY_DATABASE
  manifest: string
  execute: boolean
}

function usage(): never {
  console.error(`
Repair one reviewed staging quarantine schema profile.

  bun scripts/community/repair-staging-quarantined-schema-profiles-d1.ts \\
    --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc \\
    --only DATABASE_NAME [--execute --confirm-time-travel]

Dry-run by default. Production is intentionally unsupported.
`)
  process.exit(1)
}

function parseArgs(): Options {
  const argv = process.argv.slice(2)
  const value = (flag: string) => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const wranglerConfig = value("--wrangler-config")
  const only = value("--only") as keyof typeof PROFILE_BY_DATABASE | undefined
  if (!wranglerConfig || !only || !(only in PROFILE_BY_DATABASE) || argv.includes("--prod")) usage()
  const execute = argv.includes("--execute")
  if (execute && !argv.includes("--confirm-time-travel")) {
    throw new Error("--execute requires --confirm-time-travel")
  }
  return {
    wranglerConfig: resolve(wranglerConfig),
    cwd: dirname(resolve(wranglerConfig)),
    migrationsDir: resolve(value("--migrations-dir") ?? "db/community-template/migrations"),
    only,
    manifest: resolve(value("--manifest") ?? `tmp/repair-${only}.json`),
    execute,
  }
}

export function probeSql(profile: Profile): string {
  const tables = PROFILE_TABLES[profile]
    .map((table) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}') AS table__${table}`)
  const columns = PROFILE_COLUMNS[profile]
    .map(({ table, column }) => `(SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='${column}') AS column__${table}__${column}`)
  const indexes = PROFILE_INDEXES[profile]
    .map((index) => `(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='${index}') AS index__${index}`)
  const fragments = profile === "bookings_and_dance"
    ? [
        `(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dance_attempt' AND instr(sql, '''upload_invalid''') > 0) AS fragment__dance_upload_invalid`,
      ]
    : []
  return `SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='communities') AS required__communities,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='live_rooms') AS required__live_rooms,
  ${[...tables, ...columns, ...indexes, ...fragments].join(",\n  ")}`
}

type Probe = Record<string, number | string>

export function plan(profile: Profile, probe: Probe): "repair" | "converged" {
  if (Number(probe.required__communities) !== 1 || Number(probe.required__live_rooms) !== 1) {
    throw new Error("required base tables communities/live_rooms are not both present")
  }
  const tableValues = PROFILE_TABLES[profile].map((table) => Number(probe[`table__${table}`] ?? 0))
  const nonePresent = tableValues.every((value) => value === 0)
  const allPresent = tableValues.every((value) => value === 1)
  if (!nonePresent && !allPresent) {
    throw new Error(`unreviewed partial table state: ${PROFILE_TABLES[profile].map((t, i) => `${t}=${tableValues[i]}`).join(", ")}`)
  }
  if (allPresent) {
    const failures = convergenceFailures(profile, probe)
    if (failures.length > 0) {
      if (profile === "bookings_and_dance" && failures.every((failure) => BOOKING_FOLLOWUP_FAILURES.has(failure))) {
        return "repair"
      }
      throw new Error(`tables exist but profile is not canonical: ${failures.join("; ")}`)
    }
    return "converged"
  }
  if (profile === "replay_and_streaks") {
    const liveRoomColumns = ["recording_enabled", "replay_asset_id", "replay_listing_id"]
      .map((column) => Number(probe[`column__live_rooms__${column}`] ?? 0))
    if (!liveRoomColumns.every((value) => value === 0) && !liveRoomColumns.every((value) => value === 1)) {
      throw new Error(`unreviewed partial live_rooms replay-column state: ${liveRoomColumns.join(",")}`)
    }
  }
  return "repair"
}

export function convergenceFailures(profile: Profile, probe: Probe): string[] {
  const failures: string[] = []
  for (const table of PROFILE_TABLES[profile]) {
    if (Number(probe[`table__${table}`] ?? 0) !== 1) failures.push(`missing table ${table}`)
  }
  for (const { table, column } of PROFILE_COLUMNS[profile]) {
    if (Number(probe[`column__${table}__${column}`] ?? 0) !== 1) failures.push(`missing column ${table}.${column}`)
  }
  for (const index of PROFILE_INDEXES[profile]) {
    if (Number(probe[`index__${index}`] ?? 0) !== 1) failures.push(`missing index ${index}`)
  }
  if (profile === "bookings_and_dance" && Number(probe.fragment__dance_upload_invalid ?? 0) !== 1) {
    failures.push("dance_attempt reason_code CHECK does not admit upload_invalid")
  }
  return failures
}

async function migration(options: Options, name: string): Promise<string> {
  return (await readFile(resolve(options.migrationsDir, name), "utf8")).trim()
}

export async function repairSql(options: Options, profile: Profile, probe: Probe): Promise<string> {
  if (profile === "bookings_and_dance") {
    const tablesAlreadyPresent = PROFILE_TABLES.bookings_and_dance.every(
      (table) => Number(probe[`table__${table}`] ?? 0) === 1,
    )
    if (tablesAlreadyPresent) {
      const idempotencyColumn = "ALTER TABLE posts ADD COLUMN idempotency_body_hash TEXT;"
      const names = [
        "1116_buyer_funding_tx_single_use.sql",
        "1122_live_room_audience_gates.sql",
        "1123_song_engagement_activity_timezone.sql",
        "1144_karaoke_scoring_diagnostics.sql",
        "1149_song_streak_owner_timezone.sql",
        "1150_moderation_content_rating_audit.sql",
      ]
      return `${idempotencyColumn}\n\n${(await Promise.all(names.map((name) => migration(options, name)))).join("\n\n")}\n`
    }
    const names = [
      "1101_booking_holds_and_bookings.sql",
      "1102_booking_settlement_and_attendance.sql",
      "1103_booking_settlement_durable_submission.sql",
      "1104_booking_settlement_coordinator_mirror.sql",
      "1105_booking_payment_intents.sql",
      "1106_booking_payment_intent_verification.sql",
      "1107_booking_payment_intent_fee_snapshot.sql",
      "1108_booking_settlement_review.sql",
      "1145_dance_attempts.sql",
      "1146_dance_attempt_reason_contract.sql",
      "1147_dance_attempt_upload_invalid_reason.sql",
    ]
    return `${(await Promise.all(names.map((name) => migration(options, name)))).join("\n\n")}\n`
  }

  const recording = await migration(options, "1111_live_room_recordings.sql")
  const replayMigration = await migration(options, "1112_live_room_replay_assets.sql")
  const hasReplayColumns = Number(probe.column__live_rooms__recording_enabled ?? 0) === 1
  const replayStart = replayMigration.indexOf("CREATE TABLE live_room_replay_assets")
  if (replayStart === -1) throw new Error("1112 shape changed: replay table statement absent")
  const replaySql = hasReplayColumns
    ? replayMigration.slice(replayStart)
    : `${await migration(options, "1110_live_room_recording_enabled.sql")}\n\n${replayMigration}`
  const names = [
    "1113_live_room_replay_locked_delivery.sql",
    "1119_song_streaks.sql",
    "1123_song_engagement_activity_timezone.sql",
    "1149_song_streak_owner_timezone.sql",
  ]
  return `${recording}\n\n${replaySql}\n\n${(await Promise.all(names.map((name) => migration(options, name)))).join("\n\n")}\n`
}

async function main(): Promise<void> {
  const options = parseArgs()
  const profile = PROFILE_BY_DATABASE[options.only]
  const provenance = decideRolloutProvenance(
    probeRolloutProvenance(resolve(import.meta.dir, "../..")),
    { execute: options.execute, allowNonMain: false },
  )
  if (!provenance.allow) throw new Error(provenance.reason)

  const map = await shardMap({ wranglerConfig: options.wranglerConfig, prod: false })
  if (![...map.values()].some((entry) => entry.name === options.only)) {
    throw new Error(`target ${options.only} is absent from the staging shard config`)
  }
  const readProbe = async () => {
    const response = await wranglerJson({ cwd: options.cwd }, options.only, ["--command", probeSql(profile)])
    const row = response[0]?.results?.[0]
    if (!row || typeof row !== "object") throw new Error("probe returned no well-shaped row")
    return row as Probe
  }

  const before = await readProbe()
  const decision = plan(profile, before)
  const sql = await repairSql(options, profile, before)
  const record: Record<string, unknown> = {
    repair: "staging quarantined schema profile convergence",
    database: options.only,
    profile,
    executed: options.execute,
    decision,
    provenance: provenance.provenance,
    before,
    statementBytes: Buffer.byteLength(sql),
    observedAt: new Date().toISOString(),
  }

  if (decision === "repair" && options.execute) {
    const file = `/tmp/repair-${options.only}.sql`
    await writeFile(file, sql)
    await wranglerJson({ cwd: options.cwd }, options.only, ["--file", file])
    const after = await readProbe()
    record.after = after
    const failures = convergenceFailures(profile, after)
    if (failures.length > 0) throw new Error(`post-write verification failed: ${failures.join("; ")}`)
  }

  await mkdir(dirname(options.manifest), { recursive: true })
  await writeFile(options.manifest, `${JSON.stringify(record, null, 2)}\n`)
  console.log(`${options.only}: ${decision}${options.execute && decision === "repair" ? " -> converged" : ""}`)
  console.log(`manifest: ${options.manifest}`)
}

if (import.meta.main) await main()
