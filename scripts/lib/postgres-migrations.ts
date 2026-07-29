import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import compatibleDriftPolicy from "../../db/local-control-plane-migration-drifts.json";
import { sanitizePostgresUrlForBunSql } from "./postgres-url";
import { splitSqlStatements } from "./shared/sql-migration";

export type ApplyPostgresMigrationsOptions = {
  databaseUrl: string;
  migrationsDir: string;
  label?: string;
  logger?: (line: string) => void;
};

export type ApplyPostgresMigrationsResult = {
  label: string;
  applied: number;
  skipped: number;
};

// One database-wide namespace for every migration root using the shared
// public.schema_migrations ledger. These two int32 keys are intentionally fixed:
// every caller, repository, and migration root must contend on the same lock.
const MIGRATION_ADVISORY_LOCK_KEYS = [1_347_697_864, 1] as const;

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function normalizeSql(contents: string): string {
  return contents.replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*$/gim, "").trim();
}

export function postgresMigrationStatements(contents: string): string[] {
  return splitSqlStatements(normalizeSql(contents));
}

function migrationPrefix(migrationName: string): string | null {
  const match = migrationName.match(/^(\d+)_/);
  return match?.[1] ?? null;
}

export function migrationChecksumMatches(input: {
  migrationName: string;
  existingChecksum: string;
  currentChecksum: string;
}): boolean {
  if (input.existingChecksum === input.currentChecksum) {
    return true;
  }

  if (input.migrationName === "0000_control_plane_baseline_postgres.sql") {
    return true;
  }

  if (compatibleDriftPolicy.controlPlane.compatibleChecksumDrifts.some((drift) =>
    drift.migrationName === input.migrationName
    && drift.oldChecksum === input.existingChecksum
    && (!("newChecksum" in drift) || drift.newChecksum === input.currentChecksum)
  )) {
    return true;
  }

  return false;
}

function logDuplicateMigrationPrefixes(input: {
  migrationFiles: string[];
  logger: (line: string) => void;
}): void {
  const prefixes = new Map<string, string[]>();

  for (const migrationName of input.migrationFiles) {
    const prefix = migrationPrefix(migrationName);
    if (!prefix) {
      continue;
    }

    const existing = prefixes.get(prefix) ?? [];
    existing.push(migrationName);
    prefixes.set(prefix, existing);
  }

  for (const [prefix, names] of prefixes) {
    if (names.length < 2) {
      continue;
    }

    input.logger(`warn  duplicate migration prefix ${prefix}: ${names.join(", ")}`);
  }
}

export async function applyPostgresMigrations(
  input: ApplyPostgresMigrationsOptions,
): Promise<ApplyPostgresMigrationsResult> {
  const migrationsDir = resolve(input.migrationsDir);
  const label = input.label || migrationsDir.split("/").pop() || "migrations";
  const log = input.logger ?? (() => {});

  const sql = new Bun.SQL(sanitizePostgresUrlForBunSql(input.databaseUrl));
  const connection = await sql.reserve();
  let advisoryLockHeld = false;

  try {
    await connection`
      SELECT pg_advisory_lock(
        ${MIGRATION_ADVISORY_LOCK_KEYS[0]},
        ${MIGRATION_ADVISORY_LOCK_KEYS[1]}
      )
    `;
    advisoryLockHeld = true;

    await connection.unsafe(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name TEXT PRIMARY KEY,
  migration_label TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`);

    const migrationFiles = readdirSync(migrationsDir)
      .filter((entry) => entry.endsWith(".sql"))
      .sort();

    const existingMigrationRows = await connection<{ migration_name: string; checksum: string }[]>`
      SELECT migration_name, checksum
      FROM schema_migrations
    `;
    const existingMigrations = new Map(
      existingMigrationRows.map((row) => [row.migration_name, row.checksum] as const),
    );

    logDuplicateMigrationPrefixes({
      migrationFiles,
      logger: log,
    });

    let appliedCount = 0;
    let skippedCount = 0;

    for (const migrationName of migrationFiles) {
      const migrationPath = join(migrationsDir, migrationName);
      const rawSql = readFileSync(migrationPath, "utf8");
      const migrationSql = normalizeSql(rawSql);
      const migrationChecksum = checksum(rawSql);

      const existingChecksum = existingMigrations.get(migrationName) ?? "";

      if (existingChecksum) {
        if (!migrationChecksumMatches({
          migrationName,
          existingChecksum,
          currentChecksum: migrationChecksum,
        })) {
          throw new Error(
            `checksum mismatch for already applied migration: ${migrationName}`,
          );
        }

        log(`skip  ${migrationName}`);
        skippedCount += 1;
        continue;
      }

      log(`apply ${migrationName}`);

      await connection.unsafe("BEGIN");
      try {
        for (const statement of postgresMigrationStatements(migrationSql)) {
          await connection.unsafe(statement);
        }

        await connection`
          INSERT INTO schema_migrations (migration_name, migration_label, checksum)
          VALUES (${migrationName}, ${label}, ${migrationChecksum})
        `;
        await connection.unsafe("COMMIT");
      } catch (error) {
        await connection.unsafe("ROLLBACK").catch(() => {});
        throw error;
      }

      existingMigrations.set(migrationName, migrationChecksum);
      appliedCount += 1;
    }

    return {
      label,
      applied: appliedCount,
      skipped: skippedCount,
    };
  } finally {
    if (advisoryLockHeld) {
      // A failed explicit unlock is safe only because sql.end() below closes
      // the reserved session, which releases all session advisory locks. Do
      // not detach this runner from connection teardown without making unlock
      // failure fatal.
      await connection`
        SELECT pg_advisory_unlock(
          ${MIGRATION_ADVISORY_LOCK_KEYS[0]},
          ${MIGRATION_ADVISORY_LOCK_KEYS[1]}
        )
      `.catch(() => {});
    }
    connection.release();
    await sql.end();
  }
}
