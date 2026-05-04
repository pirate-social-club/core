#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";

type Options = {
  databaseUrlEnv: string;
  communityIds: string[];
  execute: boolean;
  allowMissing: boolean;
};

type CommunityBindingRow = {
  community_id: string;
  display_name: string;
  database_url: string;
  encrypted_token: string;
  encryption_key_version: number | string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/community/enable-anonymous-thread-stable-posting.ts [options]

  Enables anonymous thread-stable posting on specified country communities by setting:
    allow_anonymous_identity = 1
    anonymous_identity_scope = 'thread_stable'

  This is the pilot data migration for the country-board-curator project.

  Fails if any target community is not found in active bindings unless --allow-missing is set.

Environment:
  CONTROL_PLANE_DATABASE_URL       Required by default, or override with --database-url-env.
  TURSO_COMMUNITY_DB_WRAP_KEY      Required to decrypt active community DB tokens.

Options:
  --database-url-env NAME          Env var containing the control-plane database URL.
                                    Default: CONTROL_PLANE_DATABASE_URL.
  --community-id ID                Target community. Repeatable.
                                    Defaults to the 5 pilot countries if none specified.
  --revert                         Revert: set allow_anonymous_identity = 0,
                                    anonymous_identity_scope = NULL.
  --allow-missing                  Do not fail if target communities are missing from bindings.
  --execute                        Apply the change. Omit for dry-run.
  -h, --help                       Show this help text.`);
  process.exit(exitCode);
}

function requireOptionValue(arg: string, value: string | undefined): string {
  if (value == null || value === "") {
    console.error(`${arg} requires a value`);
    usage();
  }
  if (value.startsWith("-")) {
    console.error(`${arg} value must not start with '-' (got '${value}')`);
    usage();
  }
  return value;
}

function parseArgs(argv: string[]): Options & { revert: boolean } {
  const options: Options & { revert: boolean } = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    communityIds: [],
    execute: false,
    revert: false,
    allowMissing: false,
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--database-url-env":
        options.databaseUrlEnv = requireOptionValue(arg, value);
        index += 2;
        break;
      case "--community-id":
        options.communityIds.push(validateCommunityId(requireOptionValue(arg, value)));
        index += 2;
        break;
      case "--execute":
        options.execute = true;
        index += 1;
        break;
      case "--revert":
        options.revert = true;
        index += 1;
        break;
      case "--allow-missing":
        options.allowMissing = true;
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

const PILOT_COUNTRY_COMMUNITY_IDS: { id: string; label: string }[] = [
  { id: "cmt_358e886a684241f0ab29649f80e43cfa", label: "🇲🇦 Morocco" },
  { id: "cmt_f4093c6c16f745df90f2196c1bcac925", label: "🇦🇪 UAE" },
  { id: "cmt_e7e6d5f2db6642ea929a2d6ade44b7fe", label: "🇪🇸 Spain" },
  { id: "cmt_be418c4fee43425f9c864ceb0247f6a2", label: "🇻🇳 Vietnam" },
  { id: "cmt_75e95eb8ad464f9fa101625748489141", label: "🇸🇦 Saudi Arabia" },
];

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

const options = parseArgs(process.argv.slice(2));
const controlPlaneDatabaseUrl = requireEnv(options.databaseUrlEnv);
const wrapKey = requireEnv("TURSO_COMMUNITY_DB_WRAP_KEY");

const targetIds = options.communityIds.length > 0
  ? options.communityIds
  : PILOT_COUNTRY_COMMUNITY_IDS.map((p) => p.id);

const pilotLabel = (id: string) =>
  PILOT_COUNTRY_COMMUNITY_IDS.find((p) => p.id === id)?.label ?? id;

const rows = await listCommunityBindings({
  controlPlaneDatabaseUrl,
  communityIds: targetIds,
});

const action = options.revert ? "disable" : "enable";
const scopeValue = options.revert ? null : "thread_stable";
const anonymousFlag = options.revert ? 0 : 1;

console.log(`anonymous thread-stable posting: ${action}`);
console.log(`mode: ${options.execute ? "execute" : "dry-run"}`);
console.log(`target_communities: ${targetIds.length}`);
console.log(`found_bindings: ${rows.length}`);
console.log("");

if (rows.length === 0) {
  console.error("no active community bindings found for the specified ids");
  process.exit(1);
}

const missingIds = targetIds.filter(
  (id) => !rows.some((row) => row.community_id === id),
);
if (missingIds.length > 0) {
  const ids = missingIds.join(", ");
  if (options.allowMissing) {
    console.error(`warning: bindings not found for: ${ids}. Proceeding because --allow-missing is set.`);
  } else {
    console.error(`error: bindings not found for: ${ids}. Use --allow-missing to proceed anyway.`);
    process.exit(1);
  }
}

let updated = 0;
let alreadySet = 0;
let failed = 0;

const now = new Date().toISOString();

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
  const label = `${row.community_id} ${pilotLabel(row.community_id)}`;

  try {
    const current = await client.execute({
      sql: "SELECT allow_anonymous_identity, anonymous_identity_scope FROM communities WHERE community_id = ?",
      args: [row.community_id],
    });
    if (current.rows.length !== 1) {
      failed += 1;
      console.log(`FAIL ${label} community row not found in local DB (expected 1 row, got ${current.rows.length})`);
      continue;
    }
    const currentAnonymous = Number(current.rows[0].allow_anonymous_identity ?? 0);
    const currentScope = String(current.rows[0].anonymous_identity_scope ?? "");

    if (!options.revert && currentAnonymous === 1 && currentScope === "thread_stable") {
      alreadySet += 1;
      console.log(` ok   ${label} already_enabled`);
      continue;
    }
    if (options.revert && currentAnonymous === 0 && (currentScope === "null" || currentScope === "")) {
      alreadySet += 1;
      console.log(` ok   ${label} already_disabled`);
      continue;
    }

    console.log(
      `${options.execute ? "  -> " : "DRY "} ${label} allow_anonymous_identity=${currentAnonymous}->${anonymousFlag} anonymous_identity_scope=${currentScope || "(null)"}->${scopeValue ?? "(null)"}`,
    );
    if (!options.execute) continue;

    const result = await client.execute({
      sql: `UPDATE communities
            SET allow_anonymous_identity = ?,
                anonymous_identity_scope = ?,
                updated_at = ?
            WHERE community_id = ?`,
      args: [anonymousFlag, scopeValue, now, row.community_id],
    });
    if (result.rowsAffected !== 1) {
      failed += 1;
      console.log(`FAIL ${label} update affected ${result.rowsAffected} rows (expected 1)`);
      continue;
    }
    updated += 1;
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${label} ${message.slice(0, 180)}`);
  } finally {
    client.close();
  }
}

console.log("");
console.log(`anonymous thread-stable posting ${action} complete`);
console.log(`checked: ${rows.length}`);
console.log(`updated: ${updated}`);
console.log(`already_set: ${alreadySet}`);
console.log(`failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);