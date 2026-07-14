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
 */
export type Artifacts = {
  /** Tables the migration CREATEs. */
  tables: string[]
  /** [table, column] pairs the migration ADDs. */
  columns: Array<[string, string]>
  /** Tables the migration ALTERs — these must already exist for it to apply. */
  altered: string[]
}

/**
 * Expected schema artifacts, derived from the migration SQL itself, so both tools
 * stay generic: a new migration needs no code change, only a manifest entry.
 *
 * Ledger presence alone is NOT sufficient evidence of a migration having been
 * applied — a ledger row can lie. We check the real schema.
 */
export function expectedArtifacts(sql: string): Artifacts {
  const tables: string[] = []
  const columns: Array<[string, string]> = []
  const altered = new Set<string>()
  const stripped = sql.replace(/--[^\n]*/g, "")
  for (const m of stripped.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)) {
    tables.push(m[1])
  }
  for (const m of stripped.matchAll(/ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)["'`]?/gi)) {
    columns.push([m[1], m[2]])
    altered.add(m[1])
  }
  return { tables, columns, altered: [...altered] }
}
