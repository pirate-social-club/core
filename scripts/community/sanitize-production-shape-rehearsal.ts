/** Produce a verified privacy-safe D1 import from a restricted local export. */

import { Database } from "bun:sqlite"
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import {
  sanitizeRehearsalDatabase,
  type SanitizationRule,
} from "./lib/rehearsal-sanitizer"

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index === -1 ? undefined : Bun.argv[index + 1]
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`missing required ${name}`)
  return resolve(value)
}

export function parseSanitizationRules(parsed: unknown): SanitizationRule[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sanitization manifest must be an object")
  }
  const { columns } = parsed as { columns?: unknown }
  if (!Array.isArray(columns)) throw new Error("sanitization manifest requires a columns array")
  return columns.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`sanitization manifest columns[${index}] must be an object`)
    }
    const entry = value as Record<string, unknown>
    if (typeof entry.table !== "string" || typeof entry.column !== "string") {
      throw new Error(`sanitization manifest columns[${index}] requires table and column strings`)
    }
    if (!['preserve', 'stable_text', 'mask_text', 'stable_blob'].includes(String(entry.mode))) {
      throw new Error(`sanitization manifest leaves ${entry.table}.${entry.column} unresolved`)
    }
    return {
      table: entry.table,
      column: entry.column,
      mode: entry.mode as SanitizationRule["mode"],
    }
  })
}

async function readRules(path: string): Promise<SanitizationRule[]> {
  return parseSanitizationRules(JSON.parse(await readFile(path, "utf8")))
}

export async function dumpD1CompatibleSql(database: string, output: string): Promise<void> {
  const sqliteDump = `${output}.sqlite-dump.tmp`
  const outputFile = Bun.file(sqliteDump)
  const process = Bun.spawn(["sqlite3", database, ".dump"], {
    stdout: outputFile,
    stderr: "pipe",
  })
  const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
  if (exitCode !== 0) throw new Error(`sqlite3 dump failed: ${stderr.slice(0, 500)}`)
  const raw = await readFile(sqliteDump, "utf8")
  const d1Compatible = raw
    .replace(/^BEGIN TRANSACTION;\n/mu, "")
    .replace(/\nCOMMIT;\n?$/u, "\n")
  if (d1Compatible === raw || /^(?:BEGIN TRANSACTION;|COMMIT;)$/mu.test(d1Compatible)) {
    throw new Error("failed to remove sqlite3 transaction wrappers from D1 import SQL")
  }
  await writeFile(output, d1Compatible, { mode: 0o600 })
  await Bun.file(sqliteDump).delete()
  await chmod(output, 0o600)
}

async function main(): Promise<void> {
  const source = requiredArgument("--source-database")
  const sanitized = requiredArgument("--sanitized-database")
  const manifest = requiredArgument("--sanitization-manifest")
  const saltFile = requiredArgument("--salt-file")
  const outputSql = requiredArgument("--output-sql")
  const profileOutput = requiredArgument("--profile-output")

  if (source === sanitized) throw new Error("source and sanitized database paths must differ")
  const salt = (await readFile(saltFile, "utf8")).trim()
  const rules = await readRules(manifest)
  await mkdir(dirname(sanitized), { recursive: true })
  await copyFile(source, sanitized)
  await chmod(sanitized, 0o600)

  const db = new Database(sanitized)
  try {
    const profile = sanitizeRehearsalDatabase(db, rules, salt)
    const integrity = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all()
    const foreignKeyViolations = db.query<Record<string, unknown>, []>("PRAGMA foreign_key_check").all()
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
      throw new Error(`sanitized database failed integrity_check: ${JSON.stringify(integrity)}`)
    }
    if (foreignKeyViolations.length !== 0) {
      throw new Error(`sanitized database failed foreign_key_check with ${foreignKeyViolations.length} rows`)
    }
    await mkdir(dirname(profileOutput), { recursive: true })
    await writeFile(profileOutput, `${JSON.stringify({
      generated_at: new Date().toISOString(),
      before: profile.before,
      after: profile.after,
      integrity_check: "ok",
      foreign_key_violations: 0,
    }, null, 2)}\n`, { mode: 0o600 })
  } finally {
    db.close()
  }
  await dumpD1CompatibleSql(sanitized, outputSql)
  console.log(JSON.stringify({
    sanitized_database: sanitized,
    output_sql: outputSql,
    profile_output: profileOutput,
    sanitization_rules: rules.length,
    ready_for_remote_d1_import: true,
  }, null, 2))
}

if (import.meta.main) await main()
