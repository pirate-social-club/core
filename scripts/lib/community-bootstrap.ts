import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

type CommunityBootstrapSql = {
  execute<T>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
  transaction<T>(fn: (tx: CommunityBootstrapSql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type BootstrapCommunityDatabaseInput = {
  databaseUrl: string;
  databaseAuthToken?: string | null;
  communityId: string;
  userId: string;
  displayName: string;
  namespaceVerificationId: string;
  description?: string | null;
  membershipMode: "open" | "request" | "gated";
  defaultAgeGatePolicy: "none" | "18_plus";
  membershipUniqueHumanProvider?: "self" | "very" | null;
  postingUniqueHumanProvider?: "self" | "very" | null;
  handlePolicyTemplate: "standard" | "premium" | "membership_gated" | "custom";
  handlePricingModel?: string | null;
  namespaceLabel?: string | null;
  now?: Date;
};

export type CommunityTemplateMigrationChecksum = {
  migrationName: string;
  checksum: string;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMMUNITY_MIGRATIONS_DIR = resolve(REPO_ROOT, "db/community-template/migrations");

function createLocalBootstrapSql(databaseUrl: string): CommunityBootstrapSql {
  const sql = new Bun.SQL(databaseUrl) as {
    unsafe<T>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
    begin<T>(fn: (tx: typeof sql) => Promise<T>): Promise<T>;
    close?: () => void;
  };

  return {
    execute(statement, params) {
      return sql.unsafe(statement, params);
    },
    transaction(fn) {
      return sql.begin(async (tx) =>
        fn({
          execute(statement, params) {
            return tx.unsafe(statement, params);
          },
          transaction() {
            throw new Error("nested_local_bootstrap_transactions_not_supported");
          },
          async close() {},
        }),
      );
    },
    async close() {
      sql.close?.();
    },
  };
}

function createRemoteBootstrapSql(input: {
  databaseUrl: string;
  databaseAuthToken: string;
}): CommunityBootstrapSql {
  const client = createClient({
    url: input.databaseUrl,
    authToken: input.databaseAuthToken,
  });

  return {
    async execute<T>(statement, params) {
      const result = await client.execute({
        sql: statement,
        args: params ?? [],
      });
      return result.rows as T[];
    },
    async transaction<T>(fn) {
      const tx = await client.transaction("write");
      const wrapped: CommunityBootstrapSql = {
        async execute<U>(statement, params) {
          const result = await tx.execute({
            sql: statement,
            args: params ?? [],
          });
          return result.rows as U[];
        },
        transaction() {
          throw new Error("nested_remote_bootstrap_transactions_not_supported");
        },
        async close() {},
      };

      try {
        const result = await fn(wrapped);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    },
    async close() {
      client.close();
    },
  };
}

function communityBootstrapSql(input: { databaseUrl: string; databaseAuthToken?: string | null }): CommunityBootstrapSql {
  if (!input.databaseUrl.startsWith("file://")) {
    if (!input.databaseAuthToken) {
      throw new Error("missing_remote_community_db_auth_token");
    }

    return createRemoteBootstrapSql({
      databaseUrl: input.databaseUrl,
      databaseAuthToken: input.databaseAuthToken,
    });
  }

  return createLocalBootstrapSql(input.databaseUrl);
}

function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

async function ensureSchemaMigrationsTable(sql: CommunityBootstrapSql): Promise<void> {
  await sql.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      migration_label TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
      if (char === "\n") {
        inLineComment = false;
      }
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
      if (statement) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    statements.push(trailing);
  }

  return statements;
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(COMMUNITY_MIGRATIONS_DIR, {
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => resolve(COMMUNITY_MIGRATIONS_DIR, entry.name))
    .sort();
}

export async function listExpectedCommunityMigrationChecksums(): Promise<CommunityTemplateMigrationChecksum[]> {
  const results: CommunityTemplateMigrationChecksum[] = [];

  for (const filePath of await listMigrationFiles()) {
    const migrationName = filePath.split("/").at(-1) ?? filePath;
    const migrationSql = await readFile(filePath, "utf8");
    results.push({
      migrationName,
      checksum: checksumSql(migrationSql),
    });
  }

  return results;
}

async function applyCommunityMigrations(sql: CommunityBootstrapSql): Promise<void> {
  await ensureSchemaMigrationsTable(sql);

  for (const filePath of await listMigrationFiles()) {
    const migrationName = filePath.split("/").at(-1) ?? filePath;
    const migrationSql = await readFile(filePath, "utf8");
    const checksum = checksumSql(migrationSql);
    const existing = await sql.execute<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE migration_name = ?",
      [migrationName],
    );
    const existingChecksum = existing[0]?.checksum ?? null;

    if (existingChecksum) {
      if (existingChecksum !== checksum) {
        throw new Error(`schema_migration_checksum_mismatch:${migrationName}`);
      }
      continue;
    }

    await sql.transaction(async (tx) => {
      for (const statement of splitSqlStatements(migrationSql)) {
        await tx.execute(statement);
      }
      await tx.execute(
        `INSERT INTO schema_migrations (
           migration_name,
           migration_label,
           checksum
         ) VALUES (?, ?, ?)`,
        [migrationName, "community-template", checksum],
      );
    });
  }
}

export async function bootstrapCommunityDatabase(
  input: BootstrapCommunityDatabaseInput,
): Promise<{
  databaseUrl: string;
  communityId: string;
  namespaceId: string;
}> {
  const sql = communityBootstrapSql({
    databaseUrl: input.databaseUrl,
    databaseAuthToken: input.databaseAuthToken,
  });
  const timestamp = (input.now ?? new Date()).toISOString();
  const namespaceLabel = input.namespaceLabel?.trim() || input.communityId.toLowerCase();
  const namespaceId = `ns_${input.communityId}`;
  const namespaceHandlePolicyId = `nhp_${input.communityId}`;
  const membershipId = `mbr_${input.communityId}_${input.userId}`;
  const roleAssignmentId = `role_${input.communityId}_${input.userId}_owner`;
  const membershipGateRuleId = `gate_${input.communityId}_membership_unique_human`;
  const postingGateRuleId = `gate_${input.communityId}_posting_unique_human`;
  const membershipGateProofRequirements = input.membershipUniqueHumanProvider
    ? JSON.stringify([{
        proof_type: "unique_human",
        accepted_providers: [input.membershipUniqueHumanProvider],
      }])
    : null;
  const postingGateProofRequirements = input.postingUniqueHumanProvider
    ? JSON.stringify([{
        proof_type: "unique_human",
        accepted_providers: [input.postingUniqueHumanProvider],
      }])
    : null;
  const postingGateConfig = input.postingUniqueHumanProvider
    ? JSON.stringify({
        post_types: ["text"],
        first_post_only: true,
      })
    : null;

  try {
    await applyCommunityMigrations(sql);

    await sql.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO communities (
           community_id,
           display_name,
           description,
           status,
           artist_identity_id,
           artist_governance_state,
           membership_mode,
           default_age_gate_policy,
           allow_anonymous_identity,
           anonymous_identity_scope,
           donation_partner_id,
           donation_policy_mode,
           donation_partner_status,
           governance_mode,
           settings_json,
           created_by_user_id,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'active', NULL, 'fan_run', ?, ?, 0, NULL, NULL, 'none', 'unconfigured', 'centralized', NULL, ?, ?, ?)
         ON CONFLICT(community_id) DO UPDATE SET
           display_name = excluded.display_name,
           description = excluded.description,
           status = excluded.status,
           membership_mode = excluded.membership_mode,
           default_age_gate_policy = excluded.default_age_gate_policy,
           donation_policy_mode = excluded.donation_policy_mode,
           donation_partner_status = excluded.donation_partner_status,
           updated_at = excluded.updated_at`,
        [
          input.communityId,
          input.displayName,
          input.description ?? null,
          input.membershipMode,
          input.defaultAgeGatePolicy,
          input.userId,
          timestamp,
          timestamp,
        ],
      );

      await tx.execute(
        `INSERT INTO community_memberships (
           membership_id,
           community_id,
           user_id,
           status,
           joined_at,
           left_at,
           banned_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'member', ?, NULL, NULL, ?, ?)
         ON CONFLICT(membership_id) DO UPDATE SET
           status = excluded.status,
           joined_at = excluded.joined_at,
           left_at = excluded.left_at,
           banned_at = excluded.banned_at,
           updated_at = excluded.updated_at`,
        [
          membershipId,
          input.communityId,
          input.userId,
          timestamp,
          timestamp,
          timestamp,
        ],
      );

      await tx.execute(
        `INSERT INTO community_roles (
           role_assignment_id,
           community_id,
           user_id,
           role,
           status,
           granted_by_user_id,
           granted_at,
           revoked_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'owner', 'active', ?, ?, NULL, ?, ?)
         ON CONFLICT(role_assignment_id) DO UPDATE SET
           status = excluded.status,
           granted_at = excluded.granted_at,
           revoked_at = excluded.revoked_at,
           updated_at = excluded.updated_at`,
        [
          roleAssignmentId,
          input.communityId,
          input.userId,
          input.userId,
          timestamp,
          timestamp,
          timestamp,
        ],
      );

      await tx.execute(
        `INSERT INTO namespace_bindings (
           namespace_id,
           community_id,
           namespace_verification_id,
           display_label,
           normalized_label,
           resolver_label,
           route_family,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'active', ?, ?)
         ON CONFLICT(namespace_id) DO UPDATE SET
           namespace_verification_id = excluded.namespace_verification_id,
           display_label = excluded.display_label,
           normalized_label = excluded.normalized_label,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        [
          namespaceId,
          input.communityId,
          input.namespaceVerificationId,
          namespaceLabel,
          namespaceLabel,
          timestamp,
          timestamp,
        ],
      );

      await tx.execute(
        `INSERT INTO namespace_handle_policies (
           namespace_handle_policy_id,
           community_id,
           namespace_id,
           policy_template,
           pricing_model,
           membership_required_for_claim,
           settings_json,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)
         ON CONFLICT(namespace_handle_policy_id) DO UPDATE SET
           policy_template = excluded.policy_template,
           pricing_model = excluded.pricing_model,
           membership_required_for_claim = excluded.membership_required_for_claim,
           updated_at = excluded.updated_at`,
        [
          namespaceHandlePolicyId,
          input.communityId,
          namespaceId,
          input.handlePolicyTemplate,
          input.handlePricingModel ?? null,
          timestamp,
          timestamp,
        ],
      );

      await tx.execute(
        `DELETE FROM community_gate_rules
         WHERE gate_rule_id = ?
           AND ? IS NULL`,
        [
          membershipGateRuleId,
          input.membershipUniqueHumanProvider ?? null,
        ],
      );

      if (input.membershipUniqueHumanProvider) {
        await tx.execute(
          `INSERT INTO community_gate_rules (
             gate_rule_id,
             community_id,
             scope,
             gate_family,
             gate_type,
             proof_requirements_json,
             chain_namespace,
             gate_config_json,
             status,
             created_at,
             updated_at
           ) VALUES (?, ?, 'membership', 'identity_proof', 'unique_human', ?, NULL, NULL, 'active', ?, ?)
           ON CONFLICT(gate_rule_id) DO UPDATE SET
             community_id = excluded.community_id,
             scope = excluded.scope,
             gate_family = excluded.gate_family,
             gate_type = excluded.gate_type,
             proof_requirements_json = excluded.proof_requirements_json,
             chain_namespace = excluded.chain_namespace,
             gate_config_json = excluded.gate_config_json,
             status = excluded.status,
             updated_at = excluded.updated_at`,
          [
            membershipGateRuleId,
            input.communityId,
            membershipGateProofRequirements,
            timestamp,
            timestamp,
          ],
        );
      }

      await tx.execute(
        `DELETE FROM community_gate_rules
         WHERE gate_rule_id = ?
           AND ? IS NULL`,
        [
          postingGateRuleId,
          input.postingUniqueHumanProvider ?? null,
        ],
      );

      if (input.postingUniqueHumanProvider) {
        await tx.execute(
          `INSERT INTO community_gate_rules (
             gate_rule_id,
             community_id,
             scope,
             gate_family,
             gate_type,
             proof_requirements_json,
             chain_namespace,
             gate_config_json,
             status,
             created_at,
             updated_at
           ) VALUES (?, ?, 'posting', 'identity_proof', 'unique_human', ?, NULL, ?, 'active', ?, ?)
           ON CONFLICT(gate_rule_id) DO UPDATE SET
             community_id = excluded.community_id,
             scope = excluded.scope,
             gate_family = excluded.gate_family,
             gate_type = excluded.gate_type,
             proof_requirements_json = excluded.proof_requirements_json,
             chain_namespace = excluded.chain_namespace,
             gate_config_json = excluded.gate_config_json,
             status = excluded.status,
             updated_at = excluded.updated_at`,
          [
            postingGateRuleId,
            input.communityId,
            postingGateProofRequirements,
            postingGateConfig,
            timestamp,
            timestamp,
          ],
        );
      }
    });

    return {
      databaseUrl: input.databaseUrl,
      communityId: input.communityId,
      namespaceId,
    };
  } finally {
    await sql.close();
  }
}

export async function createTempCommunityDbUrl(): Promise<string> {
  const path = `/tmp/community-bootstrap-${randomUUID()}.db`;
  await Bun.write(path, "");
  return `file://${path}`;
}
