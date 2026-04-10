import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function normalizeSql(contents: string): string {
  return contents.replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*$/gim, "").trim();
}

export async function applyPostgresMigrations(
  input: ApplyPostgresMigrationsOptions,
): Promise<ApplyPostgresMigrationsResult> {
  const migrationsDir = resolve(input.migrationsDir);
  const label = input.label || migrationsDir.split("/").pop() || "migrations";
  const log = input.logger ?? (() => {});

  const sql = new Bun.SQL(input.databaseUrl);

  await sql.unsafe(`
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

  let appliedCount = 0;
  let skippedCount = 0;

  try {
    for (const migrationName of migrationFiles) {
      const migrationPath = join(migrationsDir, migrationName);
      const rawSql = readFileSync(migrationPath, "utf8");
      const migrationSql = normalizeSql(rawSql);
      const migrationChecksum = checksum(rawSql);

      const existingRows = await sql<{ checksum: string }[]>`
        SELECT checksum
        FROM schema_migrations
        WHERE migration_name = ${migrationName}
      `;
      const existingChecksum = existingRows[0]?.checksum ?? "";

      if (existingChecksum) {
        if (existingChecksum !== migrationChecksum) {
          throw new Error(`checksum mismatch for already applied migration: ${migrationName}`);
        }

        log(`skip  ${migrationName}`);
        skippedCount += 1;
        continue;
      }

      log(`apply ${migrationName}`);

      await sql.begin(async (tx) => {
        if (migrationSql) {
          await tx.unsafe(migrationSql);
        }

        await tx`
          INSERT INTO schema_migrations (migration_name, migration_label, checksum)
          VALUES (${migrationName}, ${label}, ${migrationChecksum})
        `;
      });

      appliedCount += 1;
    }
  } finally {
    await sql.end();
  }

  return {
    label,
    applied: appliedCount,
    skipped: skippedCount,
  };
}
