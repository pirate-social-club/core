#!/usr/bin/env bun
/**
 * READ-ONLY fleet audit: community-template migration SET-CLOSURE.
 *
 * "Does every active allocated shard carry EVERY community-template migration —
 * the ledger row AND the schema objects the migration creates — minus a small,
 * documented exception set?"
 *
 * Why this exists
 * ---------------
 * The 2026-08-03 read-only production attestation (105 active shards) found
 * DB_CMTY_0078 and DB_CMTY_0079 — zero-content smoke-test communities copied
 * verbatim from Turso during the 2026-07-01 cutover — missing BOTH the ledger
 * rows and the columns for
 *
 *   1095_community_assistant_telegram_preview_prompt_suffix.sql
 *   1096_community_karaoke_enabled.sql
 *   1098_community_karaoke_scoring_policy.sql        (numbering jumps 1096 -> 1098)
 *
 * while their ledgers otherwise advanced to the head (1150). Every existing check
 * missed it for a month: per-migration rollout scripts only ever ask about ONE
 * migration, and the release gate's canonical comparison runs against a ratcheted
 * baseline that had codified the drift as accepted profiles. Nothing asserted
 * ledger/object set closure across the whole template set. This audit is that
 * assertion. The operator catch-up for the skipped block is
 * apply-karaoke-policy-columns-d1-migration.ts.
 *
 * What it reports, per shard per migration
 * ----------------------------------------
 *   ok                      ledger row with an acceptable checksum AND every
 *                           expected schema object present
 *   ledger_missing          no ledger row, but every expected object present
 *                           (or the migration is ledger-only) -> backfill candidate
 *   objects_missing         no ledger row AND expected objects absent -> the shard
 *                           skipped the migration (the DB_CMTY_0078/0079 case)
 *   ledger_without_objects  ledger row present but objects absent — the ledger lies
 *   checksum_mismatch       the ledger records DIFFERENT bytes for that migration
 *
 * Expected objects are DERIVED from each migration file with the release gate's
 * artifact deriver (community-schema-artifacts.ts: CREATE TABLE, ALTER TABLE ADD
 * COLUMN, CREATE/DROP INDEX), then intersected with the CURRENT canonical schema
 * (all non-exempt migrations applied in memory, same as the gate's canonical
 * comparison): an object a LATER migration intentionally removed — e.g. the
 * index 1106's booking_payment_intents rebuild chose not to recreate — is no
 * longer part of the template contract and is not required. A migration
 * containing anything the deriver does not recognize — table rebuilds, triggers,
 * data updates, or plain-comment / SELECT-1 ledger stubs such as 1064/1080 — is
 * attested LEDGER-ONLY: its derived object list is untrustworthy (a rebuild's
 * `x_next` table is renamed away), so only its ledger row + checksum are
 * required. Derived objects are never silently trusted, and never silently
 * skipped either.
 *
 * A ledger checksum is acceptable when it matches the current file bytes or a
 * documented oldChecksum in db/known-community-migration-drifts.json whose
 * newChecksum pins the current bytes (check:migrations enforces that pin).
 *
 * Two directions of closure
 * -------------------------
 * Template -> shard: every template migration is present on every shard (above).
 * Shard -> template: every ledger row on a shard names a file that still exists
 * in the template dir, or sits in the deleted-migrations registry below. A row
 * naming neither is an unknown_ledger_entry and FAILS the audit — otherwise a
 * deleted migration (1097_purchase_allocation_legs_performer.sql, still ledgered
 * on shards migrated from the pre-cutover branches, e.g. DB_CMTY_0077) stays a
 * permanent blind spot in the check built to close blind spots. The registry is
 * how a deletion becomes a deliberate, reviewed act instead of silent tolerance.
 *
 * Exceptions
 * ----------
 * Migrations NO active shard is expected to carry are an explicit in-code list
 * below, each with a one-line reason and review/expiry dates (the same
 * discipline as community-shard-quarantines.json). The list is fail-closed: an
 * exception naming a file that no longer exists in the template dir, or one past
 * expires_at, is an ERROR — the list can never rot into a blanket waiver.
 *
 * Fleet discipline (same as lib/fleet-d1-migration.ts, whose pool query, binding
 * resolution, quarantine partition and wrangler transport this reuses)
 * ----------------------------------------------------------------------
 * - The pool is authoritative. Zero allocated+loaded shards is an error.
 * - An allocated shard absent from the shard config is an ERROR, never skipped.
 * - Quarantined shards are still probed and their gaps reported in their OWN
 *   section — never silently dropped — but they do not decide fleet closure.
 * - READ-ONLY. There is no --execute and no resume file: only a full pass over
 *   the whole fleet means anything, so every run IS a full pass.
 *
 * Exit code: 0 = every live allocated shard carries every non-exempt migration
 * and every ledger row is explained; 1 = gaps, unknown ledger entries,
 * unreachable shards, config drift, or any other error.
 */

