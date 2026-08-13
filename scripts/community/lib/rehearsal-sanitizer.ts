import { createHash, createHmac } from "node:crypto"
import type { Database } from "bun:sqlite"

export type SanitizationMode = "preserve" | "stable_text" | "mask_text" | "stable_blob"

export type SanitizationRule = {
  table: string
  column: string
  mode: SanitizationMode
}

export type RehearsalProfile = {
  rowCounts: Record<string, number>
  byteLengthDistributionSha256: string
  schemaMigrationsSha256: string
}

type TextOrBlobColumn = {
  table: string
  column: string
  declaredType: string
}

export type SanitizationInventoryEntry = TextOrBlobColumn & {
  rowCount: number
  nullCount: number
  distinctCount: number
  minimumByteLength: number | null
  maximumByteLength: number | null
  mode: SanitizationMode | "unresolved"
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function textOrBlobColumns(db: Database): TextOrBlobColumn[] {
  const tables = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all()
  return tables.flatMap(({ name: table }) =>
    db.query<{ name: string; type: string }, []>(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
      .filter(({ type }) => /(?:^|\W)(?:TEXT|CHAR|CLOB|BLOB)(?:\W|$)/iu.test(type))
      .map(({ name: column, type: declaredType }) => ({ table, column, declaredType })),
  )
}

export function sanitizationInventory(db: Database): SanitizationInventoryEntry[] {
  return textOrBlobColumns(db).map(({ table, column, declaredType }) => {
    const identifier = quoteIdentifier(column)
    const row = db.query<{
      row_count: number
      null_count: number
      distinct_count: number
      minimum_byte_length: number | null
      maximum_byte_length: number | null
    }, []>(`
      SELECT
        COUNT(*) AS row_count,
        SUM(CASE WHEN ${identifier} IS NULL THEN 1 ELSE 0 END) AS null_count,
        COUNT(DISTINCT ${identifier}) AS distinct_count,
        MIN(length(CAST(${identifier} AS BLOB))) AS minimum_byte_length,
        MAX(length(CAST(${identifier} AS BLOB))) AS maximum_byte_length
      FROM ${quoteIdentifier(table)}
    `).get()
    return {
      table,
      column,
      declaredType,
      rowCount: Number(row?.row_count ?? 0),
      nullCount: Number(row?.null_count ?? 0),
      distinctCount: Number(row?.distinct_count ?? 0),
      minimumByteLength: row?.minimum_byte_length ?? null,
      maximumByteLength: row?.maximum_byte_length ?? null,
      mode: table === "schema_migrations" ? "preserve" : "unresolved",
    }
  })
}

export function assertCompleteSanitizationRules(
  db: Database,
  rules: readonly SanitizationRule[],
): void {
  const expected = textOrBlobColumns(db)
  const byColumn = new Map<string, SanitizationRule>()
  for (const rule of rules) {
    const key = `${rule.table}\0${rule.column}`
    if (byColumn.has(key)) throw new Error(`duplicate sanitization rule for ${rule.table}.${rule.column}`)
    byColumn.set(key, rule)
  }
  const missing = expected.filter(({ table, column }) => !byColumn.has(`${table}\0${column}`))
  const unknown = [...byColumn.values()].filter((rule) =>
    !expected.some(({ table, column }) => table === rule.table && column === rule.column)
  )
  if (missing.length || unknown.length) {
    const detail = [
      ...missing.map(({ table, column }) => `missing:${table}.${column}`),
      ...unknown.map(({ table, column }) => `unknown:${table}.${column}`),
    ].join(", ")
    throw new Error(`sanitization manifest does not exactly cover TEXT/BLOB columns: ${detail}`)
  }
  for (const rule of rules) {
    if (rule.table === "schema_migrations" && rule.mode !== "preserve") {
      throw new Error("schema_migrations must be preserved verbatim, including drifted checksums")
    }
  }
}

function digestRows(rows: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex")
}

export function profileRehearsalDatabase(db: Database): RehearsalProfile {
  const tables = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }) => name)
  const rowCounts = Object.fromEntries(tables.map((table) => {
    const row = db.query<{ count: number }, []>(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`,
    ).get()
    return [table, Number(row?.count ?? 0)]
  }))
  const lengthDistribution = textOrBlobColumns(db).flatMap(({ table, column }) =>
    db.query<{ value_type: string; byte_length: number | null; value_count: number }, []>(`
      SELECT
        typeof(${quoteIdentifier(column)}) AS value_type,
        CASE WHEN ${quoteIdentifier(column)} IS NULL THEN NULL
             ELSE length(CAST(${quoteIdentifier(column)} AS BLOB)) END AS byte_length,
        COUNT(*) AS value_count
      FROM ${quoteIdentifier(table)}
      GROUP BY value_type, byte_length
      ORDER BY value_type, byte_length
    `).all().map((entry) => ({ table, column, ...entry })),
  )
  const migrationRows = tables.includes("schema_migrations")
    ? db.query<Record<string, unknown>, []>("SELECT * FROM schema_migrations ORDER BY migration_name, rowid").all()
    : []
  return {
    rowCounts,
    byteLengthDistributionSha256: digestRows(lengthDistribution),
    schemaMigrationsSha256: digestRows(migrationRows),
  }
}

function repeatedDigestBytes(salt: string, scope: string, value: Uint8Array, length: number): Uint8Array {
  const output = new Uint8Array(length)
  let offset = 0
  let counter = 0
  while (offset < length) {
    const digest = createHmac("sha256", salt)
      .update(scope)
      .update("\0")
      .update(value)
      .update("\0")
      .update(String(counter))
      .digest()
    const take = Math.min(digest.byteLength, length - offset)
    output.set(digest.subarray(0, take), offset)
    offset += take
    counter += 1
  }
  return output
}

function sanitizedText(salt: string, scope: string, value: string): string {
  const bytes = Buffer.from(value)
  if (bytes.byteLength === 0) return ""
  const digest = repeatedDigestBytes(salt, scope, bytes, bytes.byteLength)
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  return [...digest].map((byte) => alphabet[byte % alphabet.length]).join("")
}

export function sanitizeRehearsalDatabase(
  db: Database,
  rules: readonly SanitizationRule[],
  salt: string,
): { before: RehearsalProfile; after: RehearsalProfile } {
  if (salt.length < 32) throw new Error("rehearsal sanitization salt must contain at least 32 characters")
  assertCompleteSanitizationRules(db, rules)
  const before = profileRehearsalDatabase(db)
  const transaction = db.transaction(() => {
    for (const rule of rules) {
      if (rule.mode === "preserve") continue
      const table = quoteIdentifier(rule.table)
      const column = quoteIdentifier(rule.column)
      const values = db.query<{ value: string | Uint8Array }, []>(
        `SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`,
      ).all()
      for (const { value } of values) {
        const scope = rule.mode === "stable_text" || rule.mode === "stable_blob"
          ? "stable"
          : `${rule.table}.${rule.column}`
        const replacement = typeof value === "string"
          ? sanitizedText(salt, scope, value)
          : repeatedDigestBytes(salt, scope, value, value.byteLength)
        db.query(`UPDATE ${table} SET ${column} = ?1 WHERE ${column} IS ?2`).run(replacement, value)
      }
    }
    const after = profileRehearsalDatabase(db)
    if (JSON.stringify(before.rowCounts) !== JSON.stringify(after.rowCounts)) {
      throw new Error("sanitization changed table row counts")
    }
    if (before.byteLengthDistributionSha256 !== after.byteLengthDistributionSha256) {
      throw new Error("sanitization changed TEXT/BLOB byte-length distributions")
    }
    if (before.schemaMigrationsSha256 !== after.schemaMigrationsSha256) {
      throw new Error("sanitization changed schema_migrations, including a drifted checksum")
    }
    return after
  })
  const after = transaction.immediate()
  return { before, after }
}
