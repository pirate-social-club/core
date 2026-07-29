const SHADOW_ROLE = "promotion_shadow_rw";

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export type PromotionShadowRoleReport = {
  role: typeof SHADOW_ROLE;
  database: string;
  schemaOwner: string;
  productionSchemaCheck: "deferred_absent" | "denied";
  otherDatabasesChecked: string[];
};

export async function provisionPromotionShadowRole(input: {
  sql: Bun.SQL;
  password: string;
}): Promise<PromotionShadowRoleReport> {
  if (!input.password) throw new Error("promotion shadow role password must not be empty");

  const [context] = await input.sql<{ database: string; schema_owner: string }[]>`
    SELECT
      current_database() AS database,
      pg_get_userbyid(namespace.nspowner) AS schema_owner
    FROM pg_namespace AS namespace
    WHERE namespace.nspname = 'promotion_shadow'
  `;
  if (!context) {
    throw new Error("promotion_shadow schema is missing; apply db/promotion/migrations first");
  }

  await input.sql.unsafe(`
DO $role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${SHADOW_ROLE}') THEN
    ALTER ROLE ${SHADOW_ROLE}
      WITH LOGIN PASSWORD ${sqlLiteral(input.password)}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSE
    CREATE ROLE ${SHADOW_ROLE}
      LOGIN PASSWORD ${sqlLiteral(input.password)}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$role$;
`);

  // Remove every explicit membership, including predefined cluster-wide data
  // roles. NOINHERIT alone is insufficient because a member may SET ROLE.
  const memberships = await input.sql<{ granted_role: string }[]>`
    SELECT granted.rolname AS granted_role
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member ON member.oid = membership.member
    JOIN pg_roles AS granted ON granted.oid = membership.roleid
    WHERE member.rolname = ${SHADOW_ROLE}
  `;
  for (const membership of memberships) {
    await input.sql.unsafe(
      `REVOKE ${sqlIdentifier(membership.granted_role)} FROM ${SHADOW_ROLE}`,
    );
  }

  const publicDatabasePrivileges = await input.sql<{ public_temp: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_database AS database,
           LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) AS acl
      WHERE database.datname = current_database()
        AND acl.grantee = 0
        AND acl.privilege_type = 'TEMPORARY'
    ) AS public_temp
  `;
  if (publicDatabasePrivileges[0]?.public_temp) {
    throw new Error(
      "unsafe database baseline: PUBLIC has TEMP; revoke it before provisioning promotion_shadow_rw",
    );
  }

  const otherDatabases = await input.sql<{ datname: string }[]>`
    SELECT datname
    FROM pg_database
    WHERE datallowconn
      AND NOT datistemplate
      AND datname <> current_database()
    ORDER BY datname
  `;
  for (const database of otherDatabases) {
    const [privilege] = await input.sql<{ can_connect: boolean }[]>`
      SELECT has_database_privilege(${SHADOW_ROLE}, ${database.datname}, 'CONNECT') AS can_connect
    `;
    if (privilege?.can_connect) {
      throw new Error(
        `unsafe cluster baseline: ${SHADOW_ROLE} can CONNECT to ${database.datname}; ` +
        "remove PUBLIC or inherited CONNECT before provisioning",
      );
    }
  }

  const exposedFunctions = await input.sql<{ identity: string }[]>`
    SELECT format('%I.%I(%s)', namespace.nspname, procedure.proname,
                  pg_get_function_identity_arguments(procedure.oid)) AS identity
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'promotion_shadow')
      AND has_function_privilege(${SHADOW_ROLE}, procedure.oid, 'EXECUTE')
    ORDER BY identity
  `;
  if (exposedFunctions.length > 0) {
    throw new Error(
      "unsafe function baseline: shadow role can EXECUTE non-shadow routines: " +
      exposedFunctions.map((row) => row.identity).join(", "),
    );
  }

  const schemas = await input.sql<{ schema_name: string; schema_owner: string }[]>`
    SELECT nspname AS schema_name, pg_get_userbyid(nspowner) AS schema_owner
    FROM pg_namespace
    WHERE nspname IN ('public', 'bookings', 'promotion', 'promotion_shadow')
  `;
  const functionCreators = new Set<string>();
  for (const schema of schemas) {
    await input.sql.unsafe(
      `REVOKE ALL ON SCHEMA ${sqlIdentifier(schema.schema_name)} FROM ${SHADOW_ROLE}`,
    );
    await input.sql.unsafe(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${sqlIdentifier(schema.schema_name)} FROM ${SHADOW_ROLE}`,
    );
    await input.sql.unsafe(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${sqlIdentifier(schema.schema_name)} FROM ${SHADOW_ROLE}`,
    );
    await input.sql.unsafe(
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${sqlIdentifier(schema.schema_name)} FROM ${SHADOW_ROLE}`,
    );
    // PostgreSQL's built-in default grants EXECUTE on every new function to
    // PUBLIC. A schema may be owned by the pg_database_owner pseudo-role while
    // migrations create objects as their login role, so schema ownership alone
    // is not the creator set. Harden every current role that can CREATE here.
    const creators = await input.sql<{ role_name: string }[]>`
      SELECT rolname AS role_name
      FROM pg_roles
      WHERE rolname <> ${SHADOW_ROLE}
        AND has_schema_privilege(rolname, ${schema.schema_name}, 'CREATE')
      ORDER BY rolname
    `;
    for (const creator of creators) {
      functionCreators.add(creator.role_name);
    }
  }
  // Default EXECUTE for PUBLIC is a global default. PostgreSQL's per-schema
  // defaults can add privileges but cannot subtract that global grant.
  for (const creator of functionCreators) {
    await input.sql.unsafe(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${sqlIdentifier(creator)} ` +
      "REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
    );
  }

  await input.sql.unsafe(`
GRANT CONNECT ON DATABASE ${sqlIdentifier(context.database)} TO ${SHADOW_ROLE};
GRANT USAGE ON SCHEMA promotion_shadow TO ${SHADOW_ROLE};
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA promotion_shadow TO ${SHADOW_ROLE};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA promotion_shadow TO ${SHADOW_ROLE};

ALTER DEFAULT PRIVILEGES FOR ROLE ${sqlIdentifier(context.schema_owner)}
  IN SCHEMA promotion_shadow
  GRANT SELECT, INSERT, UPDATE ON TABLES TO ${SHADOW_ROLE};
ALTER DEFAULT PRIVILEGES FOR ROLE ${sqlIdentifier(context.schema_owner)}
  IN SCHEMA promotion_shadow
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${SHADOW_ROLE};
`);

  const [attributes] = await input.sql<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolinherit: boolean;
    rolbypassrls: boolean;
    rolreplication: boolean;
  }[]>`
    SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
    FROM pg_roles
    WHERE rolname = ${SHADOW_ROLE}
  `;
  if (
    !attributes
    || attributes.rolsuper
    || attributes.rolcreatedb
    || attributes.rolcreaterole
    || attributes.rolinherit
    || attributes.rolbypassrls
    || attributes.rolreplication
  ) {
    throw new Error("promotion shadow role has unsafe role attributes");
  }

  const unsafeDefaultAcls = await input.sql<{ schema_name: string; object_type: string }[]>`
    SELECT COALESCE(namespace.nspname, '<all-schemas>') AS schema_name,
           defaults.defaclobjtype AS object_type
    FROM pg_default_acl AS defaults
    LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
    JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE grantee.rolname = ${SHADOW_ROLE}
      AND COALESCE(namespace.nspname, '') <> 'promotion_shadow'
  `;
  if (unsafeDefaultAcls.length > 0) {
    throw new Error(
      "shadow role appears in non-shadow default ACLs: " +
      unsafeDefaultAcls.map((acl) => `${acl.schema_name}:${acl.object_type}`).join(", "),
    );
  }

  const productionSchema = schemas.some((schema) => schema.schema_name === "promotion");
  if (productionSchema) {
    const [access] = await input.sql<{ can_use: boolean }[]>`
      SELECT has_schema_privilege(${SHADOW_ROLE}, 'promotion', 'USAGE') AS can_use
    `;
    if (access?.can_use) throw new Error("shadow role unexpectedly has USAGE on promotion");
  }

  return {
    role: SHADOW_ROLE,
    database: context.database,
    schemaOwner: context.schema_owner,
    productionSchemaCheck: productionSchema ? "denied" : "deferred_absent",
    otherDatabasesChecked: otherDatabases.map((database) => database.datname),
  };
}