import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { expectedArtifacts, type Artifacts } from "./community-schema-artifacts"
import { partitionQuarantinedBindings } from "./lib/community-shard-quarantine"
import { loadedBindings, shardMap, wranglerJson } from "./lib/fleet-d1-migration"
import { decideRolloutProvenance, probeConfigRepoProvenance } from "./lib/rollout-provenance"
import { buildCanonicalSchemaArtifacts } from "./verify-community-schema-requirements"

export type FleetClosureException = {
  migration: string
  reason: string
  approved_at: string
  review_after: string
  expires_at: string
}

/**
 * Migrations no active shard is expected to carry. EVERY other file in
 * db/community-template/migrations is expected on every active shard.
 * Both entries verified against the committed 2026-08-03 production attestation
 * fixture (fixtures/schema-attestation-ledger/production-30438236181.json) and
 * the api provisioning snapshot (api repo
 * services/api/src/lib/communities/provisioning/generated/community-schema-snapshot.ts).
 */
export const FLEET_CLOSURE_EXCEPTIONS: readonly FleetClosureException[] = [
  {
    migration: "1116_buyer_funding_tx_single_use.sql",
    reason:
      "Never fleet-rolled (index absent on 89/104 prod shards in the 2026-08-03 attestation); " +
      "reaches shards only via the provisioning schema snapshot.",
    approved_at: "2026-08-03T00:00:00Z",
    review_after: "2026-09-02T00:00:00Z",
    expires_at: "2026-11-01T00:00:00Z",
  },
  {
    migration: "1122_live_room_audience_gates.sql",
    reason:
      "Never fleet-rolled (column absent on 90/104 prod shards in the 2026-08-03 attestation); " +
      "snapshot-only propagation per specs/domain/livestream-audience-gates.md.",
    approved_at: "2026-08-03T00:00:00Z",
    review_after: "2026-09-02T00:00:00Z",
    expires_at: "2026-11-01T00:00:00Z",
  },
]

/**
 * A migration file that no longer exists in the template dir but may legitimately
 * still appear in shard LEDGERS. `deleted_in` is the commit that removed it from
 * the template — or, when the file never landed on main at all, a note saying so
 * plus the commit that last carried it.
 */
export type DeletedMigrationRecord = {
  migration: string
  reason: string
  deleted_in: string
  approved_at: string
  review_after: string
  expires_at: string
}

/**
 * Deleted-migration registry — the shard->template direction of closure. A shard
 * ledger row naming a file that is in NEITHER the template dir NOR this registry
 * is an unknown_ledger_entry and fails the audit; a row naming a registered file
 * is reported as acknowledged, not as a failure.
 *
 * Same fail-closed discipline as FLEET_CLOSURE_EXCEPTIONS: an entry whose file
 * RE-APPEARS in the template dir is an error (a restored file must leave the
 * registry and return to normal template expectations), and an expired entry is
 * an error, so the registry can never rot into silent tolerance.
 */
export const DELETED_TEMPLATE_MIGRATIONS: readonly DeletedMigrationRecord[] = [
  {
    migration: "1097_purchase_allocation_legs_performer.sql",
    reason:
      "Added 2026-06-22 in 062e750 on the pre-cutover branches; the 2026-07-04 restore to main (#63) " +
      "brought back 1095/1096/1098 but deliberately not 1097. Shards migrated during that window " +
      "(e.g. DB_CMTY_0077) retain the ledger row.",
    // There is no deletion commit: `git log --diff-filter=D` over the template dir
    // is empty across all refs — the file never landed on main, so main never
    // deleted it.
    deleted_in: "never merged to main; last carried by 062e750",
    approved_at: "2026-08-03T00:00:00Z",
    review_after: "2026-09-02T00:00:00Z",
    expires_at: "2026-11-01T00:00:00Z",
  },
]

export type MigrationExpectation = {
  migration: string
  /** sha256 of the current file bytes. */
  checksum: string
  /** Current checksum plus documented, repo-reviewed alternates. */
  acceptableChecksums: readonly string[]
  /**
   * Objects this migration creates that the CURRENT template still expects to
   * exist: the derived artifacts intersected with the canonical final schema, so
   * an object a later migration intentionally removed is not required.
   */
  artifacts: Artifacts
  /**
   * false = attested by ledger row + checksum ONLY. The deriver found DDL it does
   * not recognize, so its object list is incomplete or outright wrong (rebuilds
   * rename their `*_next` tables away). Ledger stubs (1064/1080) land here too.
   */
  attestable: boolean
}

