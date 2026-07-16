/**
 * Schema artifacts derived from a migration's SQL.
 *
 * The APPLIERS declare artifacts explicitly via `MigrationSpec` (lib/fleet-d1-migration.ts),
 * which is right for them — one spec per migration, reviewed once.
 *
 * The GATE cannot: its requirements manifest names migration FILES, and it must be
 * able to attest any of them without someone first hand-writing a spec. So it derives
 * the artifacts from the SQL. That keeps "add a migration to the manifest" a
 * one-line change instead of a code change.
 *
 * The derivation is deliberately conservative: it recognizes the DDL that creates a
 * checkable object (CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE INDEX) and records
 * EVERYTHING ELSE as `unrecognized`. A migration whose effect the gate cannot see
 * (triggers, views, drops, renames, data migrations) must not silently pass on its
 * ledger checksum alone — that would collapse the independent schema attestation back
 * into "trust the ledger". Callers fail closed on unrecognized statements unless the
 * manifest explicitly marks the migration ledger-only with a rationale.
 */
export type Artifacts = {
  /** Tables the migration CREATEs. */
  tables: string[]
  /** [table, column] pairs the migration ADDs. */
  columns: Array<[string, string]>
  /** Indexes the migration CREATEs. */
  indexes: string[]
  /** Indexes the migration DROPs and which therefore must be absent. */
  absentIndexes: string[]
  /** Tables the migration ALTERs — these must already exist for it to apply. */
  altered: string[]
  /**
   * Statements the deriver could not turn into a checkable artifact (leading
   * keywords, for diagnostics). Non-empty means the SQL-derived attestation is
   * INCOMPLETE for this migration.
   */
  unrecognized: string[]
}

/** Total number of checkable schema objects this migration is expected to create. */
export function artifactCount(a: Artifacts): number {
  return a.tables.length + a.columns.length + a.indexes.length + a.absentIndexes.length
}

/**
 * Split into statements on `;`, dropping comments and blanks. This is not a full
 * SQL parser: a trigger body (BEGIN … ; … END) would be mis-split — but a trigger
 * is unrecognized DDL either way, so the fragments stay unrecognized and the gate
 * still fails closed. It never produces a false "recognized".
 */
function statements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function expectedArtifacts(sql: string): Artifacts {
  const tables: string[] = []
  const columns: Array<[string, string]> = []
  const indexes: string[] = []
  const absentIndexes: string[] = []
  const altered = new Set<string>()
  const unrecognized: string[] = []

  const createTable = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/i
  const addColumn = /^ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)["'`]?/i
  const createIndex = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/i
  const dropIndex = /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/i

  for (const stmt of statements(sql)) {
    let m: RegExpMatchArray | null
    if ((m = stmt.match(createTable))) {
      tables.push(m[1])
    } else if ((m = stmt.match(addColumn))) {
      columns.push([m[1], m[2]])
      altered.add(m[1])
    } else if ((m = stmt.match(createIndex))) {
      indexes.push(m[1])
    } else if ((m = stmt.match(dropIndex))) {
      absentIndexes.push(m[1])
    } else {
      // Record just the leading keywords, never full statement text (which could
      // contain values), so this is safe to print in CI logs.
      unrecognized.push(stmt.split(/\s+/).slice(0, 3).join(" "))
    }
  }
  return { tables, columns, indexes, absentIndexes, altered: [...altered], unrecognized }
}
