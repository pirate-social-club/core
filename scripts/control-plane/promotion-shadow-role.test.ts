import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { applyPostgresMigrations } from "../lib/postgres-migrations";
import { provisionPromotionShadowRole, type PromotionShadowRoleReport } from "../lib/promotion-shadow-role";

const ADMIN_URL = process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "promotion_shadow_role_test";
const OTHER_DB = "promotion_shadow_role_other";
const UNSAFE_DB = "promotion_shadow_role_unsafe";
const ROLE = "promotion_shadow_rw";
const PASSWORD = "promotion-shadow-test-password";
let report: PromotionShadowRoleReport;

function urlFor(input: { db?: string; user?: string; password?: string }): string {
  const url = new URL(ADMIN_URL as string);
  if (input.db) url.pathname = `/${input.db}`;
  if (input.user) url.username = input.user;
  if (input.password) url.password = input.password;
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function connect(input: { db?: string; user?: string; password?: string } = {}): SQL {
  return new SQL({ url: urlFor(input), tls: false, max: 1, connectionTimeout: 5 } as Record<string, unknown>);
}

async function expectSqlState(sql: SQL, statement: string, state = "42501"): Promise<void> {
  let caught: { errno?: string } | undefined;
  try {
    await sql.unsafe(statement);
  } catch (error) {
    caught = error as { errno?: string };
  }
  expect(caught, `expected SQLSTATE ${state}, got success: ${statement}`).toBeDefined();
  expect(caught?.errno).toBe(state);
}

describe.skipIf(!RUN)("promotion shadow role boundary", () => {
  beforeAll(async () => {
    const root = connect();
    await root.unsafe(`DROP DATABASE IF EXISTS ${UNSAFE_DB} WITH (FORCE)`);
    await root.unsafe(`DROP DATABASE IF EXISTS ${OTHER_DB} WITH (FORCE)`);
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.unsafe(`DROP ROLE IF EXISTS ${ROLE}`);
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await root.unsafe(`CREATE DATABASE ${OTHER_DB}`);
    // PostgreSQL grants CONNECT and TEMP to PUBLIC by default. Harden the
    // scratch cluster before provisioning; the script verifies but never
    // silently changes these cluster-wide policies.
    await root.unsafe(`REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`);
    await root.unsafe(`REVOKE CONNECT ON DATABASE ${OTHER_DB} FROM PUBLIC`);
    await root.unsafe(`REVOKE CONNECT ON DATABASE ${TEST_DB} FROM PUBLIC`);
    await root.unsafe(`REVOKE TEMP ON DATABASE ${TEST_DB} FROM PUBLIC`);
    await root.end();

    await applyPostgresMigrations({
      databaseUrl: urlFor({ db: TEST_DB }),
      migrationsDir: "db/promotion/migrations",
      label: "promotion-shadow",
    });

    const owner = connect({ db: TEST_DB });
    await owner.unsafe(`
      CREATE SCHEMA bookings;
      CREATE TABLE public.application_known (id text PRIMARY KEY);
      CREATE TABLE bookings.application_booking (id text PRIMARY KEY);
      CREATE SEQUENCE public.application_sequence;
      CREATE FUNCTION public.application_function()
        RETURNS int LANGUAGE sql AS 'SELECT 1';
      CREATE PROCEDURE public.application_procedure()
        LANGUAGE sql AS 'SELECT 1';
      REVOKE ALL ON SCHEMA bookings FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.application_function() FROM PUBLIC;
      REVOKE EXECUTE ON PROCEDURE public.application_procedure() FROM PUBLIC;
    `);
    report = await provisionPromotionShadowRole({ sql: owner, password: PASSWORD });
    // Future application object: created after grants, so this exercises default
    // ACLs rather than only the point-in-time object set.
    await owner.unsafe(`
      CREATE TABLE public.application_future (id text PRIMARY KEY);
      CREATE FUNCTION public.application_future_function()
        RETURNS int LANGUAGE sql AS 'SELECT 2';
    `);
    await owner.end();
  });

  afterAll(async () => {
    const root = connect();
    await root.unsafe(`DROP DATABASE IF EXISTS ${UNSAFE_DB} WITH (FORCE)`).catch(() => {});
    await root.unsafe(`DROP DATABASE IF EXISTS ${OTHER_DB} WITH (FORCE)`).catch(() => {});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
    await root.unsafe(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
    await root.unsafe(`GRANT CONNECT ON DATABASE postgres TO PUBLIC`).catch(() => {});
    await root.end();
  });

  test("authenticates directly and can read/write only shadow objects", async () => {
    const shadow = connect({ db: TEST_DB, user: ROLE, password: PASSWORD });
    await shadow.unsafe(`
      INSERT INTO promotion_shadow.candidates
        (candidate_id, web_sha, api_sha, core_sha, manifest)
      VALUES ('shc_role_test', 'w', 'a', 'c', '{}')
    `);
    const rows = await shadow.unsafe(`
      SELECT candidate_id FROM promotion_shadow.candidates WHERE candidate_id = 'shc_role_test'
    `);
    expect(rows).toHaveLength(1);

    await expectSqlState(shadow, `SELECT * FROM public.application_known`);
    await expectSqlState(shadow, `INSERT INTO public.application_known(id) VALUES ('x')`);
    await expectSqlState(shadow, `SELECT * FROM public.application_future`);
    await expectSqlState(shadow, `SELECT * FROM bookings.application_booking`);
    await expectSqlState(shadow, `SELECT nextval('public.application_sequence')`);
    await expectSqlState(shadow, `SELECT public.application_function()`);
    await expectSqlState(shadow, `CALL public.application_procedure()`);
    await expectSqlState(shadow, `SELECT public.application_future_function()`);
    await expectSqlState(shadow, `CREATE TABLE public.shadow_escape(id int)`);
    await expectSqlState(shadow, `CREATE TEMP TABLE shadow_temp_escape(id int)`);
    await expectSqlState(shadow, `CREATE SCHEMA shadow_escape`);
    await expectSqlState(shadow, `CREATE ROLE shadow_escape`);
    await expectSqlState(shadow, `GRANT SELECT ON public.application_known TO PUBLIC`);
    await shadow.end();
  });

  test("has safe attributes, memberships, and default ACLs", async () => {
    const owner = connect({ db: TEST_DB });
    const [attributes] = await owner.unsafe(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls, rolreplication
      FROM pg_roles WHERE rolname = '${ROLE}'
    `) as Record<string, boolean>[];
    expect(attributes).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolbypassrls: false,
      rolreplication: false,
    });
    const memberships = await owner.unsafe(`
      SELECT granted.rolname
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member ON member.oid = membership.member
      JOIN pg_roles AS granted ON granted.oid = membership.roleid
      WHERE member.rolname = '${ROLE}'
    `);
    expect(memberships).toHaveLength(0);
    const nonShadowDefaults = await owner.unsafe(`
      SELECT 1
      FROM pg_default_acl AS defaults
      LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
      JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE grantee.rolname = '${ROLE}'
        AND COALESCE(namespace.nspname, '') <> 'promotion_shadow'
    `);
    expect(nonShadowDefaults).toHaveLength(0);
    await owner.end();
  });

  test("cannot connect to another database using the actual credential", async () => {
    const other = connect({ db: OTHER_DB, user: ROLE, password: PASSWORD });
    await expectSqlState(other, `SELECT 1`);
    await other.end().catch(() => {});
    expect(report.otherDatabasesChecked).toContain(OTHER_DB);
    // No production schema exists in S0; this is explicitly deferred, never
    // reported as a passing denial.
    expect(report.productionSchemaCheck).toBe("deferred_absent");
  });

  test("fails closed when PUBLIC TEMP or EXECUTE would bypass the role boundary", async () => {
    const root = connect();
    await root.unsafe(`CREATE DATABASE ${UNSAFE_DB}`);
    await root.unsafe(`REVOKE CONNECT ON DATABASE ${UNSAFE_DB} FROM PUBLIC`);
    await root.end();
    await applyPostgresMigrations({
      databaseUrl: urlFor({ db: UNSAFE_DB }),
      migrationsDir: "db/promotion/migrations",
      label: "promotion-shadow",
    });
    const unsafe = connect({ db: UNSAFE_DB });
    await expect(
      provisionPromotionShadowRole({ sql: unsafe, password: "rotated-test-password" }),
    ).rejects.toThrow("PUBLIC has TEMP");
    await unsafe.unsafe(`
      REVOKE TEMP ON DATABASE ${UNSAFE_DB} FROM PUBLIC;
      REVOKE CONNECT ON DATABASE ${TEST_DB} FROM ${ROLE};
      CREATE FUNCTION public.publicly_executable_function()
        RETURNS int LANGUAGE sql AS 'SELECT 1';
    `);
    await expect(
      provisionPromotionShadowRole({ sql: unsafe, password: "rotated-again-test-password" }),
    ).rejects.toThrow("unsafe function baseline");
    await unsafe.end();
  });
});
