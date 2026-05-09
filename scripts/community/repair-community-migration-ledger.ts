#!/usr/bin/env bun
import { createClient } from "@libsql/client";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";
import { splitSqlStatements } from "../lib/shared/sql-migration";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../db/community-template/migrations");
const DRIFT_POLICY_PATH = resolve(import.meta.dir, "../../db/known-community-migration-drifts.json");

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

type ChecksumRepair = {
  migrationName: string;
  oldChecksum: string;
  newChecksum: string;
  reason: string;
};

type DriftPolicy = {
  communityTemplate: {
    checksumRepairs: ChecksumRepair[];
    unexpectedMigrationsToRemove: string[];
  };
};

type MigrationFile = {
  name: string;
  path: string;
  sql: string;
  checksum: string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/repair-community-migration-ledger.ts [options]

Repairs safe migration ledger drift on active remote community databases,
then applies missing migrations. Safe ledger repairs include allowlisted
checksum updates, checksum-proven renames, and allowlisted unexpected removals.

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

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({ name: entry.name, path: resolve(MIGRATIONS_DIR, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const sql = await readFile(file.path, "utf8");
    migrations.push({
      ...file,
      sql,
      checksum: checksumSql(sql),
    });
  }
  return migrations;
}

async function loadDriftPolicy(expectedByName: Map<string, MigrationFile>): Promise<DriftPolicy> {
  const raw = await readFile(DRIFT_POLICY_PATH, "utf8");
  const policy = JSON.parse(raw) as DriftPolicy;
  const checksumRepairs = policy.communityTemplate?.checksumRepairs ?? [];
  const unexpectedMigrationsToRemove = policy.communityTemplate?.unexpectedMigrationsToRemove ?? [];

  for (const repair of checksumRepairs) {
    if (!repair.migrationName || !repair.oldChecksum || !repair.newChecksum) {
      throw new Error("invalid checksum repair entry in drift policy");
    }
    const expected = expectedByName.get(repair.migrationName);
    if (!expected) {
      throw new Error(`drift policy references unknown migration: ${repair.migrationName}`);
    }
    if (expected.checksum !== repair.newChecksum) {
      throw new Error(`drift policy newChecksum does not match current migration: ${repair.migrationName}`);
    }
  }

  for (const migrationName of unexpectedMigrationsToRemove) {
    if (expectedByName.has(migrationName)) {
      throw new Error(`drift policy cannot remove expected migration: ${migrationName}`);
    }
  }

  return {
    communityTemplate: {
      checksumRepairs,
      unexpectedMigrationsToRemove,
    },
  };
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

let checksumRepaired = 0;
let renamed = 0;
let removed = 0;
let appliedTotal = 0;
let skippedTotal = 0;
let failed = 0;

const migrationFiles = await listMigrationFiles();
const expectedByName = new Map(migrationFiles.map((file) => [file.name, file] as const));
const driftPolicy = await loadDriftPolicy(expectedByName);
const unexpectedMigrationsToRemove = new Set(driftPolicy.communityTemplate.unexpectedMigrationsToRemove);

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

    for (const repair of driftPolicy.communityTemplate.checksumRepairs) {
      const actual = actualByName.get(repair.migrationName);
      if (actual === repair.oldChecksum) {
        console.log(`${options.execute ? "repair" : "DRY "} ${label} ${repair.migrationName} checksum mismatch (${repair.reason})`);
        if (options.execute) {
          ledgerRepairs.push({
            sql: "UPDATE schema_migrations SET checksum = ? WHERE migration_name = ?",
            args: [repair.newChecksum, repair.migrationName],
          });
        }
        actualByName.set(repair.migrationName, repair.newChecksum);
        communityRepaired += 1;
      }
    }

    for (const migrationName of Array.from(actualByName.keys())) {
      const isExpected = expectedByName.has(migrationName);
      if (!isExpected && unexpectedMigrationsToRemove.has(migrationName)) {
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

    const missingByChecksum = new Map(
      migrationFiles
        .filter((file) => !actualByName.has(file.name))
        .map((file) => [file.checksum, file.name] as const),
    );
    let communityRenamed = 0;
    for (const [actualName, checksum] of Array.from(actualByName.entries())) {
      if (expectedByName.has(actualName)) {
        continue;
      }
      const expectedName = missingByChecksum.get(checksum);
      if (!expectedName) {
        continue;
      }
      console.log(`${options.execute ? "rename" : "DRY  "} ${label} ${actualName} -> ${expectedName} checksum-proven rename`);
      if (options.execute) {
        ledgerRepairs.push({
          sql: "UPDATE schema_migrations SET migration_name = ? WHERE migration_name = ?",
          args: [expectedName, actualName],
        });
      }
      actualByName.delete(actualName);
      actualByName.set(expectedName, checksum);
      communityRenamed += 1;
    }

    const remainingUnexpected = Array.from(actualByName.keys())
      .filter((migrationName) => !expectedByName.has(migrationName))
      .sort();
    if (remainingUnexpected.length > 0) {
      throw new Error(`remaining_unexpected_migration:${remainingUnexpected.join(",")}`);
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

    checksumRepaired += communityRepaired;
    removed += communityRemoved;
    renamed += communityRenamed;

    // Apply missing migrations
    const pending: Array<{ sql: string; args?: (string | number | null)[] }> = [];
    let communityApplied = 0;
    let communitySkipped = 0;

    for (const file of migrationFiles) {
      const existingChecksum = actualByName.get(file.name) ?? null;

      if (existingChecksum) {
        if (existingChecksum !== file.checksum) {
          throw new Error(`remaining_checksum_mismatch:${file.name}`);
        }
        communitySkipped += 1;
        continue;
      }

      pending.push(
        ...splitSqlStatements(file.sql).map((statement) => ({ sql: statement })),
        {
          sql: `INSERT INTO schema_migrations (migration_name, migration_label, checksum) VALUES (?, ?, ?)`,
          args: [file.name, "community-template", file.checksum],
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
console.log(`checksum_repairs: ${checksumRepaired}`);
console.log(`renamed_rows: ${renamed}`);
console.log(`unexpected_removed: ${removed}`);
console.log(`applied_migrations: ${appliedTotal}`);
console.log(`skipped_migrations: ${skippedTotal}`);
console.log(`failed_communities: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
