#!/usr/bin/env bun
import { createClient } from "@libsql/client";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../db/community-template/migrations");

type Options = {
  databaseUrlEnv: string;
  communityIds: string[];
  execute: boolean;
};

type CommunityBindingRow = {
  community_id: string;
  display_name: string;
  database_url: string;
  encrypted_token: string;
  encryption_key_version: number | string;
};

const KNOWN_CHECKSUM_REPAIRS: Record<string, { old: string; new: string }> = {
  "1050_post_embeds.sql": {
    old: "17fa8e6f860480d77626f73575e7ae097e49fe0f009c1c064948fec6e40099f7",
    new: "fa6a008cbb81e249bd9b8f07ddf4f6d09236885c5115810ad83754d3a3e8c5f4",
  },
  "1060_community_gate_policies.sql": {
    old: "0c0df6502b683e17ac2a8102f777b440114d33a2fc954237696967623f28d469",
    new: "50b40ee28ad443c6ed4cc9bbfc0ffcd2cb2fe2a9cba443b5944952ec1b6ed5c6",
  },
  "1064_thread_comment_locks.sql": {
    old: "bdb8e886939b733f10afff54e25f83cc39ed49c2a6501b7f7604ac3357b8d61f",
    new: "c768ccfa8e10523f54d2e8960fe534fde388fee6b1aced30d5dcbd7314ca4c96",
  },
};

// Some communities were migrated with the test-fixtures version of 1060
const ADDITIONAL_1060_OLD_CHECKSUM = "8bb9d45175bc3a3deb398776dd67d8f1b287a1843af9cb869ea9a7360bf7a548";

const UNEXPECTED_MIGRATIONS_TO_REMOVE = new Set([
  "1061_reference_links_resource_shape.sql",
]);

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/repair-community-migration-ledger.ts [options]

Repairs known migration ledger drift on active remote community databases,
then applies missing migrations.

Environment:
  CONTROL_PLANE_DATABASE_URL       Required by default, or override with --database-url-env.
  TURSO_COMMUNITY_DB_WRAP_KEY      Required to decrypt active community DB tokens.

Options:
  --database-url-env NAME          Env var containing the control-plane database URL.
                                   Default: CONTROL_PLANE_DATABASE_URL.
  --community-id ID                Limit to one community. Repeatable.
  --execute                        Apply repairs and migrations. Omit for dry-run.
  -h, --help                       Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    communityIds: [],
    execute: false,
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
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

  options.communityIds = [...new Set(options.communityIds.filter(Boolean))];
  if (!options.databaseUrlEnv) usage();
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