function instant(value: string, field: string, owner: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`${owner}: ${field} must be an ISO-8601 timestamp`)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${owner}: ${field} is invalid`)
  }
  return parsed
}

/**
 * The expected migration set: every template file minus the documented exceptions,
 * with derived objects and acceptable checksums. Fail-closed on exception rot so
 * the waiver list can never silently outlive the file it names.
 */
export async function buildFleetExpectations(input: {
  migrationsDir: string
  driftPolicyPath?: string
  exceptions?: readonly FleetClosureException[]
  deletedMigrations?: readonly DeletedMigrationRecord[]
  now?: number
}): Promise<{
  expectations: MigrationExpectation[]
  exceptions: readonly FleetClosureException[]
  deletedMigrations: readonly DeletedMigrationRecord[]
  /** Every file currently in the template dir, exceptions included. */
  templateMigrations: ReadonlySet<string>
}> {
  const now = input.now ?? Date.now()
  const exceptions = input.exceptions ?? FLEET_CLOSURE_EXCEPTIONS
  const files = (await readdir(input.migrationsDir)).filter((n) => n.endsWith(".sql")).sort()
  const names = new Set(files)

  const exempt = new Set<string>()
  const seen = new Set<string>()
  for (const exception of exceptions) {
    if (seen.has(exception.migration)) {
      throw new Error(`duplicate set-closure exception ${exception.migration}`)
    }
    seen.add(exception.migration)
    if (!names.has(exception.migration)) {
      throw new Error(
        `set-closure exception ${exception.migration} no longer exists in ${input.migrationsDir} — ` +
          "remove the exception or restore the file; the list must never rot into a blanket waiver",
      )
    }
    if (typeof exception.reason !== "string" || !exception.reason.trim()) {
      throw new Error(`set-closure exception ${exception.migration}: reason is required`)
    }
    const approved = instant(exception.approved_at, "approved_at", `set-closure exception ${exception.migration}`)
    const review = instant(exception.review_after, "review_after", `set-closure exception ${exception.migration}`)
    const expires = instant(exception.expires_at, "expires_at", `set-closure exception ${exception.migration}`)
    if (!(approved <= review && review < expires)) {
      throw new Error(`set-closure exception ${exception.migration}: require approved_at <= review_after < expires_at`)
    }
    if (expires <= now) {
      throw new Error(
        `set-closure exception ${exception.migration} expired at ${exception.expires_at}; renew or remove it explicitly`,
      )
    }
    exempt.add(exception.migration)
  }

  const deletedMigrations = input.deletedMigrations ?? DELETED_TEMPLATE_MIGRATIONS
  const deletedSeen = new Set<string>()
  for (const record of deletedMigrations) {
    const owner = `deleted-migration registry entry ${record.migration}`
    if (deletedSeen.has(record.migration)) {
      throw new Error(`duplicate ${owner}`)
    }
    deletedSeen.add(record.migration)
    if (names.has(record.migration)) {
      throw new Error(
        `${owner} exists in ${input.migrationsDir} — ` +
          "a restored file must leave the registry and return to normal template expectations",
      )
    }
    if (typeof record.reason !== "string" || !record.reason.trim()) {
      throw new Error(`${owner}: reason is required`)
    }
    if (typeof record.deleted_in !== "string" || !record.deleted_in.trim()) {
      throw new Error(`${owner}: deleted_in (commit or documented note) is required`)
    }
    const approved = instant(record.approved_at, "approved_at", owner)
    const review = instant(record.review_after, "review_after", owner)
    const expires = instant(record.expires_at, "expires_at", owner)
    if (!(approved <= review && review < expires)) {
      throw new Error(`${owner}: require approved_at <= review_after < expires_at`)
    }
    if (expires <= now) {
      throw new Error(`${owner} expired at ${record.expires_at}; renew or remove it explicitly`)
    }
  }

  // Documented alternate ledger checksums. An oldChecksum is accepted only when
  // the repair's newChecksum is the CURRENT file hash — a stale repair entry
  // accepts nothing.
  const repairs = new Map<string, Array<{ oldChecksum: string; newChecksum: string }>>()
  if (input.driftPolicyPath) {
    const policy = JSON.parse(await readFile(input.driftPolicyPath, "utf8")) as {
      communityTemplate?: { checksumRepairs?: unknown }
    }
    const entries = policy?.communityTemplate?.checksumRepairs
    if (!Array.isArray(entries)) {
      throw new Error(`${input.driftPolicyPath}: communityTemplate.checksumRepairs must be an array`)
    }
    for (const entry of entries as Array<Record<string, unknown>>) {
      const migrationName = String(entry?.migrationName ?? "")
      const oldChecksum = String(entry?.oldChecksum ?? "")
      const newChecksum = String(entry?.newChecksum ?? "")
      if (!migrationName || !/^[0-9a-f]{64}$/u.test(oldChecksum) || !/^[0-9a-f]{64}$/u.test(newChecksum)) {
        throw new Error(`${input.driftPolicyPath}: malformed checksum repair for "${migrationName}"`)
      }
      const list = repairs.get(migrationName) ?? []
      list.push({ oldChecksum, newChecksum })
      repairs.set(migrationName, list)
    }
  }

  // The canonical final schema of the non-exempt template, built exactly like the
  // release gate builds it. Objects a later migration removed are absent here and
  // therefore dropped from the earlier migration's expectations below.
  const canonical = await buildCanonicalSchemaArtifacts({
    migrationsDir: input.migrationsDir,
    excludedMigrations: exempt,
  })

  const expectations: MigrationExpectation[] = []
  for (const name of files) {
    if (exempt.has(name)) continue
    const sql = await readFile(resolve(input.migrationsDir, name), "utf8")
    const checksum = createHash("sha256").update(sql).digest("hex")
    const acceptable = new Set([checksum])
    for (const repair of repairs.get(name) ?? []) {
      if (repair.newChecksum === checksum) acceptable.add(repair.oldChecksum)
    }
    const derived = expectedArtifacts(sql)
    const artifacts: Artifacts = {
      tables: derived.tables.filter((table) => canonical.has(`table:${table}`)),
      columns: derived.columns.filter(([table, column]) => canonical.has(`column:${table}.${column}`)),
      indexes: derived.indexes.filter((index) => canonical.has(`index:${index}`)),
      absentIndexes: derived.absentIndexes.filter((index) => !canonical.has(`index:${index}`)),
      altered: [...new Set(
        derived.columns
          .filter(([table, column]) => canonical.has(`column:${table}.${column}`))
          .map(([table]) => table),
      )],
      unrecognized: derived.unrecognized,
    }
    expectations.push({
      migration: name,
      checksum,
      acceptableChecksums: [...acceptable],
      artifacts,
      attestable: derived.unrecognized.length === 0,
    })
  }
  return { expectations, exceptions, deletedMigrations, templateMigrations: names }
}

/** Tables the audit must read column lists for: everything an attestable migration ALTERs. */
export function probedTables(expectations: readonly MigrationExpectation[]): string[] {
  const tables = new Set<string>()
  for (const expectation of expectations) {
    if (!expectation.attestable) continue
    for (const table of expectation.artifacts.altered) tables.add(table)
  }
  return [...tables].sort()
}

/**
 * Per-shard fetch: THREE bounded queries regardless of fleet or template size —
 * the full ledger, the table/index inventory, and one combined column probe.
 */
export const LEDGER_DUMP_SQL =
  "SELECT migration_name, checksum FROM schema_migrations ORDER BY migration_name"
export const SCHEMA_OBJECTS_SQL =
  "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"

export function columnProbeSql(tables: readonly string[]): string {
  if (tables.length === 0) throw new Error("columnProbeSql requires at least one table")
  return `SELECT\n  ${tables
    .map((table) => {
      if (!/^\w+$/u.test(table)) throw new Error(`unsafe table name in column probe: ${table}`)
      return `(SELECT json_group_array(name) FROM pragma_table_info('${table}')) AS "cols_${table}"`
    })
    .join(",\n  ")}`
}

/** Everything the classification needs from one shard. Pure data — unit-testable. */
export type ShardSchemaSnapshot = {
  /** migration_name -> ledger checksum. */
  ledger: ReadonlyMap<string, string>
  tables: ReadonlySet<string>
  indexes: ReadonlySet<string>
  /** table -> column names (only probedTables are populated). */
  columns: ReadonlyMap<string, ReadonlySet<string>>
}

export function snapshotFromRows(input: {
  ledgerRows: Array<Record<string, unknown>>
  objectRows: Array<Record<string, unknown>>
  columnRow: Record<string, unknown>
  probedTables: readonly string[]
}): ShardSchemaSnapshot {
  const ledger = new Map<string, string>()
  for (const row of input.ledgerRows) {
    const name = String(row.migration_name ?? "")
    if (name) ledger.set(name, String(row.checksum ?? ""))
  }
  const tables = new Set<string>()
  const indexes = new Set<string>()
  for (const row of input.objectRows) {
    const name = String(row.name ?? "")
    if (!name) continue
    if (row.type === "table") tables.add(name)
    else if (row.type === "index") indexes.add(name)
  }
  const columns = new Map<string, ReadonlySet<string>>()
  for (const table of input.probedTables) {
    const raw = input.columnRow[`cols_${table}`]
    const names: unknown[] = typeof raw === "string" ? JSON.parse(raw) : []
    columns.set(table, new Set(names.map(String)))
  }
  return { ledger, tables, indexes, columns }
}

export type ClosureGapStatus =
  | "ledger_missing"
  | "objects_missing"
  | "ledger_without_objects"
  | "checksum_mismatch"

export type MigrationGap = {
  migration: string
  status: ClosureGapStatus
  detail: string
}

function missingObjects(artifacts: Artifacts, snapshot: ShardSchemaSnapshot): string[] {
  const missing: string[] = []
  for (const table of artifacts.tables) {
    if (!snapshot.tables.has(table)) missing.push(`table:${table}`)
  }
  for (const [table, column] of artifacts.columns) {
    if (!snapshot.columns.get(table)?.has(column)) missing.push(`column:${table}.${column}`)
  }
  for (const index of artifacts.indexes) {
    if (!snapshot.indexes.has(index)) missing.push(`index:${index}`)
  }
  for (const index of artifacts.absentIndexes) {
    if (snapshot.indexes.has(index)) missing.push(`unexpected_index:${index}`)
  }
  return missing
}

function bounded(objects: string[]): string {
  const shown = objects.slice(0, 8)
  const rest = objects.length - shown.length
  return shown.join(", ") + (rest > 0 ? `, … +${rest} more` : "")
}

/** Pure per-shard classification over an already-fetched snapshot. */
export function classifyShardClosure(
  expectations: readonly MigrationExpectation[],
  snapshot: ShardSchemaSnapshot,
): MigrationGap[] {
  const gaps: MigrationGap[] = []
  for (const expectation of expectations) {
    const recorded = snapshot.ledger.get(expectation.migration)
    if (recorded !== undefined) {
      if (!expectation.acceptableChecksums.includes(recorded)) {
        gaps.push({
          migration: expectation.migration,
          status: "checksum_mismatch",
          detail: `ledger=${recorded.slice(0, 12)} expected=${expectation.checksum.slice(0, 12)}`,
        })
        continue
      }
      if (expectation.attestable) {
        const missing = missingObjects(expectation.artifacts, snapshot)
        if (missing.length > 0) {
          gaps.push({
            migration: expectation.migration,
            status: "ledger_without_objects",
            detail: `ledger records it but missing: ${bounded(missing)}`,
          })
        }
      }
      continue
    }
    if (expectation.attestable) {
      const missing = missingObjects(expectation.artifacts, snapshot)
      if (missing.length > 0) {
        gaps.push({
          migration: expectation.migration,
          status: "objects_missing",
          detail: `no ledger row and missing: ${bounded(missing)}`,
        })
        continue
      }
    }
    gaps.push({
      migration: expectation.migration,
      status: "ledger_missing",
      detail: expectation.attestable
        ? "objects present but the ledger row is absent"
        : "ledger-only migration (unrecognized DDL or stub); ledger row absent",
    })
  }
  return gaps
}

export type LedgerEntryNote = {
  migration: string
  status: "acknowledged_deleted" | "unknown_ledger_entry"
  detail: string
}

/**
 * The shard->template direction of closure: ledger rows naming migration files
 * that no longer exist in the template dir. Rows named in the deleted-migrations
 * registry are acknowledged (a reviewed deletion); anything else is an
 * unknown_ledger_entry and fails closure.
 */
export function diffShardLedger(
  snapshot: ShardSchemaSnapshot,
  templateMigrations: ReadonlySet<string>,
  deletedMigrations: readonly DeletedMigrationRecord[],
): LedgerEntryNote[] {
  const deleted = new Map(deletedMigrations.map((record) => [record.migration, record]))
  const notes: LedgerEntryNote[] = []
  for (const name of snapshot.ledger.keys()) {
    if (templateMigrations.has(name)) continue
    const record = deleted.get(name)
    notes.push(
      record
        ? {
            migration: name,
            status: "acknowledged_deleted",
            detail: `ledger row retained for a migration deleted from the template (${record.deleted_in})`,
          }
        : {
            migration: name,
            status: "unknown_ledger_entry",
            detail: "ledger row names a migration absent from both the template dir and the deleted-migrations registry",
          },
    )
  }
  return notes.sort((a, b) => a.migration.localeCompare(b.migration))
}

export type ShardClosureReport = {
  binding: string
  database_name: string
  bucket: "ok" | "gaps" | "unreachable"
  gaps: MigrationGap[]
  /** Shard->template findings: acknowledged deletions and unknown ledger entries. */
  ledgerEntries: LedgerEntryNote[]
  detail?: string
}

export type FleetClosureReport = {
  live: ShardClosureReport[]
  /** Quarantined shards: probed and reported, never silently dropped, never closure-deciding. */
  quarantined: ShardClosureReport[]
  /** Allocated in the pool but absent from the shard config — always an error. */
  missingFromConfig: Array<{ binding: string; detail: string }>
}

export async function auditFleetClosure(input: {
  expectations: readonly MigrationExpectation[]
  templateMigrations: ReadonlySet<string>
  deletedMigrations: readonly DeletedMigrationRecord[]
  live: Array<{ binding: string; name: string }>
  quarantined: Array<{ binding: string; name: string }>
  missingFromConfig: readonly string[]
  probe: (databaseName: string) => Promise<ShardSchemaSnapshot>
  concurrency: number
}): Promise<FleetClosureReport> {
  async function classifyAll(
    targets: Array<{ binding: string; name: string }>,
  ): Promise<ShardClosureReport[]> {
    const results: ShardClosureReport[] = []
    let idx = 0
    async function worker() {
      while (idx < targets.length) {
        const target = targets[idx++]
        try {
          const snapshot = await input.probe(target.name)
          const gaps = classifyShardClosure(input.expectations, snapshot)
          const ledgerEntries = diffShardLedger(snapshot, input.templateMigrations, input.deletedMigrations)
          const unknown = ledgerEntries.some((entry) => entry.status === "unknown_ledger_entry")
          results.push({
            binding: target.binding,
            database_name: target.name,
            bucket: gaps.length > 0 || unknown ? "gaps" : "ok",
            gaps,
            ledgerEntries,
          })
        } catch (error) {
          results.push({
            binding: target.binding,
            database_name: target.name,
            bucket: "unreachable",
            gaps: [],
            ledgerEntries: [],
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(input.concurrency, Math.max(targets.length, 1)) }, worker),
    )
    return results
  }

  return {
    live: await classifyAll(input.live),
    quarantined: await classifyAll(input.quarantined),
    missingFromConfig: input.missingFromConfig.map((binding) => ({
      binding,
      detail: "allocated+loaded in the pool but absent from the shard config — the config is stale",
    })),
  }
}

/** Closure is decided by the LIVE fleet only; quarantined gaps are reported separately. */
export function fleetClosed(report: FleetClosureReport): boolean {
  return report.missingFromConfig.length === 0 && report.live.every((r) => r.bucket === "ok")
}

type Options = {
  wranglerConfig: string
  migrationsDir: string
  env?: string
  poolDb: string
  quarantineRegistry: string
  driftPolicy: string
  prod: boolean
  manifest: string
  only?: string
  concurrency: number
  cwd: string
}

function usage(scriptPath: string): never {
  console.error(`
