const REQUIRED_CONTROL_PLANE_ROLES = [
  "control_plane_migrator",
  "control_plane_api_rw",
  "control_plane_api_ro",
  "control_plane_ops_ro",
] as const;

const CONTROL_PLANE_RLS_TABLES = [
  "community_db_credentials",
  "community_database_bindings",
  "auth_provider_links",
  "verification_sessions",
  "user_attestations",
  "jobs",
  "audit_log",
] as const;

type ControlPlaneRole = typeof REQUIRED_CONTROL_PLANE_ROLES[number];
type ControlPlaneRlsTable = typeof CONTROL_PLANE_RLS_TABLES[number];

export type ApplyControlPlaneSecurityHardeningInput = {
  sql: Bun.SQL;
  databaseName: string;
  logger?: (line: string) => void;
  allowMissingPgAudit?: boolean;
};

export type HardeningControlPlanePostgresInput = {
  databaseUrl: string;
  logger?: (line: string) => void;
  allowMissingPgAudit?: boolean;
};

export type ControlPlaneSecurityHardeningResult = {
  databaseName: string;
  schemaMigrationsGrantApplied: boolean;
  pgauditConfigured: boolean;
  pgauditError: string | null;
  hardenedTables: ControlPlaneRlsTable[];
  missingTables: ControlPlaneRlsTable[];
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function roleList(roles: readonly ControlPlaneRole[]): string {
  return roles.map((role) => quoteIdentifier(role)).join(", ");
}

function policyName(tableName: ControlPlaneRlsTable, suffix: "rw" | "ro"): string {
  return `${tableName}_${suffix}`;
}

async function assertRequiredRoles(sql: Bun.SQL): Promise<void> {
  const rows = await sql<{ rolname: string }[]>`
    SELECT rolname
    FROM pg_roles
    WHERE rolname IN (
      'control_plane_migrator',
      'control_plane_api_rw',
      'control_plane_api_ro',
      'control_plane_ops_ro'
    )
  `;
  const existing = new Set(rows.map((row) => row.rolname));
  const missing = REQUIRED_CONTROL_PLANE_ROLES.filter((role) => !existing.has(role));

  if (missing.length > 0) {
    throw new Error(`missing required control-plane roles: ${missing.join(", ")}`);
  }
}

async function listExistingTables(
  sql: Bun.SQL,
  tableNames: readonly string[],
): Promise<Set<string>> {
  const literals = tableNames.map((tableName) => `'${tableName.replace(/'/g, "''")}'`).join(", ");
  const rows = await sql<{ tablename: string }[]>`
    ${sql.unsafe(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (${literals})
    `)}
  `;
  return new Set(rows.map((row) => row.tablename));
}

function buildSchemaMigrationsGrantSql(): string {
  return `
GRANT SELECT ON TABLE public.schema_migrations
TO ${roleList(REQUIRED_CONTROL_PLANE_ROLES.filter((role) => role !== "control_plane_migrator"))};

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.schema_migrations
FROM ${roleList(REQUIRED_CONTROL_PLANE_ROLES.filter((role) => role !== "control_plane_migrator"))};
`.trim();
}

function buildRlsSql(tableName: ControlPlaneRlsTable): string {
  const quotedTableName = `public.${quoteIdentifier(tableName)}`;
  const rwPolicy = quoteIdentifier(policyName(tableName, "rw"));
  const roPolicy = quoteIdentifier(policyName(tableName, "ro"));

  return `
ALTER TABLE ${quotedTableName} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${quotedTableName} FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ${rwPolicy} ON ${quotedTableName};
CREATE POLICY ${rwPolicy}
  ON ${quotedTableName}
  AS PERMISSIVE
  FOR ALL
  TO ${roleList(["control_plane_migrator", "control_plane_api_rw"] as const)}
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS ${roPolicy} ON ${quotedTableName};
CREATE POLICY ${roPolicy}
  ON ${quotedTableName}
  AS PERMISSIVE
  FOR SELECT
  TO ${roleList(["control_plane_api_ro", "control_plane_ops_ro"] as const)}
  USING (true);
`.trim();
}

export async function applyControlPlaneSecurityHardening(
  input: ApplyControlPlaneSecurityHardeningInput,
): Promise<ControlPlaneSecurityHardeningResult> {
  const log = input.logger ?? (() => {});

  await assertRequiredRoles(input.sql);

  const existingTables = await listExistingTables(input.sql, [
    "schema_migrations",
    ...CONTROL_PLANE_RLS_TABLES,
  ]);

  let pgauditConfigured = false;
  let pgauditError: string | null = null;

  log(`configure pgaudit for ${input.databaseName}`);
  try {
    await input.sql.unsafe(`
CREATE EXTENSION IF NOT EXISTS pgaudit;
ALTER DATABASE ${quoteIdentifier(input.databaseName)} SET pgaudit.log = 'write,ddl';
ALTER DATABASE ${quoteIdentifier(input.databaseName)} SET pgaudit.log_relation = 'on';
ALTER DATABASE ${quoteIdentifier(input.databaseName)} SET pgaudit.log_parameter = 'on';
`);
    pgauditConfigured = true;
  } catch (error) {
    pgauditError = error instanceof Error ? error.message : String(error);

    if (!input.allowMissingPgAudit) {
      throw error;
    }

    log(`skip pgaudit; ${pgauditError}`);
  }

  const schemaMigrationsGrantApplied = existingTables.has("schema_migrations");
  if (schemaMigrationsGrantApplied) {
    log("grant schema_migrations select to runtime roles");
    await input.sql.unsafe(buildSchemaMigrationsGrantSql());
  } else {
    log("skip schema_migrations grant; table missing");
  }

  const hardenedTables: ControlPlaneRlsTable[] = [];
  const missingTables: ControlPlaneRlsTable[] = [];

  for (const tableName of CONTROL_PLANE_RLS_TABLES) {
    if (!existingTables.has(tableName)) {
      missingTables.push(tableName);
      log(`skip ${tableName}; table missing`);
      continue;
    }

    log(`apply rls on ${tableName}`);
    await input.sql.unsafe(buildRlsSql(tableName));
    hardenedTables.push(tableName);
  }

  return {
    databaseName: input.databaseName,
    schemaMigrationsGrantApplied,
    pgauditConfigured,
    pgauditError,
    hardenedTables,
    missingTables,
  };
}

export async function hardenControlPlanePostgres(
  input: HardeningControlPlanePostgresInput,
): Promise<ControlPlaneSecurityHardeningResult> {
  const sql = new Bun.SQL(input.databaseUrl);

  try {
    const databaseName = (await sql<{ name: string }[]>`SELECT current_database() AS name`)[0]?.name;
    if (!databaseName) {
      throw new Error("failed to resolve current database name");
    }

    return await applyControlPlaneSecurityHardening({
      sql,
      databaseName,
      logger: input.logger,
      allowMissingPgAudit: input.allowMissingPgAudit,
    });
  } finally {
    await sql.end();
  }
}
