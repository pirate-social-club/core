import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import type { Client as LibsqlClient, InStatement, Transaction as LibsqlTransaction } from "@libsql/core/api";
import {
  bootstrapCommunityDatabase,
  listExpectedCommunityMigrationChecksums,
  type BootstrapCommunityDatabaseInput,
  type CommunityTemplateMigrationChecksum,
} from "./community-bootstrap";
import { TursoPlatformClient, type TursoPlatformFetch } from "./turso-platform";
import {
  decryptCommunityDbCredential,
  encryptCommunityDbCredential,
} from "./shared/community-db-credential-crypto";

type CommunityRow = {
  community_id: string;
  creator_user_id: string;
  primary_database_binding_id: string | null;
  provisioning_state: string;
  status?: string;
  transfer_state?: string;
  route_slug?: string | null;
};

type NamespaceVerificationRow = {
  namespace_verification_id: string;
  user_id: string;
  status: string;
  club_attach_allowed: number;
  normalized_root_label: string;
};

type BindingRow = {
  community_database_binding_id: string;
  community_id: string;
  organization_slug: string;
  group_name: string;
  database_name: string;
  database_url: string;
  location: string | null;
  status: string;
};

type ActiveCredentialRow = {
  community_db_credential_id: string;
  encrypted_token: string;
  encryption_key_version: number;
  token_name: string;
};

type TaggedQueryExecutor = <T = unknown[]>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;

type ControlPlaneQueryable = {
  sql: TaggedQueryExecutor;
};

