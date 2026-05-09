#!/usr/bin/env bun

import {
  applyCommunityTemplateMigrations,
  inspectCommunityTemplateMigrations,
} from "../lib/community-bootstrap";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";

type Options = {
  databaseUrlEnv: string;
  communityIds: string[];
  execute: boolean;
  includeProvisioningErrors: boolean;
};

type CommunityBindingRow = {
  community_id: string;
  display_name: string;
  route_slug: string | null;
  status: string;
  provisioning_state: string;
  community_database_binding_id: string;
  database_url: string;
  encrypted_token: string;
  encryption_key_version: number | string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/apply-remote-community-migrations.ts [options]

Audits active Turso/libSQL community databases against db/community-template/migrations
and applies missing migrations only when --execute is passed.
For checksum, rename, or unexpected-ledger repair workflows, use
repair-community-migration-ledger.ts.

Environment:
  CONTROL_PLANE_DATABASE_URL       Required by default, or override with --database-url-env.
  TURSO_COMMUNITY_DB_WRAP_KEY      Required to decrypt active community DB tokens.

Options:
  --database-url-env NAME          Env var containing the control-plane database URL.
                                   Default: CONTROL_PLANE_DATABASE_URL.
  --community-id ID                Limit to one community. Repeatable.
  --include-provisioning-errors    Also inspect active communities stuck in provisioning_state=error.
  --execute                        Apply missing migrations. Omit for dry-run.
  -h, --help                       Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    communityIds: [],
    execute: false,
    includeProvisioningErrors: false,
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
        options.communityIds.push(String(value ?? "").trim());
        index += 2;
        break;
      case "--include-provisioning-errors":
        options.includeProvisioningErrors = true;
        index += 1;
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
  if (!options.databaseUrlEnv) {
    usage();
  }

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
  includeProvisioningErrors: boolean;
}): Promise<CommunityBindingRow[]> {
  const db = new Bun.SQL(input.controlPlaneDatabaseUrl);
  const provisioningStates = input.includeProvisioningErrors
    ? ["active", "error"]
    : ["active"];

  const clauses = [
    "c.status = 'active'",
    `c.provisioning_state IN (${provisioningStates.map(sqlString).join(", ")})`,
    "b.status = 'active'",
    "b.database_url LIKE 'libsql://%'",
    "credentials.active_credential_count = 1",
  ];

  if (input.communityIds.length > 0) {
    const communityIds = input.communityIds.map(validateCommunityId);
    clauses.push(`c.community_id IN (${communityIds.map(sqlString).join(", ")})`);
  }

  try {
    return await db.unsafe<CommunityBindingRow[]>(`
      SELECT
        c.community_id,
        c.display_name,
        c.route_slug,
        c.status,
        c.provisioning_state,
        b.community_database_binding_id,
        b.database_url,
        cred.encrypted_token,
        cred.encryption_key_version,
        credentials.active_credential_count
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
const rows = await listCommunityBindings({
  controlPlaneDatabaseUrl,
  communityIds: options.communityIds,
  includeProvisioningErrors: options.includeProvisioningErrors,
});

console.log("remote community migration audit");
console.log(`mode: ${options.execute ? "execute" : "dry-run"}`);
console.log(`database_url_env: ${options.databaseUrlEnv}`);
console.log(`selected_communities: ${rows.length}`);
console.log("");

let communitiesWithDrift = 0;
let appliedTotal = 0;
let skippedTotal = 0;
let failedTotal = 0;

for (const row of rows) {
  try {
    const databaseAuthToken = decryptCommunityDbCredential({
      encryptedToken: row.encrypted_token,
      encryptionKeyVersion: Number(row.encryption_key_version),
      wrapKey,
    });
    const state = await inspectCommunityTemplateMigrations({
      databaseUrl: row.database_url,
      databaseAuthToken,
    });
    const driftCount = state.missingMigrationNames.length
      + state.mismatchedMigrationNames.length
      + state.unexpectedMigrationNames.length;
    if (driftCount > 0) {
      communitiesWithDrift += 1;
    }

    const label = `${row.community_id} ${JSON.stringify(row.display_name)} provisioning=${row.provisioning_state}`;
    if (state.mismatchedMigrationNames.length > 0 || state.unexpectedMigrationNames.length > 0) {
      failedTotal += 1;
      console.log(`FAIL  ${label} missing=${state.missingMigrationNames.length} mismatched=${state.mismatchedMigrationNames.length} unexpected=${state.unexpectedMigrationNames.length}`);
      continue;
    }

    if (state.missingMigrationNames.length === 0) {
      console.log(`  ok   ${label}`);
      continue;
    }

    console.log(`${options.execute ? "apply" : "DRY"}  ${label} missing=${state.missingMigrationNames.join(",")}`);
    if (!options.execute) {
      continue;
    }

    const result = await applyCommunityTemplateMigrations({
      databaseUrl: row.database_url,
      databaseAuthToken,
    });
    appliedTotal += result.applied;
    skippedTotal += result.skipped;
    console.log(`  ok   ${row.community_id} applied=${result.applied} skipped=${result.skipped}`);
  } catch (error) {
    failedTotal += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${row.community_id} ${message.slice(0, 180)}`);
  }
}

console.log("");
console.log("remote community migration audit complete");
console.log(`checked_communities: ${rows.length}`);
console.log(`communities_with_drift: ${communitiesWithDrift}`);
console.log(`applied_migrations: ${appliedTotal}`);
console.log(`skipped_migrations: ${skippedTotal}`);
console.log(`failed_communities: ${failedTotal}`);

process.exit(failedTotal > 0 || (!options.execute && communitiesWithDrift > 0) ? 1 : 0);
