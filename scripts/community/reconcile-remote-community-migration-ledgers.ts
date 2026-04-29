#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { listExpectedCommunityMigrationChecksums } from "../lib/community-bootstrap";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";

type Options = {
  databaseUrlEnv: string;
  communityIds: string[];
  execute: boolean;
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
  checksum: string;
};

type RenameCandidate = {
  actualName: string;
  expectedName: string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/reconcile-remote-community-migration-ledgers.ts [options]

Dry-runs or repairs checksum-proven community schema_migrations name drift.
This only renames ledger rows when an unexpected row checksum exactly matches a
currently missing canonical migration file. It does not apply missing migrations.

Environment:
  CONTROL_PLANE_DATABASE_URL       Required by default, or override with --database-url-env.
  TURSO_COMMUNITY_DB_WRAP_KEY      Required to decrypt active community DB tokens.

Options:
  --database-url-env NAME          Env var containing the control-plane database URL.
                                   Default: CONTROL_PLANE_DATABASE_URL.
  --community-id ID                Limit to one community. Repeatable.
  --execute                        Apply ledger renames. Omit for dry-run.
  -h, --help                       Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    communityIds: [],
    execute: false,
  };

  for (let index = 0; index < argv.length; ) {
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
        c.status,
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

function analyzeLedger(input: {
  actualRows: SchemaMigrationRow[];
  expectedByName: Map<string, string>;
  missingByChecksum: Map<string, string>;
}): {
  renameCandidates: RenameCandidate[];
  missingWithoutChecksumMatch: string[];
  unexpectedWithoutChecksumMatch: string[];
  mismatchedNames: string[];
} {
  const actualByName = new Map(input.actualRows.map((row) => [row.migration_name, row] as const));
  const actualChecksums = new Set(input.actualRows.map((row) => row.checksum));
  const renameCandidates = input.actualRows
    .filter((row) => !input.expectedByName.has(row.migration_name))
    .map((row) => ({
      actualName: row.migration_name,
      expectedName: input.missingByChecksum.get(row.checksum) ?? "",
    }))
    .filter((row) => row.expectedName)
    .sort((left, right) => left.expectedName.localeCompare(right.expectedName));

  const missingWithoutChecksumMatch = Array.from(input.expectedByName)
    .filter(([name, checksum]) => !actualByName.has(name) && !actualChecksums.has(checksum))
    .map(([name]) => name);
  const unexpectedWithoutChecksumMatch = input.actualRows
    .filter((row) => !input.expectedByName.has(row.migration_name) && !input.missingByChecksum.has(row.checksum))
    .map((row) => row.migration_name)
    .sort();
  const mismatchedNames = Array.from(input.expectedByName)
    .filter(([name, checksum]) => actualByName.has(name) && actualByName.get(name)?.checksum !== checksum)
    .map(([name]) => name);

  return {
    renameCandidates,
    missingWithoutChecksumMatch,
    unexpectedWithoutChecksumMatch,
    mismatchedNames,
  };
}

async function readLedger(client: ReturnType<typeof createClient>): Promise<SchemaMigrationRow[]> {
  const result = await client.execute(`
    SELECT migration_name, checksum
    FROM schema_migrations
    ORDER BY migration_name ASC
  `);
  return result.rows.map((row) => ({
    migration_name: String(row.migration_name ?? ""),
    checksum: String(row.checksum ?? ""),
  }));
}

async function applyRenames(input: {
  client: ReturnType<typeof createClient>;
  renameCandidates: RenameCandidate[];
}): Promise<void> {
  const tx = await input.client.transaction("write");
  try {
    for (const candidate of input.renameCandidates) {
      await tx.execute({
        sql: "UPDATE schema_migrations SET migration_name = ? WHERE migration_name = ?",
        args: [candidate.expectedName, candidate.actualName],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

const options = parseArgs(process.argv.slice(2));
const controlPlaneDatabaseUrl = requireEnv(options.databaseUrlEnv);
const wrapKey = requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY");
const expected = await listExpectedCommunityMigrationChecksums();
const expectedByName = new Map(expected.map((entry) => [entry.migrationName, entry.checksum] as const));
const expectedNames = new Set(expected.map((entry) => entry.migrationName));
const rows = await listCommunityBindings({
  controlPlaneDatabaseUrl,
  communityIds: options.communityIds,
});

console.log("remote community migration ledger reconciliation");
console.log(`mode: ${options.execute ? "execute" : "dry-run"}`);
console.log(`selected_communities: ${rows.length}`);
console.log("");

let failed = 0;
let renamedTotal = 0;
let blocked = 0;

for (const row of rows) {
  const databaseAuthToken = decryptCommunityDbCredential({
    encryptedToken: row.encrypted_token,
    encryptionKeyVersion: Number(row.encryption_key_version),
    wrapKey,
  });
  const client = createClient({
    url: row.database_url,
    authToken: databaseAuthToken,
  });

  try {
    const actualRows = await readLedger(client);
    const actualByName = new Set(actualRows.map((actual) => actual.migration_name));
    const missingByChecksum = new Map(
      expected
        .filter((entry) => !actualByName.has(entry.migrationName))
        .map((entry) => [entry.checksum, entry.migrationName] as const),
    );
    const analysis = analyzeLedger({
      actualRows,
      expectedByName,
      missingByChecksum,
    });
    const alreadyCanonicalUnexpected = actualRows
      .filter((actual) => !expectedNames.has(actual.migration_name))
      .length;

    const label = `${row.community_id} ${JSON.stringify(row.display_name)}`;
    if (analysis.mismatchedNames.length > 0 || analysis.unexpectedWithoutChecksumMatch.length > 0) {
      blocked += 1;
      console.log(`BLOCK ${label} rename_candidates=${analysis.renameCandidates.length} mismatched=${analysis.mismatchedNames.length} unpaired_unexpected=${analysis.unexpectedWithoutChecksumMatch.length}`);
      continue;
    }

    if (analysis.renameCandidates.length === 0) {
      console.log(`  ok  ${label} recorded=${actualRows.length} unexpected=${alreadyCanonicalUnexpected} unpaired_missing=${analysis.missingWithoutChecksumMatch.length}`);
      continue;
    }

    console.log(`${options.execute ? "fix " : "DRY "} ${label} rename_candidates=${analysis.renameCandidates.length} unpaired_missing=${analysis.missingWithoutChecksumMatch.join(",") || "none"}`);

    if (options.execute) {
      await applyRenames({
        client,
        renameCandidates: analysis.renameCandidates,
      });
      renamedTotal += analysis.renameCandidates.length;
    }
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${row.community_id} ${message.slice(0, 180)}`);
  } finally {
    client.close();
  }
}

console.log("");
console.log("remote community migration ledger reconciliation complete");
console.log(`checked_communities: ${rows.length}`);
console.log(`renamed_rows: ${renamedTotal}`);
console.log(`blocked_communities: ${blocked}`);
console.log(`failed_communities: ${failed}`);

process.exit(failed > 0 || blocked > 0 ? 1 : 0);