type ControlPlaneDatabase = ControlPlaneQueryable & {
  begin<T>(callback: (tx: ControlPlaneQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type ProvisionCommunityInput = {
  controlPlaneDatabaseUrl: string;
  controlPlaneAuthToken?: string | null;
  tursoPlatformApiToken: string;
  tursoOrganizationSlug: string;
  tursoCommunityDbWrapKey: string;
  tursoCommunityDbWrapKeyVersion: number;
  communityId: string;
  creatorUserId: string;
  displayName: string;
  namespaceVerificationId?: string | null;
  groupLocation: string;
  description?: string | null;
  avatarRef?: string | null;
  bannerRef?: string | null;
  membershipMode?: "open" | "request" | "gated";
  defaultAgeGatePolicy?: "none" | "18_plus";
  gatePolicy?: Record<string, unknown> | null;
  membershipUniqueHumanProvider?: "self" | "very" | null;
  postingUniqueHumanProvider?: "self" | "very" | null;
  handlePolicyTemplate?: "standard" | "premium" | "membership_gated" | "custom";
  handlePricingModel?: string | null;
  namespaceLabel?: string | null;
  initialSettings?: Record<string, unknown> | null;
  databaseTokenExpiration?: string | null;
  fetch?: TursoPlatformFetch;
  bootstrapCommunityDatabaseFn?: (
    input: BootstrapCommunityDatabaseInput,
  ) => Promise<{ databaseUrl: string; communityId: string; namespaceId: string | null }>;
  now?: Date;
};

export type ProvisionCommunityResult = {
  communityId: string;
  jobId: string;
  communityDatabaseBindingId: string;
  communityDbCredentialId: string;
  organizationSlug: string;
  groupName: string;
  groupId: string | null;
  databaseName: string;
  databaseId: string | null;
  databaseUrl: string;
  location: string | null;
  tokenName: string;
  plaintextToken: string;
  issuedAt: string;
  expiresAt: string | null;
  rotationNumber: number;
};

export type ProvisionCommunityRuntimeResult = {
  communityId: string;
  organizationSlug: string;
  groupName: string;
  groupId: string | null;
  databaseName: string;
  databaseId: string | null;
  databaseUrl: string;
  location: string | null;
  tokenName: string;
  plaintextToken: string;
  issuedAt: string;
  expiresAt: string | null;
  rotationNumber: number;
};

export type RotateCommunityTokenInput = {
  controlPlaneDatabaseUrl: string;
  controlPlaneAuthToken?: string | null;
  tursoPlatformApiToken: string;
  tursoCommunityDbWrapKey: string;
  tursoCommunityDbWrapKeyVersion: number;
  communityId: string;
  reason?: string | null;
  databaseTokenExpiration?: string | null;
  fetch?: TursoPlatformFetch;
  now?: Date;
};

export type RotateCommunityTokenResult = {
  communityId: string;
  communityDatabaseBindingId: string;
  communityDbCredentialId: string;
  databaseName: string;
  databaseUrl: string;
  tokenName: string;
  rotationNumber: number;
};

export type DoctorInput = {
  controlPlaneDatabaseUrl: string;
  controlPlaneAuthToken?: string | null;
  communityId?: string | null;
  tursoCommunityDbWrapKey?: string | null;
  inspectCommunityDatabaseSchemaFn?: (input: {
    databaseUrl: string;
    databaseAuthToken: string;
    expectedMigrations: CommunityTemplateMigrationChecksum[];
  }) => Promise<{
    missingMigrationNames: string[];
    mismatchedMigrationNames: string[];
    unexpectedMigrationNames: string[];
  }>;
};

export type DoctorFinding = {
  severity: "error";
  code:
    | "community_not_active"
    | "community_transfer_state_invalid"
    | "route_slug_namespace_collision"
    | "community_missing_active_primary_binding"
    | "community_primary_binding_mismatch"
    | "binding_group_name_mismatch"
    | "binding_database_name_mismatch"
    | "binding_database_url_invalid"
    | "binding_missing_active_credential"
    | "binding_schema_migrations_unreadable"
    | "binding_schema_migrations_mismatch";
  communityId: string;
  communityDatabaseBindingId: string | null;
  message: string;
};

export type DoctorResult = {
  checkedCommunityCount: number;
  checkedBindingCount: number;
  checkedCredentialCount: number;
  findingCount: number;
  findings: DoctorFinding[];
};

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function parseRotationNumber(communityId: string, tokenName: string): number {
  const match = new RegExp(`^worker-${communityId}-v(\\d+)$`).exec(tokenName.trim());
  return match ? Number(match[1]) : 0;
}

function requireText(value: string | null | undefined, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function requirePositiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeTursoName(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function buildRegionPoolGroupName(groupLocation: string): string {
  return `region-${normalizeTursoName(groupLocation)}`;
}

function buildCommunityDatabaseName(communityId: string): string {
  return `main-${normalizeTursoName(communityId)}`;
}

function isExpectedDatabaseUrl(
  binding: Pick<BindingRow, "organization_slug" | "group_name" | "database_name" | "database_url">,
): boolean {
  const raw = String(binding.database_url ?? "").trim();
  if (!raw.startsWith("libsql://")) {
    return false;
  }

  try {
    const url = new URL(raw);
    const hostname = url.hostname.trim().toLowerCase();
    const expectedDatabase = normalizeTursoName(binding.database_name);
    const expectedOrganization = normalizeTursoName(binding.organization_slug);
    if (!hostname) {
      return false;
    }
    if (!hostname.endsWith(".turso.io")) {
      return false;
    }
    if (!hostname.startsWith(`${expectedDatabase}-`) && !hostname.startsWith(`${expectedDatabase}.`)) {
      return false;
    }
    if (!hostname.includes(`-${expectedOrganization}.`) && !hostname.includes(`.${expectedOrganization}.`)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isLibsqlControlPlaneUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return normalized.startsWith("libsql:")
    || normalized.startsWith("file:")
    || normalized.startsWith("http:")
    || normalized.startsWith("https:");
}

function normalizeSqlArg(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function compileTaggedStatement(
  strings: TemplateStringsArray,
  values: unknown[],
): { sql: string; args: unknown[] } {
  let sql = "";
  const args: unknown[] = [];

  for (let index = 0; index < strings.length; index += 1) {
    sql += strings[index];
    if (index < values.length) {
      sql += "?";
      args.push(normalizeSqlArg(values[index]));
    }
  }

  return { sql, args };
}

function createLibsqlQueryable(executor: Pick<LibsqlClient, "execute"> | Pick<LibsqlTransaction, "execute">): ControlPlaneQueryable {
  return {
    sql: async <T = unknown[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
      const statement = compileTaggedStatement(strings, values);
      const result = await executor.execute(statement);
      return result.rows as T;
    },
  };
}

function createBunQueryable(executor: Bun.SQL): ControlPlaneQueryable {
  return {
    sql: async <T = unknown[]>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
      return executor<T>(strings, ...values);
    },
  };
}

function openControlPlaneDatabase(input: {
  url: string;
  authToken?: string | null;
}): ControlPlaneDatabase {
  if (isLibsqlControlPlaneUrl(input.url)) {
    const client = createClient({
      url: input.url,
      authToken: input.authToken?.trim() || undefined,
    });

    return {
      ...createLibsqlQueryable(client),
      begin: async <T>(callback: (tx: ControlPlaneQueryable) => Promise<T>): Promise<T> => {
        const tx = await client.transaction("write");
        try {
          const result = await callback(createLibsqlQueryable(tx));
          await tx.commit();
          return result;
        } catch (error) {
          try {
            await tx.rollback();
          } catch {}
          throw error;
        } finally {
          tx.close();
        }
      },
      close: async (): Promise<void> => {
        client.close();
      },
    };
  }

  const db = new Bun.SQL(input.url);
  return {
    ...createBunQueryable(db),
    begin: async <T>(callback: (tx: ControlPlaneQueryable) => Promise<T>): Promise<T> => {
      return db.begin(async (tx) => callback(createBunQueryable(tx as unknown as Bun.SQL)));
    },
    close: async (): Promise<void> => {
      await db.end();
    },
  };
}

async function requireNamespaceVerification(
  db: ControlPlaneQueryable,
  input: {
    namespaceVerificationId: string;
    creatorUserId: string;
  },
): Promise<NamespaceVerificationRow> {
  const rows = await db.sql<NamespaceVerificationRow[]>`
    SELECT
      namespace_verification_id,
      user_id,
      status,
      club_attach_allowed,
      normalized_root_label
    FROM namespace_verifications
    WHERE namespace_verification_id = ${input.namespaceVerificationId}
  `;
  const row = rows[0] ?? null;

  if (!row) {
    throw new Error(`namespace verification not found: ${input.namespaceVerificationId}`);
  }
  if (row.user_id !== input.creatorUserId) {
    throw new Error("namespace verification does not belong to the provided creator user");
  }
  if (row.status !== "verified" || Number(row.club_attach_allowed) !== 1) {
    throw new Error("namespace verification is not attachable");
  }
  return row;
}

async function getCommunityByNamespaceVerificationId(
  db: ControlPlaneQueryable,
  namespaceVerificationId: string,
): Promise<CommunityRow | null> {
  const rows = await db.sql<CommunityRow[]>`
    SELECT community_id, creator_user_id, primary_database_binding_id, provisioning_state
    FROM communities
    WHERE namespace_verification_id = ${namespaceVerificationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getPrimaryBindingByCommunityId(
  db: ControlPlaneQueryable,
  communityId: string,
): Promise<BindingRow | null> {
  const rows = await db.sql<BindingRow[]>`
    SELECT
      community_database_binding_id,
      community_id,
      organization_slug,
      group_name,
      database_name,
      database_url,
      location,
      status
    FROM community_database_bindings
    WHERE community_id = ${communityId}
      AND binding_role = 'primary'
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getActivePrimaryBindingsByCommunityId(
  db: ControlPlaneQueryable,
  communityId: string,
): Promise<BindingRow[]> {
  return db.sql<BindingRow[]>`
    SELECT
      community_database_binding_id,
      community_id,
      organization_slug,
      group_name,
      database_name,
      database_url,
      location,
      status
    FROM community_database_bindings
    WHERE community_id = ${communityId}
      AND binding_role = 'primary'
      AND status = 'active'
    ORDER BY created_at DESC
  `;
}

async function getActiveNamespaceCollisionCommunityIds(
  db: ControlPlaneQueryable,
  input: {
    communityId: string;
    routeSlug: string;
  },
): Promise<string[]> {
  const rows = await db.sql<{ community_id: string }[]>`
    SELECT c.community_id
    FROM communities AS c
    INNER JOIN namespace_verifications AS nv
      ON nv.namespace_verification_id = c.namespace_verification_id
    WHERE c.community_id <> ${input.communityId}
      AND c.status = 'active'
      AND c.provisioning_state = 'active'
      AND nv.normalized_root_label = ${input.routeSlug}
    ORDER BY c.created_at DESC, c.community_id DESC
  `;
  return rows.map((row) => row.community_id);
}

async function getNextRotationNumber(
  db: ControlPlaneQueryable,
  input: {
    communityId: string;
  },
): Promise<number> {
  const rows = await db.sql<{ token_name: string }[]>`
    SELECT cdc.token_name
    FROM community_db_credentials AS cdc
    INNER JOIN community_database_bindings AS cdb
      ON cdb.community_database_binding_id = cdc.community_database_binding_id
    WHERE cdb.community_id = ${input.communityId}
  `;

  let maxVersion = 0;
  for (const row of rows) {
    maxVersion = Math.max(maxVersion, parseRotationNumber(input.communityId, String(row.token_name ?? "")));
  }
  return maxVersion + 1;
}

async function writeActiveCommunityCredential(
  tx: ControlPlaneQueryable,
  input: {
    communityDatabaseBindingId: string;
    communityDbCredentialId: string;
    tokenName: string;
    encryptedToken: string;
    encryptionKeyVersion: number;
    timestamp: string;
  },
): Promise<void> {
  await tx.sql`
    UPDATE community_db_credentials
    SET status = 'superseded',
        invalidated_at = ${input.timestamp},
        updated_at = ${input.timestamp}
    WHERE community_database_binding_id = ${input.communityDatabaseBindingId}
      AND status = 'active'
  `;

  await tx.sql`
    INSERT INTO community_db_credentials (
      community_db_credential_id,
      community_database_binding_id,
      credential_kind,
      token_name,
      encrypted_token,
      encryption_key_version,
      token_scope,
      status,
      issued_at,
      invalidated_at,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      ${input.communityDbCredentialId},
      ${input.communityDatabaseBindingId},
      'database_token',
      ${input.tokenName},
      ${input.encryptedToken},
      ${input.encryptionKeyVersion},
      'database',
      'active',
      ${input.timestamp},
      NULL,
      NULL,
      ${input.timestamp},
      ${input.timestamp}
    )
  `;
}

async function getActiveCredentialCount(
  db: ControlPlaneQueryable,
  communityDatabaseBindingId: string,
): Promise<number> {
  const rows = await db.sql<{ count: number }[]>`
    SELECT COUNT(*) AS count
    FROM community_db_credentials
    WHERE community_database_binding_id = ${communityDatabaseBindingId}
      AND status = 'active'
  `;
  return Number(rows[0]?.count ?? 0);
}

async function getActiveCredentialRow(
  db: ControlPlaneQueryable,
  communityDatabaseBindingId: string,
): Promise<ActiveCredentialRow | null> {
  const rows = await db.sql<ActiveCredentialRow[]>`
    SELECT
      community_db_credential_id,
      encrypted_token,
      encryption_key_version,
      token_name
    FROM community_db_credentials
    WHERE community_database_binding_id = ${communityDatabaseBindingId}
      AND status = 'active'
    ORDER BY issued_at DESC, created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function inspectCommunityDatabaseSchema(input: {
  databaseUrl: string;
  databaseAuthToken: string;
  expectedMigrations: CommunityTemplateMigrationChecksum[];
}): Promise<{
  missingMigrationNames: string[];
  mismatchedMigrationNames: string[];
  unexpectedMigrationNames: string[];
}> {
  const client = createClient({
    url: input.databaseUrl,
    authToken: input.databaseAuthToken,
  });

  try {
    const result = await client.execute(`
      SELECT migration_name, checksum
      FROM schema_migrations
      ORDER BY migration_name ASC
    `);

    const actualByName = new Map<string, string>();
    for (const row of result.rows as Array<{ migration_name?: unknown; checksum?: unknown }>) {
      const migrationName = String(row.migration_name ?? "").trim();
      const checksum = String(row.checksum ?? "").trim();
      if (migrationName) {
        actualByName.set(migrationName, checksum);
      }
    }

    const missingMigrationNames: string[] = [];
    const mismatchedMigrationNames: string[] = [];
    const expectedNames = new Set<string>();

    for (const expected of input.expectedMigrations) {
      expectedNames.add(expected.migrationName);
      const actualChecksum = actualByName.get(expected.migrationName);
      if (!actualChecksum) {
        missingMigrationNames.push(expected.migrationName);
        continue;
      }
      if (actualChecksum !== expected.checksum) {
        mismatchedMigrationNames.push(expected.migrationName);
      }
    }

    const unexpectedMigrationNames: string[] = [];
    for (const migrationName of actualByName.keys()) {
      if (!expectedNames.has(migrationName)) {
        unexpectedMigrationNames.push(migrationName);
      }
    }

    return {
      missingMigrationNames,
      mismatchedMigrationNames,
      unexpectedMigrationNames,
    };
  } finally {
    client.close();
  }
}

export async function provisionCommunity(
  input: ProvisionCommunityInput,
): Promise<ProvisionCommunityResult> {
  const controlPlaneDatabaseUrl = requireText(input.controlPlaneDatabaseUrl, "controlPlaneDatabaseUrl");
  const controlPlaneAuthToken = input.controlPlaneAuthToken?.trim() || null;
  const tursoPlatformApiToken = requireText(input.tursoPlatformApiToken, "tursoPlatformApiToken");
  const tursoOrganizationSlug = requireText(input.tursoOrganizationSlug, "tursoOrganizationSlug");
  const tursoCommunityDbWrapKey = requireText(input.tursoCommunityDbWrapKey, "tursoCommunityDbWrapKey");
  const tursoCommunityDbWrapKeyVersion = requirePositiveInt(
    input.tursoCommunityDbWrapKeyVersion,
    "tursoCommunityDbWrapKeyVersion",
  );
  const communityId = requireText(input.communityId, "communityId");
  const creatorUserId = requireText(input.creatorUserId, "creatorUserId");
  const displayName = requireText(input.displayName, "displayName");
  const namespaceVerificationId = input.namespaceVerificationId?.trim() || null;
  const groupLocation = requireText(input.groupLocation, "groupLocation");
  const databaseTokenExpiration = input.databaseTokenExpiration?.trim() || null;
  const databaseName = buildCommunityDatabaseName(communityId);
  const groupName = buildRegionPoolGroupName(groupLocation);
  const bindingIdFallback = `cdb_${communityId}_primary`;
  const bootstrapFn = input.bootstrapCommunityDatabaseFn ?? bootstrapCommunityDatabase;
  const timestamp = nowIso(input.now ?? new Date());
  const jobId = makeId("job");
  const credentialId = makeId("cdc");
  const successAuditId = makeId("aud");
  const failureAuditId = makeId("aud");
  let db: ControlPlaneDatabase | null = null;

  try {
    db = openControlPlaneDatabase({
      url: controlPlaneDatabaseUrl,
      authToken: controlPlaneAuthToken,
    });
    const namespaceVerification = namespaceVerificationId
      ? await requireNamespaceVerification(db, {
          namespaceVerificationId,
          creatorUserId,
        })
      : null;
    const existingCommunity = namespaceVerificationId
      ? await getCommunityByNamespaceVerificationId(db, namespaceVerificationId)
      : null;
    if (namespaceVerificationId && existingCommunity && existingCommunity.community_id !== communityId) {
      throw new Error(
        `namespace verification already attached to a different community: ${existingCommunity.community_id}`,
      );
    }

    const existingBinding = await getPrimaryBindingByCommunityId(db, communityId);
    const bindingId = existingBinding?.community_database_binding_id ?? bindingIdFallback;

    await db.begin(async (tx) => {
      await tx.sql`
        INSERT INTO communities (
          community_id,
          creator_user_id,
          display_name,
          membership_mode,
          status,
          provisioning_state,
          transfer_state,
          route_slug,
          namespace_verification_id,
          primary_database_binding_id,
          created_at,
          updated_at
        ) VALUES (
          ${communityId},
          ${creatorUserId},
          ${displayName},
          ${input.membershipMode ?? "open"},
          'active',
          'provisioning',
          'none',
          NULL,
          ${namespaceVerificationId},
          ${existingCommunity?.primary_database_binding_id ?? null},
          ${timestamp},
          ${timestamp}
        )
        ON CONFLICT (community_id) DO UPDATE SET
          creator_user_id = EXCLUDED.creator_user_id,
          display_name = EXCLUDED.display_name,
          membership_mode = EXCLUDED.membership_mode,
          status = EXCLUDED.status,
          provisioning_state = EXCLUDED.provisioning_state,
          transfer_state = EXCLUDED.transfer_state,
          namespace_verification_id = EXCLUDED.namespace_verification_id,
          updated_at = EXCLUDED.updated_at
      `;

      await tx.sql`
        INSERT INTO jobs (
          job_id,
          job_type,
          job_scope,
          community_id,
          subject_type,
          subject_id,
          status,
          payload_json,
          result_ref,
          error_code,
          attempt_count,
          available_at,
          created_at,
          updated_at
        ) VALUES (
          ${jobId},
          'community_provisioning',
          'platform',
          ${communityId},
          'community',
          ${communityId},
          'running',
          ${JSON.stringify({
            mode: "turso",
            namespace_verification_id: namespaceVerificationId,
            organization_slug: tursoOrganizationSlug,
            group_name: groupName,
            group_location: groupLocation,
            database_name: databaseName,
          })},
          NULL,
          NULL,
          1,
          ${timestamp},
          ${timestamp},
          ${timestamp}
        )
      `;
    });

    const platform = new TursoPlatformClient({
      apiToken: tursoPlatformApiToken,
      fetch: input.fetch,
    });

    let group = (await platform.listGroups(tursoOrganizationSlug))
      .find((entry) => entry.name === groupName)
      ?? await platform.createGroup({
        organizationSlug: tursoOrganizationSlug,
        groupName,
        location: groupLocation,
      });

    if (group.deleteProtection !== true) {
      group = {
        ...group,
        ...await platform.updateGroupConfiguration({
          organizationSlug: tursoOrganizationSlug,
          groupName,
          deleteProtection: true,
        }),
      };
    }

    let database = (await platform.listDatabases({
      organizationSlug: tursoOrganizationSlug,
      groupName,
    }))
      .find((entry) => entry.name === databaseName)
      ?? await platform.createDatabase({
        organizationSlug: tursoOrganizationSlug,
        databaseName,
        groupName,
      });

    if (database.deleteProtection !== true) {
      database = {
        ...database,
        ...await platform.updateDatabaseConfiguration({
          organizationSlug: tursoOrganizationSlug,
          databaseName,
          deleteProtection: true,
        }),
      };
    }

    const databaseUrl = requireText(database.libsqlUrl, "database.libsqlUrl");
    const minted = await platform.createDatabaseAuthToken({
      organizationSlug: tursoOrganizationSlug,
      databaseName,
      expiration: databaseTokenExpiration ?? undefined,
      authorization: "full-access",
    });
    const plaintextToken = requireText(minted.jwt, "minted database auth token");

    const namespaceLabel = input.namespaceLabel?.trim() || namespaceVerification?.normalized_root_label || null;
    await bootstrapFn({
      databaseUrl,
      databaseAuthToken: plaintextToken,
      communityId,
      userId: creatorUserId,
      displayName,
      namespaceVerificationId,
      description: input.description?.trim() || null,
      avatarRef: input.avatarRef?.trim() || null,
      bannerRef: input.bannerRef?.trim() || null,
      membershipMode: input.membershipMode ?? "open",
      defaultAgeGatePolicy: input.defaultAgeGatePolicy ?? "none",
      gatePolicy: input.gatePolicy ?? null,
      membershipUniqueHumanProvider: input.membershipUniqueHumanProvider ?? null,
      postingUniqueHumanProvider: input.postingUniqueHumanProvider ?? null,
      handlePolicyTemplate: input.handlePolicyTemplate ?? "standard",
      handlePricingModel: input.handlePricingModel ?? null,
      namespaceLabel,
      initialSettings: input.initialSettings ?? null,
      now: input.now ?? new Date(),
    });

    const rotationNumber = await getNextRotationNumber(db, {
      communityId,
    });
    const tokenName = `worker-${communityId}-v${rotationNumber}`;
    const encryptedToken = encryptCommunityDbCredential({
      plaintextToken,
      wrapKey: tursoCommunityDbWrapKey,
    });

    await db.begin(async (tx) => {
      await tx.sql`
        INSERT INTO community_database_bindings (
          community_database_binding_id,
          community_id,
          binding_role,
          organization_slug,
          group_name,
          group_id,
          database_name,
          database_id,
          database_url,
          location,
          status,
          transferred_at,
          created_at,
          updated_at
        ) VALUES (
          ${bindingId},
          ${communityId},
          'primary',
          ${tursoOrganizationSlug},
          ${groupName},
          ${group.uuid},
          ${databaseName},
          ${database.dbId},
          ${databaseUrl},
          ${groupLocation},
          'active',
          NULL,
          ${timestamp},
          ${timestamp}
        )
        ON CONFLICT (community_database_binding_id) DO UPDATE SET
          organization_slug = EXCLUDED.organization_slug,
          group_name = EXCLUDED.group_name,
          group_id = EXCLUDED.group_id,
          database_name = EXCLUDED.database_name,
          database_id = EXCLUDED.database_id,
          database_url = EXCLUDED.database_url,
          location = EXCLUDED.location,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `;

      await writeActiveCommunityCredential(tx, {
        communityDatabaseBindingId: bindingId,
        communityDbCredentialId: credentialId,
        tokenName,
        encryptedToken,
        encryptionKeyVersion: tursoCommunityDbWrapKeyVersion,
        timestamp,
      });

      await tx.sql`
        UPDATE communities
        SET primary_database_binding_id = ${bindingId},
            provisioning_state = 'active',
            updated_at = ${timestamp}
        WHERE community_id = ${communityId}
      `;

      await tx.sql`
        UPDATE jobs
        SET status = 'succeeded',
            result_ref = ${databaseUrl},
            error_code = NULL,
            updated_at = ${timestamp}
        WHERE job_id = ${jobId}
      `;

      await tx.sql`
        INSERT INTO audit_log (
          audit_event_id,
          actor_type,
          actor_id,
          action,
          target_type,
          target_id,
          community_id,
          metadata_json,
          created_at
        ) VALUES (
          ${successAuditId},
          'system',
          NULL,
          'community.turso_provisioning_succeeded',
          'community',
          ${communityId},
          ${communityId},
          ${JSON.stringify({
            job_id: jobId,
            binding_id: bindingId,
            credential_id: credentialId,
            organization_slug: tursoOrganizationSlug,
            group_name: groupName,
            database_name: databaseName,
            database_url: databaseUrl,
            token_name: tokenName,
            rotation_number: rotationNumber,
          })},
          ${timestamp}
        )
      `;
    });

    return {
      communityId,
      jobId,
      communityDatabaseBindingId: bindingId,
      communityDbCredentialId: credentialId,
      organizationSlug: tursoOrganizationSlug,
      groupName,
      groupId: group.uuid ?? null,
      databaseName,
      databaseId: database.dbId ?? null,
      databaseUrl,
      location: groupLocation,
      tokenName,
      plaintextToken,
      issuedAt: timestamp,
      expiresAt: null,
      rotationNumber,
    };
  } catch (error) {
    const failureAt = nowIso(new Date());
    const message = error instanceof Error ? error.message : String(error);

    try {
      await db.begin(async (tx) => {
        await tx.sql`
          UPDATE jobs
          SET status = 'failed',
              error_code = 'community_turso_provisioning_failed',
              result_ref = NULL,
              updated_at = ${failureAt}
          WHERE job_id = ${jobId}
        `;

        await tx.sql`
          UPDATE communities
          SET provisioning_state = 'error',
              updated_at = ${failureAt}
          WHERE community_id = ${communityId}
        `;

        await tx.sql`
          INSERT INTO audit_log (
            audit_event_id,
            actor_type,
            actor_id,
            action,
            target_type,
            target_id,
            community_id,
            metadata_json,
            created_at
          ) VALUES (
            ${failureAuditId},
            'system',
            NULL,
            'community.turso_provisioning_failed',
            'community',
            ${communityId},
            ${communityId},
            ${JSON.stringify({
              job_id: jobId,
              error: message,
            })},
            ${failureAt}
          )
        `;
      });
    } catch {}
    throw error;
  } finally {
    if (db) {
      await db.close();
    }
  }
}

export async function provisionCommunityRuntime(
  input: ProvisionCommunityInput,
): Promise<ProvisionCommunityRuntimeResult> {
  const controlPlaneDatabaseUrl = requireText(input.controlPlaneDatabaseUrl, "controlPlaneDatabaseUrl");
  const controlPlaneAuthToken = input.controlPlaneAuthToken?.trim() || null;
  const tursoPlatformApiToken = requireText(input.tursoPlatformApiToken, "tursoPlatformApiToken");
  const tursoOrganizationSlug = requireText(input.tursoOrganizationSlug, "tursoOrganizationSlug");
  const communityId = requireText(input.communityId, "communityId");
  const creatorUserId = requireText(input.creatorUserId, "creatorUserId");
  const displayName = requireText(input.displayName, "displayName");
  const namespaceVerificationId = input.namespaceVerificationId?.trim() || null;
  const groupLocation = requireText(input.groupLocation, "groupLocation");
  const databaseTokenExpiration = input.databaseTokenExpiration?.trim() || null;
  const databaseName = buildCommunityDatabaseName(communityId);
  const groupName = buildRegionPoolGroupName(groupLocation);
  const bootstrapFn = input.bootstrapCommunityDatabaseFn ?? bootstrapCommunityDatabase;
  const timestamp = nowIso(input.now ?? new Date());
  let db: ControlPlaneDatabase | null = null;

  try {
    db = openControlPlaneDatabase({
      url: controlPlaneDatabaseUrl,
      authToken: controlPlaneAuthToken,
    });
    const namespaceVerification = namespaceVerificationId
      ? await requireNamespaceVerification(db, {
          namespaceVerificationId,
          creatorUserId,
        })
      : null;

    const platform = new TursoPlatformClient({
      apiToken: tursoPlatformApiToken,
      fetch: input.fetch,
    });

    let group = (await platform.listGroups(tursoOrganizationSlug))
      .find((entry) => entry.name === groupName)
      ?? await platform.createGroup({
        organizationSlug: tursoOrganizationSlug,
        groupName,
        location: groupLocation,
      });

    if (group.deleteProtection !== true) {
      group = {
        ...group,
        ...await platform.updateGroupConfiguration({
          organizationSlug: tursoOrganizationSlug,
          groupName,
          deleteProtection: true,
        }),
      };
    }

    let database = (await platform.listDatabases({
      organizationSlug: tursoOrganizationSlug,
      groupName,
    }))
      .find((entry) => entry.name === databaseName)
      ?? await platform.createDatabase({
        organizationSlug: tursoOrganizationSlug,
        databaseName,
        groupName,
      });

    if (database.deleteProtection !== true) {
      database = {
        ...database,
        ...await platform.updateDatabaseConfiguration({
          organizationSlug: tursoOrganizationSlug,
          databaseName,
          deleteProtection: true,
        }),
      };
    }

    const databaseUrl = requireText(database.libsqlUrl, "database.libsqlUrl");
    const minted = await platform.createDatabaseAuthToken({
      organizationSlug: tursoOrganizationSlug,
      databaseName,
      expiration: databaseTokenExpiration ?? undefined,
      authorization: "full-access",
    });
    const plaintextToken = requireText(minted.jwt, "minted database auth token");

    const namespaceLabel = input.namespaceLabel?.trim() || namespaceVerification?.normalized_root_label || null;
    await bootstrapFn({
      databaseUrl,
      databaseAuthToken: plaintextToken,
      communityId,
      userId: creatorUserId,
      displayName,
      namespaceVerificationId,
      description: input.description?.trim() || null,
      avatarRef: input.avatarRef?.trim() || null,
      bannerRef: input.bannerRef?.trim() || null,
      membershipMode: input.membershipMode ?? "open",
      defaultAgeGatePolicy: input.defaultAgeGatePolicy ?? "none",
      gatePolicy: input.gatePolicy ?? null,
      membershipUniqueHumanProvider: input.membershipUniqueHumanProvider ?? null,
      postingUniqueHumanProvider: input.postingUniqueHumanProvider ?? null,
      handlePolicyTemplate: input.handlePolicyTemplate ?? "standard",
      handlePricingModel: input.handlePricingModel ?? null,
      namespaceLabel,
      initialSettings: input.initialSettings ?? null,
      now: input.now ?? new Date(),
    });

    const rotationNumber = await getNextRotationNumber(db, {
      communityId,
    });
    const tokenName = `worker-${communityId}-v${rotationNumber}`;

    return {
      communityId,
      organizationSlug: tursoOrganizationSlug,
      groupName,
      groupId: group.uuid ?? null,
      databaseName,
      databaseId: database.dbId ?? null,
      databaseUrl,
      location: groupLocation,
      tokenName,
      plaintextToken,
      issuedAt: timestamp,
      expiresAt: null,
      rotationNumber,
    };
  } finally {
    if (db) {
      await db.close();
    }
  }
}

export async function rotateCommunityToken(
  input: RotateCommunityTokenInput,
): Promise<RotateCommunityTokenResult> {
  const controlPlaneDatabaseUrl = requireText(input.controlPlaneDatabaseUrl, "controlPlaneDatabaseUrl");
  const controlPlaneAuthToken = input.controlPlaneAuthToken?.trim() || null;
  const tursoPlatformApiToken = requireText(input.tursoPlatformApiToken, "tursoPlatformApiToken");
  const tursoCommunityDbWrapKey = requireText(input.tursoCommunityDbWrapKey, "tursoCommunityDbWrapKey");
  const tursoCommunityDbWrapKeyVersion = requirePositiveInt(
    input.tursoCommunityDbWrapKeyVersion,
    "tursoCommunityDbWrapKeyVersion",
  );
  const communityId = requireText(input.communityId, "communityId");
  const timestamp = nowIso(input.now ?? new Date());
  const reason = input.reason?.trim() || null;
  const databaseTokenExpiration = input.databaseTokenExpiration?.trim() || null;
  const credentialId = makeId("cdc");
  const auditEventId = makeId("aud");
  let db: ControlPlaneDatabase | null = null;

  try {
    db = openControlPlaneDatabase({
      url: controlPlaneDatabaseUrl,
      authToken: controlPlaneAuthToken,
    });
    const communityRows = await db.sql<CommunityRow[]>`
      SELECT community_id, creator_user_id, primary_database_binding_id, provisioning_state, status, transfer_state
      FROM communities
      WHERE community_id = ${communityId}
      LIMIT 1
    `;
    const community = communityRows[0] ?? null;
    if (!community) {
      throw new Error(`community not found: ${communityId}`);
    }

    const binding = await getPrimaryBindingByCommunityId(db, communityId);
    if (!binding || binding.status !== "active") {
      throw new Error(`active primary community database binding not found: ${communityId}`);
    }

    const rotationNumber = await getNextRotationNumber(db, {
      communityId,
    });
    const tokenName = `worker-${communityId}-v${rotationNumber}`;

    const platform = new TursoPlatformClient({
      apiToken: tursoPlatformApiToken,
      fetch: input.fetch,
    });
    const minted = await platform.createDatabaseAuthToken({
      organizationSlug: binding.organization_slug,
      databaseName: binding.database_name,
      expiration: databaseTokenExpiration ?? undefined,
      authorization: "full-access",
    });
    const plaintextToken = requireText(minted.jwt, "minted database auth token");
    const encryptedToken = encryptCommunityDbCredential({
      plaintextToken,
      wrapKey: tursoCommunityDbWrapKey,
    });

    await db.begin(async (tx) => {
      await writeActiveCommunityCredential(tx, {
        communityDatabaseBindingId: binding.community_database_binding_id,
        communityDbCredentialId: credentialId,
        tokenName,
        encryptedToken,
        encryptionKeyVersion: tursoCommunityDbWrapKeyVersion,
        timestamp,
      });

      await tx.sql`
        UPDATE communities
        SET updated_at = ${timestamp}
        WHERE community_id = ${communityId}
      `;

      await tx.sql`
        INSERT INTO audit_log (
          audit_event_id,
          actor_type,
          actor_id,
          action,
          target_type,
          target_id,
          community_id,
          metadata_json,
          created_at
        ) VALUES (
          ${auditEventId},
          'system',
          NULL,
          'community.turso_token_rotated',
          'community',
          ${communityId},
          ${communityId},
          ${JSON.stringify({
            binding_id: binding.community_database_binding_id,
            credential_id: credentialId,
            token_name: tokenName,
            rotation_number: rotationNumber,
            reason,
          })},
          ${timestamp}
        )
      `;
    });
    return {
      communityId,
      communityDatabaseBindingId: binding.community_database_binding_id,
      communityDbCredentialId: credentialId,
      databaseName: binding.database_name,
      databaseUrl: binding.database_url,
      tokenName,
      rotationNumber,
    };
  } catch (error) {
    throw error;
  } finally {
    if (db) {
      await db.close();
    }
  }
}

export async function doctorControlPlane(
  input: DoctorInput,
): Promise<DoctorResult> {
  const controlPlaneDatabaseUrl = requireText(input.controlPlaneDatabaseUrl, "controlPlaneDatabaseUrl");
  const controlPlaneAuthToken = input.controlPlaneAuthToken?.trim() || null;
  const communityId = input.communityId?.trim() || null;
  const tursoCommunityDbWrapKey = input.tursoCommunityDbWrapKey?.trim() || null;
  const inspectCommunityDatabaseSchemaFn = input.inspectCommunityDatabaseSchemaFn ?? inspectCommunityDatabaseSchema;
  let db: ControlPlaneDatabase | null = null;

  try {
    db = openControlPlaneDatabase({
      url: controlPlaneDatabaseUrl,
      authToken: controlPlaneAuthToken,
    });
    const findings: DoctorFinding[] = [];
    let checkedCommunityCount = 0;
    let checkedBindingCount = 0;
    let checkedCredentialCount = 0;
    const expectedMigrations = await listExpectedCommunityMigrationChecksums();

    let communities: CommunityRow[];
    if (communityId) {
      communities = await db.sql<CommunityRow[]>`
        SELECT community_id, creator_user_id, primary_database_binding_id, provisioning_state, status, transfer_state, route_slug
        FROM communities
        WHERE community_id = ${communityId}
      `;
      if (communities.length === 0) {
        throw new Error(`community not found: ${communityId}`);
      }
    } else {
      communities = await db.sql<CommunityRow[]>`
        SELECT community_id, creator_user_id, primary_database_binding_id, provisioning_state, status, transfer_state, route_slug
        FROM communities
        WHERE status = 'active'
          AND provisioning_state = 'active'
        ORDER BY community_id ASC
      `;
    }

    for (const community of communities) {
      checkedCommunityCount += 1;

      if (community.status !== "active" || community.provisioning_state !== "active") {
        findings.push({
          severity: "error",
          code: "community_not_active",
          communityId: community.community_id,
          communityDatabaseBindingId: community.primary_database_binding_id,
          message: `community is not fully active (status=${community.status ?? "unknown"}, provisioning_state=${community.provisioning_state})`,
        });
        continue;
      }

      if ((community.transfer_state ?? "none") !== "none") {
        findings.push({
          severity: "error",
          code: "community_transfer_state_invalid",
          communityId: community.community_id,
          communityDatabaseBindingId: community.primary_database_binding_id,
          message: `community transfer_state must equal none; found ${community.transfer_state ?? "unknown"}`,
        });
      }

      const routeSlug = String(community.route_slug ?? "").trim().toLowerCase();
      if (routeSlug) {
        const collisions = await getActiveNamespaceCollisionCommunityIds(db, {
          communityId: community.community_id,
          routeSlug,
        });
        if (collisions.length > 0) {
          findings.push({
            severity: "error",
            code: "route_slug_namespace_collision",
            communityId: community.community_id,
            communityDatabaseBindingId: community.primary_database_binding_id,
            message: `community route_slug "${routeSlug}" conflicts with active namespace label on ${collisions.join(", ")}`,
          });
        }
      }

      const activeBindings = await getActivePrimaryBindingsByCommunityId(db, community.community_id);
      if (activeBindings.length !== 1) {
        findings.push({
          severity: "error",
          code: "community_missing_active_primary_binding",
          communityId: community.community_id,
          communityDatabaseBindingId: community.primary_database_binding_id,
          message: `community must have exactly one active primary binding; found ${activeBindings.length}`,
        });
        continue;
      }

      const binding = activeBindings[0];
      checkedBindingCount += 1;

      if (community.primary_database_binding_id !== binding.community_database_binding_id) {
        findings.push({
          severity: "error",
          code: "community_primary_binding_mismatch",
          communityId: community.community_id,
          communityDatabaseBindingId: binding.community_database_binding_id,
          message: "community.primary_database_binding_id does not match the active primary binding",
        });
      }

      const expectedGroupName = binding.location ? buildRegionPoolGroupName(binding.location) : null;
      if (binding.group_name !== expectedGroupName) {
        findings.push({
          severity: "error",
          code: "binding_group_name_mismatch",
          communityId: community.community_id,
          communityDatabaseBindingId: binding.community_database_binding_id,
          message: expectedGroupName
            ? `binding group_name must equal ${expectedGroupName}`
            : "binding location is required to validate region-pool group_name",
        });
      }

      const expectedDatabaseName = buildCommunityDatabaseName(community.community_id);
      if (binding.database_name !== expectedDatabaseName) {
        findings.push({
          severity: "error",
          code: "binding_database_name_mismatch",
          communityId: community.community_id,
          communityDatabaseBindingId: binding.community_database_binding_id,
          message: `binding database_name must equal ${expectedDatabaseName}`,
        });
      }

      if (!isExpectedDatabaseUrl(binding)) {
        findings.push({
          severity: "error",
          code: "binding_database_url_invalid",
          communityId: community.community_id,
          communityDatabaseBindingId: binding.community_database_binding_id,
          message: "binding database_url is not a valid expected libsql URL for this group/database",
        });
      }

      const activeCredentialCount = await getActiveCredentialCount(
        db,
        binding.community_database_binding_id,
      );
      if (activeCredentialCount !== 1) {
        findings.push({
          severity: "error",
          code: "binding_missing_active_credential",
          communityId: community.community_id,
          communityDatabaseBindingId: binding.community_database_binding_id,
          message: `binding must have exactly one active encrypted credential; found ${activeCredentialCount}`,
        });
      } else {
        checkedCredentialCount += 1;

        try {
          const credential = await getActiveCredentialRow(db, binding.community_database_binding_id);
          if (!credential) {
            throw new Error("active_credential_row_not_found");
          }
          if (!tursoCommunityDbWrapKey) {
            throw new Error("missing_turso_community_db_wrap_key");
          }

          const databaseAuthToken = decryptCommunityDbCredential({
            encryptedToken: credential.encrypted_token,
            encryptionKeyVersion: credential.encryption_key_version,
            wrapKey: tursoCommunityDbWrapKey,
          });

          const schemaInspection = await inspectCommunityDatabaseSchemaFn({
            databaseUrl: binding.database_url,
            databaseAuthToken,
            expectedMigrations,
          });

          if (
            schemaInspection.missingMigrationNames.length > 0
            || schemaInspection.mismatchedMigrationNames.length > 0
            || schemaInspection.unexpectedMigrationNames.length > 0
          ) {
            findings.push({
              severity: "error",
              code: "binding_schema_migrations_mismatch",
              communityId: community.community_id,
              communityDatabaseBindingId: binding.community_database_binding_id,
              message: `binding schema_migrations drift detected (missing=${schemaInspection.missingMigrationNames.length}, mismatched=${schemaInspection.mismatchedMigrationNames.length}, unexpected=${schemaInspection.unexpectedMigrationNames.length})`,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          findings.push({
            severity: "error",
            code: "binding_schema_migrations_unreadable",
            communityId: community.community_id,
            communityDatabaseBindingId: binding.community_database_binding_id,
            message: `binding schema_migrations could not be verified: ${message}`,
          });
        }
      }
    }

    return {
      checkedCommunityCount,
      checkedBindingCount,
      checkedCredentialCount,
      findingCount: findings.length,
      findings,
    };
  } catch (error) {
    throw error;
  } finally {
    if (db) {
      await db.close();
    }
  }
}
