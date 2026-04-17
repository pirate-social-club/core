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

const LEGACY_MIGRATION_NAMES: Record<string, string[]> = {
  "0015_control_plane_song_artifact_bundle_enrichment.sql": [
    "0014_control_plane_song_artifact_bundle_enrichment.sql",
  ],
  "0016_control_plane_community_pricing_policies.sql": [
    "0015_control_plane_community_pricing_policies.sql",
  ],
  "0017_control_plane_json_text_to_jsonb.sql": [
    "0015_control_plane_json_text_to_jsonb.sql",
  ],
  "0018_control_plane_device_sessions.sql": [
    "0016_control_plane_device_sessions.sql",
  ],
  "0019_control_plane_text_timestamps_to_timestamptz.sql": [
    "0016_control_plane_text_timestamps_to_timestamptz.sql",
  ],
  "0033_control_plane_namespace_verification_spaces.sql": [
    "0026_control_plane_namespace_verification_spaces.sql",
  ],
};

const ACCEPTED_HISTORICAL_CHECKSUMS: Record<string, string[]> = {
  "0000_control_plane_baseline_postgres.sql": [
    "74e8627d1ba7ff144713a49c8965110dfbfd8b5580443127418e7b29b0041593",
  ],
  "0002_control_plane_communities.sql": [
    "8eb1ffcbe1e3259383015ff449f1f3ba8186ecafcc694a9241614bd4af2779ba",
  ],
};
// These historical checksums exist because the baseline migration file was modified
// after dev/staging had already applied an earlier version. The databases carry the
// original checksum in schema_migrations; the file on disk now hashes differently.
// Do not add new entries here without documenting the root cause in
// docs/control-plane/infisical-migration.md. Baseline migration files must not be
// mutated after any environment has applied them — if a schema change is needed, it
// belongs in a new numbered migration.

const SUPERSEDED_MIGRATIONS: Record<string, string[]> = {
  "0000_control_plane_baseline_postgres.sql": [
    "0001_control_plane_identity.sql",
    "0002_control_plane_communities.sql",
    "0003_control_plane_scrobbles.sql",
    "0004_control_plane_jobs_and_audit.sql",
    "0005_control_plane_namespace_verification.sql",
    "0006_control_plane_community_create_idempotency.sql",
    "0007_control_plane_registry_publication.sql",
    "0008_control_plane_reddit_onboarding_and_profiles.sql",
    "0009_control_plane_market_context_bindings.sql",
    "0010_control_plane_community_money_policies.sql",
    "0011_control_plane_song_artifact_bundles.sql",
    "0012_control_plane_song_artifact_uploads.sql",
    "0013_control_plane_song_artifact_upload_storage_metadata.sql",
    "0014_control_plane_community_discovery_projection.sql",
    "0015_control_plane_song_artifact_bundle_enrichment.sql",
    "0016_control_plane_community_pricing_policies.sql",
    "0017_control_plane_json_text_to_jsonb.sql",
    "0017_control_plane_registry_table_refs.sql",
    "0017_control_plane_song_artifact_bundle_preview_window.sql",
    "0018_control_plane_device_sessions.sql",
    "0018_control_plane_song_artifact_bundle_preview_status.sql",
    "0019_control_plane_verification_session_wallet.sql",
    "0019_control_plane_text_timestamps_to_timestamptz.sql",
    "0020_control_plane_community_gate_rules.sql",
    "0021_control_plane_reddit_targeting_features.sql",
    "0022_control_plane_membership_requests.sql",
    "0023_control_plane_communities_membership_mode_backfill.sql",
    "0024_control_plane_wallet_attachment_provider_state.sql",
    "0025_control_plane_dvpn_feature_entitlements.sql",
    "0026_control_plane_sentinel_subscriptions.sql",
    "0027_control_plane_sentinel_sessions.sql",
    "0028_control_plane_sentinel_session_uniqueness.sql",
    "0029_control_plane_sentinel_session_lifecycle.sql",
    "0030_control_plane_sentinel_subscription_uniqueness.sql",
    "0031_control_plane_registry_mutation_attempts.sql",
    "0032_control_plane_verification_session_metadata.sql",
    "0033_control_plane_namespace_verification_spaces.sql",
  ],
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

export function candidateMigrationNames(migrationName: string): string[] {
  return [migrationName, ...(LEGACY_MIGRATION_NAMES[migrationName] ?? [])];
}

export function acceptsHistoricalChecksum(input: {
  migrationName: string;
  existingChecksum: string;
  currentChecksum: string;
}): boolean {
  if (input.existingChecksum === input.currentChecksum) {
    return true;
  }

  return (ACCEPTED_HISTORICAL_CHECKSUMS[input.migrationName] ?? []).includes(input.existingChecksum);
}

function supersededByAppliedBaseline(
  migrationName: string,
  existingMigrationNames: Set<string>,
): string | null {
  for (const [baselineName, supersededNames] of Object.entries(SUPERSEDED_MIGRATIONS)) {
    if (supersededNames.includes(migrationName) && existingMigrationNames.has(baselineName)) {
      return baselineName;
    }
  }

  return null;
}

function representedByAppliedLegacyMigration(
  migrationName: string,
  existingMigrationNames: Set<string>,
): string | null {
  for (const legacyName of SUPERSEDED_MIGRATIONS[migrationName] ?? []) {
    if (existingMigrationNames.has(legacyName)) {
      return legacyName;
    }
  }

  return null;
}

export function supersessionSkipReason(input: {
  migrationName: string;
  existingMigrationNames: Iterable<string>;
}): string | null {
  const existingMigrationNames = new Set(input.existingMigrationNames);
  const appliedBaseline = supersededByAppliedBaseline(input.migrationName, existingMigrationNames);
  if (appliedBaseline) {
    return `superseded by ${appliedBaseline}`;
  }

  const appliedLegacy = representedByAppliedLegacyMigration(input.migrationName, existingMigrationNames);
  if (appliedLegacy) {
    return `current schema already represented by ${appliedLegacy}`;
  }

  return null;
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

      const skipReason = supersessionSkipReason({
        migrationName,
        existingMigrationNames: existingMigrations.keys(),
      });
      if (skipReason) {
        log(`skip  ${migrationName} (${skipReason})`);
        skippedCount += 1;
        continue;
      }

      const existingName = candidateMigrationNames(migrationName).find((name) =>
        existingMigrations.has(name),
      );
      const existingChecksum = existingName ? existingMigrations.get(existingName) ?? "" : "";

      if (existingChecksum) {
        if (!acceptsHistoricalChecksum({
          migrationName,
          existingChecksum,
          currentChecksum: migrationChecksum,
        })) {
          throw new Error(
            `checksum mismatch for already applied migration: ${migrationName} (matched ${existingName})`,
          );
        }

        if (existingName && existingName !== migrationName) {
          log(`skip  ${migrationName} (already applied as ${existingName})`);
        } else {
          log(`skip  ${migrationName}`);
        }
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
