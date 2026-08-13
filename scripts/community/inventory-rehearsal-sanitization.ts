/** Inventory every TEXT/BLOB column before a production-shape rehearsal copy is sanitized. */

import { Database } from "bun:sqlite"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { sanitizationInventory } from "./lib/rehearsal-sanitizer"

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index === -1 ? undefined : Bun.argv[index + 1]
}

const databasePath = argument("--database")
const outputPath = argument("--output")
if (!databasePath || !outputPath) {
  throw new Error("usage: --database <restricted-local-sqlite> --output <restricted-inventory-json>")
}

const resolvedDatabase = resolve(databasePath)
const resolvedOutput = resolve(outputPath)
await chmod(resolvedDatabase, 0o600)
const db = new Database(resolvedDatabase, { readonly: true })
try {
  const columns = sanitizationInventory(db)
  const output = {
    generated_at: new Date().toISOString(),
    source_database: "restricted production-shape rehearsal copy",
    policy: {
      exact_text_blob_column_coverage_required: true,
      schema_migrations_must_remain_verbatim: true,
      unresolved_columns_block_sanitization: true,
    },
    columns,
  }
  await mkdir(dirname(resolvedOutput), { recursive: true })
  await writeFile(resolvedOutput, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({
    output: resolvedOutput,
    text_blob_columns: columns.length,
    unresolved_columns: columns.filter(({ mode }) => mode === "unresolved").length,
    preserved_ledger_columns: columns.filter(({ table, mode }) => table === "schema_migrations" && mode === "preserve").length,
  }, null, 2))
} finally {
  db.close()
}