READ-ONLY audit: does every active allocated shard carry every community-template
migration (ledger row + derived schema objects), minus the documented exceptions?

  bun ${scriptPath} \\
    --wrangler-config ../api/services/community-d1-shard/wrangler.jsonc [options]

Options:
  --wrangler-config PATH   Shard wrangler.jsonc (lives in the api repo).
  --migrations-dir PATH    Default: db/community-template/migrations
  --prod                   Target the production fleet. Default: staging.
  --only DB_CMTY_BINDING   Debug a single pool binding (unlike the apply scripts,
                           which take a database NAME).
  --manifest PATH          Write the JSON report here.
  --quarantines PATH       Versioned quarantine registry.
  --drift-policy PATH      Documented checksum repairs.
                           Default: db/known-community-migration-drifts.json
  --concurrency N          Default 8.

There is no --execute and no resume file. Exit 0 = fleet closed; 1 = gaps,
unreachable shards, or error.
`)
  process.exit(1)
}

function parseArgs(scriptPath: string): Options {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const prod = argv.includes("--prod")
  const wranglerConfig = get("--wrangler-config")
  if (!wranglerConfig) usage(scriptPath)
  const concurrency = Number(get("--concurrency") ?? "8")
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${get("--concurrency")}"`)
  }
  return {
    wranglerConfig: resolve(wranglerConfig),
    migrationsDir: resolve(get("--migrations-dir") ?? "db/community-template/migrations"),
    env: prod ? "production" : undefined,
    poolDb: prod ? "community-d1-shard-pool-prod" : "community-d1-shard-pool-staging",
    quarantineRegistry: resolve(get("--quarantines") ?? resolve(import.meta.dir, "community-shard-quarantines.json")),
    driftPolicy: resolve(get("--drift-policy") ?? "db/known-community-migration-drifts.json"),
    prod,
    manifest: resolve(get("--manifest") ?? `tmp/community-template-set-closure-${prod ? "prod" : "staging"}.json`),
    only: get("--only"),
    concurrency,
    cwd: dirname(resolve(wranglerConfig)),
  }
}

