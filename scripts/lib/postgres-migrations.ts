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

  const existingMigrationRows = await sql<{ migration_name: string; checksum: string }[]>`
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

  try {
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

      await sql.begin(async (tx) => {
        if (migrationSql) {
          await tx.unsafe(migrationSql);
        }

        await tx`
          INSERT INTO schema_migrations (migration_name, migration_label, checksum)
          VALUES (${migrationName}, ${label}, ${migrationChecksum})
        `;
      });

      existingMigrations.set(migrationName, migrationChecksum);
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
