#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";

type Options = {
  databaseUrlEnv: string;
  migrationName: string;
  communityIds: string[];
  execute: boolean;
};

type CommunityBindingRow = {
  community_id: string;
  display_name: string;
  provisioning_state: string;
  database_url: string;
  encrypted_token: string;
  encryption_key_version: number | string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/apply-single-remote-community-migration.ts --migration NAME [options]

Applies one additive community-template migration to active remote Turso/libSQL
community databases. This intentionally ignores unrelated schema_migrations drift.

Environment:
  CONTROL_PLANE_DATABASE_URL       Required by default, or override with --database-url-env.
  TURSO_COMMUNITY_DB_WRAP_KEY      Required to decrypt active community DB tokens.

Options:
  --migration NAME                 Migration filename from db/community-template/migrations.
  --database-url-env NAME          Env var containing the control-plane database URL.
                                   Default: CONTROL_PLANE_DATABASE_URL.
  --community-id ID                Limit to one community. Repeatable.
  --execute                        Apply the migration. Omit for dry-run.
  -h, --help                       Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    migrationName: "",
    communityIds: [],
    execute: false,
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--migration":
        options.migrationName = String(value ?? "").trim();
        index += 2;
        break;
      case "--database-url-env":
        options.databaseUrlEnv = String(value ?? "").trim();
        index += 2;
        break;
      case "--community-id":
        options.communityIds.push(validateCommunityId(String(value ?? "").trim()));
        index += 2;
        break;
      case "--execute":
        options.execute = true;
        index += 1;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!/^[0-9]{4}_[A-Za-z0-9_-]+\.sql$/.test(options.migrationName)) {
    console.error("--migration must be a community-template migration filename");
    usage();
  }
  if (!options.databaseUrlEnv) usage();
  options.communityIds = [...new Set(options.communityIds.filter(Boolean))];
  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function validateCommunityId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`invalid community id: ${value}`);
  }
  return value;
}

function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inLineComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? "";

    if (inLineComment) {
      current += char;
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (!inSingleQuote && char === "-" && next === "-") {
      inLineComment = true;
      current += char;
      continue;
    }
    if (char === "'") {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (!inSingleQuote && char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

async function listCommunityBindings(input: {
  controlPlaneDatabaseUrl: string;
  communityIds: string[];
}): Promise<CommunityBindingRow[]> {
  const db = new Bun.SQL(input.controlPlaneDatabaseUrl);
  const clauses = [
    "c.status = 'active'",
    "c.provisioning_state = 'active'",
    "b.status = 'active'",
    "b.database_url LIKE 'libsql://%'",
    "credentials.active_credential_count = 1",
  ];

  if (input.communityIds.length > 0) {
    clauses.push(`c.community_id IN (${input.communityIds.map(sqlString).join(", ")})`);
  }

  try {
    return await db.unsafe<CommunityBindingRow[]>(`
      SELECT
        c.community_id,
        c.display_name,
        c.provisioning_state,
        b.database_url,
        cred.encrypted_token,
        cred.encryption_key_version
      FROM communities AS c
      JOIN community_database_bindings AS b
        ON b.community_database_binding_id = c.primary_database_binding_id
      JOIN (
        SELECT community_database_binding_id, COUNT(*) AS active_credential_count
        FROM community_db_credentials
        WHERE status = 'active'
        GROUP BY community_database_binding_id
      ) AS credentials
        ON credentials.community_database_binding_id = b.community_database_binding_id
      JOIN community_db_credentials AS cred
        ON cred.community_database_binding_id = b.community_database_binding_id
       AND cred.status = 'active'
      WHERE ${clauses.join("\n        AND ")}
      ORDER BY c.created_at ASC, c.community_id ASC
    `) as CommunityBindingRow[];
  } finally {
    await db.end();
  }
}

const options = parseArgs(process.argv.slice(2));
const controlPlaneDatabaseUrl = requireEnv(options.databaseUrlEnv);
const wrapKey = requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY");
const migrationPath = resolve("db/community-template/migrations", options.migrationName);
const migrationSql = await readFile(migrationPath, "utf8");
const checksum = checksumSql(migrationSql);
const statements = splitSqlStatements(migrationSql);
const rows = await listCommunityBindings({
  controlPlaneDatabaseUrl,
  communityIds: options.communityIds,
});

console.log("single remote community migration");
console.log(`mode: ${options.execute ? "execute" : "dry-run"}`);
console.log(`migration: ${options.migrationName}`);
console.log(`selected_communities: ${rows.length}`);
console.log("");

let applied = 0;
let ledgerRepaired = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const token = decryptCommunityDbCredential({
    encryptedToken: row.encrypted_token,
    encryptionKeyVersion: Number(row.encryption_key_version),
    wrapKey,
  });
  const client = createClient({
    url: row.database_url,
    authToken: token,
  });
  const label = `${row.community_id} ${JSON.stringify(row.display_name)}`;

  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name TEXT PRIMARY KEY,
        migration_label TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const ledger = await client.execute({
      sql: "SELECT checksum FROM schema_migrations WHERE migration_name = ?",
      args: [options.migrationName],
    });
    const existingChecksum = ledger.rows[0]?.checksum == null
      ? null
      : String(ledger.rows[0].checksum);

    if (existingChecksum && existingChecksum !== checksum) {
      throw new Error(`checksum mismatch for ${options.migrationName}`);
    }
    if (existingChecksum === checksum) {
      skipped += 1;
      console.log(` ok   ${label} already_applied`);
      continue;
    }

    const columns = await client.execute("PRAGMA table_info(posts)");
    const columnNames = new Set(columns.rows.map((column) => String(column.name ?? "")));
    const hasSnapshotColumns = columnNames.has("link_enrichment_snapshot_json")
      && columnNames.has("link_enrichment_synced_at");

    if (hasSnapshotColumns) {
      console.log(`${options.execute ? "fix " : "DRY "} ${label} columns_present_ledger_missing`);
      if (options.execute) {
        await client.execute({
          sql: `INSERT INTO schema_migrations (
             migration_name,
             migration_label,
             checksum
           ) VALUES (?, ?, ?)`,
          args: [options.migrationName, "community-template", checksum],
        });
        ledgerRepaired += 1;
      }
      continue;
    }

    console.log(`${options.execute ? "apply" : "DRY "} ${label} statements=${statements.length}`);
    if (!options.execute) continue;

    const tx = await client.transaction("write");
    try {
      for (const statement of statements) {
        await tx.execute(statement);
      }
      await tx.execute({
        sql: `INSERT INTO schema_migrations (
           migration_name,
           migration_label,
           checksum
         ) VALUES (?, ?, ?)`,
        args: [options.migrationName, "community-template", checksum],
      });
      await tx.commit();
      applied += 1;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label} ${message.slice(0, 180)}`);
  } finally {
    client.close();
  }
}

console.log("");
console.log("single remote community migration complete");
console.log(`checked_communities: ${rows.length}`);
console.log(`applied: ${applied}`);
console.log(`ledger_repaired: ${ledgerRepaired}`);
console.log(`skipped: ${skipped}`);
console.log(`failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