async function fetchShardSnapshot(
  options: Pick<Options, "env" | "cwd">,
  db: string,
  tables: readonly string[],
): Promise<ShardSchemaSnapshot> {
  const ledgerRows = (
    await wranglerJson(options, db, ["--command", LEDGER_DUMP_SQL])
  )[0].results as Array<Record<string, unknown>>
  const objectRows = (
    await wranglerJson(options, db, ["--command", SCHEMA_OBJECTS_SQL])
  )[0].results as Array<Record<string, unknown>>
  const columnRow = tables.length > 0
    ? ((await wranglerJson(options, db, ["--command", columnProbeSql(tables)]))[0]
        .results[0] as Record<string, unknown>)
    : {}
  return snapshotFromRows({ ledgerRows, objectRows, columnRow, probedTables: tables })
}

function bucketCounts(reports: ShardClosureReport[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const report of reports) counts[report.bucket] = (counts[report.bucket] ?? 0) + 1
  return counts
}

function gapMatrix(reports: ShardClosureReport[]): Array<Record<string, string | number>> {
  const tally = new Map<string, number>()
  for (const report of reports) {
    for (const gap of report.gaps) {
      const key = `${gap.status}:${gap.migration}`
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
    for (const entry of report.ledgerEntries) {
      if (entry.status !== "unknown_ledger_entry") continue
      const key = `unknown_ledger_entry:${entry.migration}`
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
  }
  return [...tally.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, shards]) => {
      const separator = key.indexOf(":")
      return { status: key.slice(0, separator), migration: key.slice(separator + 1), shards }
    })
}