async function listMigrationFiles(): Promise<Array<{ name: string; path: string }>> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({ name: entry.name, path: resolve(MIGRATIONS_DIR, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const options = parseArgs(process.argv.slice(2));
const controlPlaneDatabaseUrl = requireEnv(options.databaseUrlEnv);
const wrapKey = requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY");

const rows = await listCommunityBindings({
  controlPlaneDatabaseUrl,
  communityIds: options.communityIds,
});

console.log("community migration ledger repair");
console.log(`mode: ${options.execute ? "execute" : "dry-run"}`);
console.log(`selected_communities: ${rows.length}`);
console.log("");

let repaired = 0;
let removed = 0;
let appliedTotal = 0;
let skippedTotal = 0;
let failed = 0;

const migrationFiles = await listMigrationFiles();

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

    const ledgerRows = await client.execute<{ migration_name: string; checksum: string }>(
      "SELECT migration_name, checksum FROM schema_migrations ORDER BY migration_name"
    );
    const actualByName = new Map(ledgerRows.rows.map((r) => [String(r.migration_name), String(r.checksum)]));

    const ledgerRepairs: Array<{ sql: string; args: (string | number | null)[] }> = [];
    let communityRepaired = 0;
    let communityRemoved = 0;

    // Repair known checksum mismatches
    for (const [migrationName, { old, new: newChecksum }] of Object.entries(KNOWN_CHECKSUM_REPAIRS)) {
      const actual = actualByName.get(migrationName);
      if (actual === old) {
        console.log(`${options.execute ? "repair" : "DRY "} ${label} ${migrationName} checksum mismatch (known drift)`);
        if (options.execute) {
          ledgerRepairs.push({
            sql: "UPDATE schema_migrations SET checksum = ? WHERE migration_name = ?",
            args: [newChecksum, migrationName],
          });
        }
        actualByName.set(migrationName, newChecksum);
        communityRepaired += 1;
      }
    }

    // Additional 1060 checksum from test-fixtures version
    const actual1060 = actualByName.get("1060_community_gate_policies.sql");
    if (actual1060 === ADDITIONAL_1060_OLD_CHECKSUM) {
      const newChecksum = KNOWN_CHECKSUM_REPAIRS["1060_community_gate_policies.sql"].new;
      console.log(`${options.execute ? "repair" : "DRY "} ${label} 1060_community_gate_policies.sql checksum mismatch (test-fixtures drift)`);
      if (options.execute) {
        ledgerRepairs.push({
          sql: "UPDATE schema_migrations SET checksum = ? WHERE migration_name = ?",
          args: [newChecksum, "1060_community_gate_policies.sql"],
        });
      }
      actualByName.set("1060_community_gate_policies.sql", newChecksum);
      communityRepaired += 1;
    }

    // Remove unexpected migrations
    for (const migrationName of Array.from(actualByName.keys())) {
      const isExpected = migrationFiles.some((f) => f.name === migrationName);
      if (!isExpected && UNEXPECTED_MIGRATIONS_TO_REMOVE.has(migrationName)) {
        console.log(`${options.execute ? "remove" : "DRY "} ${label} ${migrationName} unexpected migration`);
        if (options.execute) {
          ledgerRepairs.push({
            sql: "DELETE FROM schema_migrations WHERE migration_name = ?",
            args: [migrationName],
          });
        }
        actualByName.delete(migrationName);
        communityRemoved += 1;
      }
    }

    if (ledgerRepairs.length > 0 && options.execute) {
      const tx = await client.transaction("write");
      try {
        for (const stmt of ledgerRepairs) {
          await tx.execute(stmt);
        }
        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    }

    repaired += communityRepaired;
    removed += communityRemoved;

    // Apply missing migrations
    const pending: Array<{ sql: string; args?: (string | number | null)[] }> = [];
    let communityApplied = 0;
    let communitySkipped = 0;

    for (const file of migrationFiles) {
      const migrationSql = await readFile(file.path, "utf8");
      const checksum = checksumSql(migrationSql);
      const existingChecksum = actualByName.get(file.name) ?? null;

      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(`remaining_checksum_mismatch:${file.name}`);
        }
        communitySkipped += 1;
        continue;
      }

      pending.push(
        ...splitSqlStatements(migrationSql).map((statement) => ({ sql: statement })),
        {
          sql: `INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES (?, ?, ?)`,
          args: [file.name, "community-template", checksum],
        }
      );
      communityApplied += 1;
    }

    if (communityApplied > 0) {
      console.log(`${options.execute ? "apply" : "DRY "} ${label} missing=${communityApplied}`);
    } else {
      console.log(`  ok   ${label} up to date`);
    }

    if (options.execute && pending.length > 0) {
      const tx = await client.transaction("write");
      try {
        for (const stmt of pending) {
          await tx.execute(stmt);
        }
        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    }

    appliedTotal += communityApplied;
    skippedTotal += communitySkipped;
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label} ${message.slice(0, 180)}`);
  } finally {
    client.close();
  }
}

console.log("");
console.log("community migration ledger repair complete");
console.log(`checked_communities: ${rows.length}`);
console.log(`ledger_repairs: ${repaired}`);
console.log(`unexpected_removed: ${removed}`);
console.log(`applied_migrations: ${appliedTotal}`);
console.log(`skipped_migrations: ${skippedTotal}`);
console.log(`failed_communities: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
