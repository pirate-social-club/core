#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { listExpectedCommunityMigrationChecksums } from "../lib/community-bootstrap";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";

type Options = {
  databaseUrlEnv: string;
  communityId: string;
  limit: number;
};

type CommunityBindingRow = {
  community_id: string;
  display_name: string;
  status: string;
  provisioning_state: string;
  database_url: string;
  encrypted_token: string;
  encryption_key_version: number | string;
};

type SchemaMigrationRow = {
  migration_name: string;
  migration_label: string | null;
  checksum: string;
  applied_at: string | null;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/inspect-remote-community-migration-ledger.ts --community-id ID [--database-url-env NAME] [--limit N]

Read-only inspection of one remote Turso/libSQL community DB schema_migrations ledger.

Environment:
  CONTROL_PLANE_DATABASE_URL       Required by default, or override with --database-url-env.
  TURSO_COMMUNITY_DB_WRAP_KEY      Required to decrypt the active community DB token.

Options:
  --community-id ID                Community id to inspect.
  --database-url-env NAME          Env var containing the control-plane database URL.
                                   Default: CONTROL_PLANE_DATABASE_URL.
  --limit N                        Max names to print per category. Default: 120.
  -h, --help                       Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    communityId: "",
    limit: 120,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--community-id":
        options.communityId = String(value ?? "").trim();
        index += 2;
        break;
      case "--database-url-env":
        options.databaseUrlEnv = String(value ?? "").trim();
        index += 2;
        break;
      case "--limit": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) usage();
        options.limit = parsed;
        index += 2;
        break;
      }
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.communityId || !/^[A-Za-z0-9_-]+$/.test(options.communityId)) {
    console.error("--community-id is required and must be an id-like value");
    usage();
  }
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