function ledgerEntryCounts(reports: ShardClosureReport[]): Record<string, number> {
  let unknown = 0
  let acknowledged = 0
  for (const report of reports) {
    for (const entry of report.ledgerEntries) {
      if (entry.status === "unknown_ledger_entry") unknown += 1
      else acknowledged += 1
    }
  }
  return { unknown_ledger_entries: unknown, acknowledged_deleted: acknowledged }
}

function printLedgerEntries(title: string, reports: ShardClosureReport[]): void {
  const withEntries = reports.filter((r) => r.ledgerEntries.length > 0)
  if (withEntries.length === 0) return
  console.log(`\n${title}:`)
  for (const report of withEntries) {
    for (const entry of report.ledgerEntries) {
      console.log(
        `  ${report.database_name} [${report.binding}] ` +
          `${entry.status === "unknown_ledger_entry" ? "UNKNOWN" : "acknowledged"}: ${entry.migration} — ${entry.detail}`,
      )
    }
  }
}

function printSection(title: string, reports: ShardClosureReport[]): void {
  const failing = reports.filter((r) => r.bucket !== "ok")
  if (failing.length === 0) return
  console.log(`\n${title}:`)
  for (const report of failing) {
    if (report.bucket === "unreachable") {
      console.log(`  ${report.database_name} [${report.binding}] UNREACHABLE: ${report.detail ?? ""}`)
      continue
    }
    console.log(`  ${report.database_name} [${report.binding}] gaps: ${report.gaps.length}`)
    for (const gap of report.gaps) {
      console.log(`    ${gap.status.padEnd(22)} ${gap.migration} — ${gap.detail}`)
    }
  }
}

