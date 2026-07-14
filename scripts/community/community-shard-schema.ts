/**
 * Shared helpers for reasoning about community-shard (per-community D1) schema.
 *
 * Both the fleet APPLIER and the release GATE depend on these, and they must
 * agree: if the gate derives a migration's artifacts differently from the tool
 * that applies it, a fleet can be "migrated" and still fail the gate forever.
 */

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

/**
 * `wrangler d1 execute --file` interleaves upload progress and ANSI control
 * sequences with its JSON payload on STDOUT, so the output is not parseable
 * as-is. Strip ANSI, then take the FIRST bracket from which the remainder parses
 * as a JSON array.
 *
 * Scanning forward (not backward) matters: a nested `[` — e.g. the one opening
 * `"results": [...]` — would also parse, but as the WRONG value. The first
 * position that parses cleanly to the end is the true top-level payload.
 */
export function extractWranglerJson(stdout: string): unknown[] {
  const clean = stdout.replace(ANSI, "").replace(/\r/g, "")
  for (let i = clean.indexOf("["); i !== -1; i = clean.indexOf("[", i + 1)) {
    try {
      const parsed = JSON.parse(clean.slice(i))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Not the payload — a bracket inside progress text. Keep scanning.
    }
  }
  throw new Error(`no JSON array payload found in wrangler output: ${clean.slice(0, 200)}`)
}

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