async function loadCommunityBinding(input: {
  controlPlaneDatabaseUrl: string;
  communityId: string;
}): Promise<CommunityBindingRow> {
  const db = new Bun.SQL(input.controlPlaneDatabaseUrl);
  try {
    const rows = await db<CommunityBindingRow[]>`
      SELECT
        c.community_id,
        c.display_name,
        c.status,
        c.provisioning_state,
        b.database_url,
        cred.encrypted_token,
        cred.encryption_key_version
      FROM communities AS c
      JOIN community_database_bindings AS b
        ON b.community_database_binding_id = c.primary_database_binding_id
      JOIN community_db_credentials AS cred
        ON cred.community_database_binding_id = b.community_database_binding_id
       AND cred.status = 'active'
      WHERE c.community_id = ${input.communityId}
      ORDER BY cred.created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new Error(`community not found or has no active DB credential: ${input.communityId}`);
    }
    if (!row.database_url.startsWith("libsql://")) {
      throw new Error(`community is not remote libsql-backed: ${row.database_url}`);
    }
    return row;
  } finally {
    await db.end();
  }
}

function printList(title: string, values: string[], limit: number): void {
  console.log(`${title}: ${values.length}`);
  for (const value of values.slice(0, limit)) {
    console.log(`- ${value}`);
  }
  if (values.length > limit) {
    console.log(`... ${values.length - limit} more`);
  }
  console.log("");
}

const options = parseArgs(process.argv.slice(2));
const controlPlaneDatabaseUrl = requireEnv(options.databaseUrlEnv);
const wrapKey = requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY");

const binding = await loadCommunityBinding({
  controlPlaneDatabaseUrl,
  communityId: options.communityId,
});
const databaseAuthToken = decryptCommunityDbCredential({
  encryptedToken: binding.encrypted_token,
  encryptionKeyVersion: Number(binding.encryption_key_version),
  wrapKey,
});

const client = createClient({
  url: binding.database_url,
  authToken: databaseAuthToken,
});

let rows: SchemaMigrationRow[];
try {
  const result = await client.execute(`
    SELECT migration_name, migration_label, checksum, applied_at
    FROM schema_migrations
    ORDER BY migration_name ASC
  `);
  rows = result.rows.map((row) => ({
    migration_name: String(row.migration_name ?? ""),
    migration_label: row.migration_label == null ? null : String(row.migration_label),
    checksum: String(row.checksum ?? ""),
    applied_at: row.applied_at == null ? null : String(row.applied_at),
  }));
} finally {
  client.close();
}

const expected = await listExpectedCommunityMigrationChecksums();
const expectedByName = new Map(expected.map((entry) => [entry.migrationName, entry.checksum] as const));
const actualByName = new Map(rows.map((row) => [row.migration_name, row] as const));

const missing = expected
  .filter((entry) => !actualByName.has(entry.migrationName))
  .map((entry) => entry.migrationName);
const mismatched = expected
  .filter((entry) => actualByName.has(entry.migrationName) && actualByName.get(entry.migrationName)?.checksum !== entry.checksum)
  .map((entry) => entry.migrationName);
const unexpected = rows
  .map((row) => row.migration_name)
  .filter((name) => !expectedByName.has(name))
  .sort();
const matching = expected
  .filter((entry) => actualByName.get(entry.migrationName)?.checksum === entry.checksum)
  .map((entry) => entry.migrationName);
const missingByChecksum = new Map(
  expected
    .filter((entry) => !actualByName.has(entry.migrationName))
    .map((entry) => [entry.checksum, entry.migrationName] as const),
);
const checksumRenameCandidates = rows
  .filter((row) => !expectedByName.has(row.migration_name))
  .map((row) => ({
    actualName: row.migration_name,
    expectedName: missingByChecksum.get(row.checksum) ?? "",
  }))
  .filter((row) => row.expectedName)
  .sort((left, right) => left.expectedName.localeCompare(right.expectedName));
const missingWithoutChecksumMatch = missing
  .filter((name) => !rows.some((row) => row.checksum === expectedByName.get(name)));
const unexpectedWithoutChecksumMatch = unexpected
  .filter((name) => {
    const checksum = actualByName.get(name)?.checksum ?? "";
    return !missingByChecksum.has(checksum);
  });

console.log("remote community migration ledger");
console.log(`community_id: ${binding.community_id}`);
console.log(`display_name: ${JSON.stringify(binding.display_name)}`);
console.log(`status: ${binding.status}`);
console.log(`provisioning_state: ${binding.provisioning_state}`);
console.log(`database_url_host: ${new URL(binding.database_url).hostname}`);
console.log(`expected_migrations: ${expected.length}`);
console.log(`recorded_migrations: ${rows.length}`);
console.log(`matching: ${matching.length}`);
console.log(`missing: ${missing.length}`);
console.log(`mismatched: ${mismatched.length}`);
console.log(`unexpected: ${unexpected.length}`);
console.log(`checksum_rename_candidates: ${checksumRenameCandidates.length}`);
console.log(`missing_without_checksum_match: ${missingWithoutChecksumMatch.length}`);
console.log(`unexpected_without_checksum_match: ${unexpectedWithoutChecksumMatch.length}`);
console.log("");

printList("matching_names", matching, options.limit);
printList("missing_names", missing, options.limit);
printList("mismatched_names", mismatched, options.limit);
printList("unexpected_names", unexpected, options.limit);
console.log(`checksum_rename_candidates: ${checksumRenameCandidates.length}`);
for (const row of checksumRenameCandidates.slice(0, options.limit)) {
  console.log(`- ${row.actualName} -> ${row.expectedName}`);
}
if (checksumRenameCandidates.length > options.limit) {
  console.log(`... ${checksumRenameCandidates.length - options.limit} more`);
}
console.log("");
printList("missing_without_checksum_match", missingWithoutChecksumMatch, options.limit);
printList("unexpected_without_checksum_match", unexpectedWithoutChecksumMatch, options.limit);

console.log("recorded_ledger:");
for (const row of rows.slice(0, options.limit)) {
  const checksum = row.checksum ? `${row.checksum.slice(0, 12)}...` : "";
  console.log(`- ${row.migration_name} label=${row.migration_label ?? ""} checksum=${checksum} applied_at=${row.applied_at ?? ""}`);
}
if (rows.length > options.limit) {
  console.log(`... ${rows.length - options.limit} more`);
}