async function main(scriptPath: string): Promise<void> {
  const options = parseArgs(scriptPath)

  // Config-side provenance: the shard config lives in the api repo, so attest
  // the checkout that produced it. This audit is read-only by construction —
  // it never blocks — but a stale config once showed a fleet tool 26 of ~205
  // bindings, so an anomaly gets a loud stderr warning, not a quiet log line.
  const configProbe = probeConfigRepoProvenance(options.wranglerConfig)
  const configProvenance = decideRolloutProvenance(configProbe.probe, {
    execute: false,
    allowNonMain: false,
  })
  if (configProvenance.failure !== null) {
    console.error(
      `\nWARNING config provenance: ${configProvenance.failure}\n` +
        "The report below may cover only a fraction of the fleet (the 26-of-205 failure shape).\n",
    )
  } else {
    console.log(`config provenance: ${configProvenance.reason}`)
  }

  const { expectations, exceptions, deletedMigrations, templateMigrations } = await buildFleetExpectations({
    migrationsDir: options.migrationsDir,
    driftPolicyPath: options.driftPolicy,
  })
  const tables = probedTables(expectations)
  const map = await shardMap(options)

  const allocatedBindings = await loadedBindings(options)
  // The pool is authoritative for "which shards are live". If it is empty, our
  // view of the fleet is broken — never treat that as "nothing to audit".
  if (allocatedBindings.length === 0) {
    throw new Error(
      `${options.poolDb} reported ZERO allocated+loaded shards. That is not a no-op — it means the pool query or environment is wrong. Refusing to continue.`,
    )
  }
  const partition = await partitionQuarantinedBindings(
    options.quarantineRegistry,
    options.prod ? "production" : "staging",
    allocatedBindings,
    new Set(map.keys()),
  )

  const missingFromConfig: string[] = []
  const live: Array<{ binding: string; name: string }> = []
  for (const binding of partition.live) {
    const entry = map.get(binding)
    if (!entry) {
      // NOT skippable: a stale config once hid live shards from a fleet migration.
      missingFromConfig.push(binding)
      continue
    }
    live.push({ binding, name: entry.name })
  }
  const quarantined = partition.quarantined.map((entry) => ({
    binding: entry.binding,
    name: map.get(entry.binding)!.name,
  }))

  if (options.only) {
    const inLive = live.filter((t) => t.binding === options.only)
    const inQuarantined = quarantined.filter((t) => t.binding === options.only)
    if (inLive.length + inQuarantined.length !== 1) {
      throw new Error(
        `--only ${options.only} matched ${inLive.length + inQuarantined.length} shards among the allocated+loaded set; expected exactly 1. Check the binding and the --prod flag.`,
      )
    }
    live.length = 0
    live.push(...inLive)
    quarantined.length = 0
    quarantined.push(...inQuarantined)
  }

  console.log(
    `fleet=${options.prod ? "PRODUCTION" : "staging"}  template files: ${expectations.length} expected ` +
      `(${expectations.filter((e) => e.attestable).length} object-attested, ` +
      `${expectations.filter((e) => !e.attestable).length} ledger-only), ${exceptions.length} documented exception(s), ` +
      `${deletedMigrations.length} acknowledged deletion(s)`,
  )
  for (const exception of exceptions) {
    console.log(`  exception: ${exception.migration} — ${exception.reason} (review ${exception.review_after})`)
  }
  for (const record of deletedMigrations) {
    console.log(`  deleted migration: ${record.migration} — ${record.reason} (review ${record.review_after})`)
  }
  console.log(
    `allocated+loaded: ${allocatedBindings.length}  live: ${live.length}  quarantined: ${quarantined.length}` +
      (missingFromConfig.length > 0 ? `  MISSING FROM CONFIG: ${missingFromConfig.length}` : ""),
  )

  const report = await auditFleetClosure({
    expectations,
    templateMigrations,
    deletedMigrations,
    live,
    quarantined,
    missingFromConfig,
    probe: (db) => fetchShardSnapshot(options, db, tables),
    concurrency: options.concurrency,
  })

  for (const r of report.live.filter((r) => r.bucket === "ok")) {
    console.log(`  ${r.database_name.padEnd(34)} ok`)
  }
  printSection("LIVE shards with gaps or errors", report.live)
  printLedgerEntries("Shard ledger rows naming files absent from the template (live fleet)", report.live)
  printSection("Quarantined shards (reported separately; do not decide closure)", report.quarantined)
  printLedgerEntries("Shard ledger rows naming files absent from the template (quarantined)", report.quarantined)
  for (const missing of report.missingFromConfig) {
    console.error(`  ${missing.binding}: ${missing.detail}`)
  }

  const liveSummary = { ...bucketCounts(report.live), ...ledgerEntryCounts(report.live) }
  const quarantinedSummary = { ...bucketCounts(report.quarantined), ...ledgerEntryCounts(report.quarantined) }
  const matrix = gapMatrix(report.live)
  if (matrix.length > 0) {
    console.log("\nper-migration gap matrix (live fleet):")
    for (const row of matrix) {
      console.log(`  ${String(row.status).padEnd(22)} ${row.migration} — ${row.shards} shard(s)`)
    }
  }

  await mkdir(dirname(options.manifest), { recursive: true })
  await writeFile(
    options.manifest,
    `${JSON.stringify(
      {
        fleet: options.prod ? "production" : "staging",
        audit: "community-template set closure",
        read_only: true,
        expected_migrations: expectations.map((e) => ({
          migration: e.migration,
          checksum: e.checksum,
          acceptable_checksums: e.acceptableChecksums,
          attestable: e.attestable,
        })),
        exceptions,
        deleted_migrations: deletedMigrations,
        shard_config: options.wranglerConfig,
        // Which checkout produced that config. null fields mean the audit could
        // not prove the config repo's state — see the stderr warning.
        config_provenance: {
          repoPath: configProbe.repoPath,
          headSha: configProvenance.provenance.headSha,
          branch: configProvenance.provenance.branch,
          onMain: configProvenance.provenance.onMain,
          dirty: configProvenance.provenance.dirty,
        },
        pool_db: options.poolDb,
        allocated_loaded_shards: allocatedBindings.length,
        live_shards: report.live.length,
        quarantined_shards: report.quarantined.length,
        quarantine_registry: options.quarantineRegistry,
        quarantine_registry_checksum: partition.registryChecksum,
        quarantines: partition.quarantined,
        missing_from_config: report.missingFromConfig,
        summary: { live: liveSummary, quarantined: quarantinedSummary },
        gap_matrix: matrix,
        shards: report.live,
        quarantined_shard_reports: report.quarantined,
        fleet_closed: fleetClosed(report),
      },
      null,
      2,
    )}\n`,
  )

  console.log(`\nsummary (live): ${JSON.stringify(liveSummary)}  (quarantined): ${JSON.stringify(quarantinedSummary)}`)
  console.log(`manifest: ${options.manifest}`)

  if (!fleetClosed(report)) {
    console.error(
      "\nFLEET NOT CLOSED: live shards have gaps, unknown ledger entries, are unreachable, or are missing " +
        "from the shard config. The catch-up path for a skipped contiguous block is a per-migration apply " +
        "script (e.g. apply-karaoke-policy-columns-d1-migration.ts); investigate ledger_without_objects, " +
        "checksum_mismatch, and unknown_ledger_entry by hand — never paper over them. A ledger row for a " +
        "genuinely deleted migration belongs in DELETED_TEMPLATE_MIGRATIONS with a reason and a review date.",
    )
    process.exit(1)
  }
  console.log(`\nFLEET CLOSED: all ${report.live.length} live allocated+loaded shards carry every expected migration.`)
}

if (import.meta.main) await main("scripts/community/audit-community-template-set-closure.ts")
