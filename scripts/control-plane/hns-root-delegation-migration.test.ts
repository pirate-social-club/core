/**
 * Real-Postgres integration test for the HNS root delegation migration (0152) and the
 * canonical read query shipped in @pirate/hns-delegation.
 *
 * Runs ONLY when CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL (or the shared bookings admin URL) is set;
 * CI provisions PostgreSQL and passes an owner/superuser URL. It never hard-codes a host, never
 * prints credentials, and leaves no database behind.
 *
 * Proves two things string assertions cannot:
 *   1. PostgreSQL accepts ROOT_DELEGATION_READ_SQL against the real schema, so the query the API
 *      will run is executable rather than merely well-spelled.
 *   2. The invariants the spec relies on are enforced by the database, not by writer discipline:
 *      an incoherent `secure`, a `pending` without evidence, a failed observation carrying a
 *      security finding, and a state row pointing at a failed or foreign observation are all
 *      rejected.
 */
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  evaluateJoinedRoot,
  ROOT_DELEGATION_READ_SQL,
  type RootDelegationJoinRow,
} from "../../packages/hns-delegation/src/index";

const ADMIN_URL =
  process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL ?? process.env.BOOKINGS_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "hns_root_delegation_migration_test";
const MIGRATION_FILE = "db/control-plane/migrations/0152_control_plane_hns_root_delegation_state.sql";

const SQLSTATE = { check: "23514", foreignKey: "23503" } as const;
const NOW = new Date("2026-07-22T12:00:00Z");

function urlFor(db?: string): string {
  const u = new URL(ADMIN_URL as string);
  if (db !== undefined) u.pathname = `/${db}`;
  if (!u.searchParams.get("sslmode")) u.searchParams.set("sslmode", "disable");
  return u.toString();
}
function connect(db?: string): SQL {
  return new SQL({ url: urlFor(db), tls: false, max: 1, connectionTimeout: 5 } as Record<
    string,
    unknown
  >);
}

async function expectRejected(sql: SQL, statement: string, sqlstate: string): Promise<void> {
  let caught: { errno?: string } | undefined;
  try {
    await sql.unsafe(statement);
  } catch (e) {
    caught = e as { errno?: string };
  }
  expect(caught, `expected rejection with SQLSTATE ${sqlstate}, got success`).toBeDefined();
  expect(caught?.errno, `expected SQLSTATE ${sqlstate}`).toBe(sqlstate);
}

let sql: SQL;

describe.skipIf(!RUN)("hns root delegation migration 0152 (real Postgres)", () => {
  beforeAll(async () => {
    const root = connect();
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await root.end();

    sql = connect(TEST_DB);
    const text = await Bun.file(MIGRATION_FILE).text();
    const statements = text
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await sql.unsafe(statement);
    }

    // A root with a live keyset, its issued DS, and one successful secure observation.
    await sql.unsafe(`
      INSERT INTO hns_root_issued_keysets
        (issued_keyset_id, normalized_root_label, activated_at, created_at, updated_at)
      VALUES ('ks_1', 'dankmeme', '${NOW.toISOString()}', '${NOW.toISOString()}', '${NOW.toISOString()}')
    `);
    await sql.unsafe(`
      INSERT INTO hns_root_issued_ds
        (issued_ds_id, issued_keyset_id, normalized_root_label, key_tag, algorithm,
         digest_type, digest, derived_at, created_at)
      VALUES ('ds_1', 'ks_1', 'dankmeme', 39280, 13, 2, 'aabb', '${NOW.toISOString()}', '${NOW.toISOString()}')
    `);
    await sql.unsafe(`
      INSERT INTO hns_root_parent_observations
        (parent_observation_id, normalized_root_label, outcome, provider,
         observed_delegation_security, parent_ds_matches_live_dnskey, authoritative_dnssec_valid,
         earliest_rrsig_expires_at, observed_at, created_at)
      VALUES ('obs_1', 'dankmeme', 'succeeded', 'hsd_json_rpc', 'secure', 1, 1,
              '2026-07-30T00:00:00Z', '${NOW.toISOString()}', '${NOW.toISOString()}')
    `);
    await sql.unsafe(`
      INSERT INTO hns_root_delegation_state
        (normalized_root_label, rollover_state, expected_keyset_id, expected_ds_derived_at,
         last_parent_observation_id, last_parent_observation_outcome,
         last_parent_observation_attempt_at, state_changed_at, created_at, updated_at)
      VALUES ('dankmeme', 'none', 'ks_1', '${NOW.toISOString()}', 'obs_1', 'succeeded',
              '${NOW.toISOString()}', '${NOW.toISOString()}', '${NOW.toISOString()}', '${NOW.toISOString()}')
    `);
    // A root that exists but has never been successfully observed.
    await sql.unsafe(`
      INSERT INTO hns_root_delegation_state
        (normalized_root_label, rollover_state, state_changed_at, created_at, updated_at)
      VALUES ('neverseen', 'none', '${NOW.toISOString()}', '${NOW.toISOString()}', '${NOW.toISOString()}')
    `);
  });

  afterAll(async () => {
    await sql?.end();
    const root = connect();
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.end();
  });

  test("PostgreSQL accepts the canonical read query", async () => {
    const rows = (await sql.unsafe(ROOT_DELEGATION_READ_SQL, ["dankmeme"])) as RootDelegationJoinRow[];
    expect(rows).toHaveLength(1);
  });

  test("an observed root evaluates as secure and routable", async () => {
    const rows = (await sql.unsafe(ROOT_DELEGATION_READ_SQL, ["dankmeme"])) as RootDelegationJoinRow[];
    const result = evaluateJoinedRoot(rows[0] ?? null, NOW.getTime());
    expect(result.delegationSecurity).toBe("secure");
    expect(result.authenticatedRoutingAllowed).toBe(true);
  });

  test("a never-observed root still returns a row and fails closed", async () => {
    const rows = (await sql.unsafe(ROOT_DELEGATION_READ_SQL, ["neverseen"])) as RootDelegationJoinRow[];
    // The LEFT JOIN is what makes this a row rather than nothing.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delegation_parent_observation_id).toBeNull();
    const result = evaluateJoinedRoot(rows[0] ?? null, NOW.getTime());
    expect(result.delegationSecurity).toBe("unknown");
    expect(result.authenticatedRoutingAllowed).toBe(false);
  });

  test("an absent root returns no rows and fails closed", async () => {
    const rows = (await sql.unsafe(ROOT_DELEGATION_READ_SQL, ["nosuchroot"])) as RootDelegationJoinRow[];
    expect(rows).toHaveLength(0);
    expect(evaluateJoinedRoot(rows[0] ?? null, NOW.getTime()).routingWithheldReason).toBe(
      "no_root_state",
    );
  });

  test("the state table has no security-finding columns to forge", async () => {
    const columns = (await sql.unsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'hns_root_delegation_state'`,
    )) as Array<{ column_name: string }>;
    const names = columns.map((c) => c.column_name);
    for (const forbidden of [
      "delegation_security",
      "parent_ds_matches_live_dnskey",
      "authoritative_dnssec_valid",
      "last_parent_observation_at",
      "earliest_rrsig_expires_at",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  test("a secure observation without expiry evidence is rejected", async () => {
    await expectRejected(
      sql,
      `INSERT INTO hns_root_parent_observations
         (parent_observation_id, normalized_root_label, outcome, provider,
          observed_delegation_security, parent_ds_matches_live_dnskey, authoritative_dnssec_valid,
          observed_at, created_at)
       VALUES ('obs_bad1', 'dankmeme', 'succeeded', 'hsd_json_rpc', 'secure', 1, 1,
               '${NOW.toISOString()}', '${NOW.toISOString()}')`,
      SQLSTATE.check,
    );
  });

  test("an incoherent secure observation is rejected", async () => {
    await expectRejected(
      sql,
      `INSERT INTO hns_root_parent_observations
         (parent_observation_id, normalized_root_label, outcome, provider,
          observed_delegation_security, parent_ds_matches_live_dnskey, authoritative_dnssec_valid,
          earliest_rrsig_expires_at, observed_at, created_at)
       VALUES ('obs_bad2', 'dankmeme', 'succeeded', 'hsd_json_rpc', 'secure', 0, 1,
               '2026-07-30T00:00:00Z', '${NOW.toISOString()}', '${NOW.toISOString()}')`,
      SQLSTATE.check,
    );
  });

  test("a failed observation carrying a security finding is rejected", async () => {
    await expectRejected(
      sql,
      `INSERT INTO hns_root_parent_observations
         (parent_observation_id, normalized_root_label, outcome, provider, failure_code,
          observed_delegation_security, parent_ds_matches_live_dnskey, authoritative_dnssec_valid,
          observed_at, created_at)
       VALUES ('obs_bad3', 'dankmeme', 'failed', 'hsd_json_rpc', 'rpc_timeout', 'unsecured', 0, 0,
               '${NOW.toISOString()}', '${NOW.toISOString()}')`,
      SQLSTATE.check,
    );
  });

  test("a state row cannot reference a failed observation", async () => {
    await sql.unsafe(`
      INSERT INTO hns_root_parent_observations
        (parent_observation_id, normalized_root_label, outcome, provider, failure_code,
         observed_at, created_at)
      VALUES ('obs_failed', 'otherroot', 'failed', 'hsd_json_rpc', 'rpc_timeout',
              '${NOW.toISOString()}', '${NOW.toISOString()}')
    `);
    await expectRejected(
      sql,
      `INSERT INTO hns_root_delegation_state
         (normalized_root_label, rollover_state, last_parent_observation_id,
          last_parent_observation_outcome, state_changed_at, created_at, updated_at)
       VALUES ('otherroot', 'none', 'obs_failed', 'succeeded',
               '${NOW.toISOString()}', '${NOW.toISOString()}', '${NOW.toISOString()}')`,
      SQLSTATE.foreignKey,
    );
  });

  test("a state row cannot reference another root's observation", async () => {
    await expectRejected(
      sql,
      `INSERT INTO hns_root_delegation_state
         (normalized_root_label, rollover_state, last_parent_observation_id,
          last_parent_observation_outcome, state_changed_at, created_at, updated_at)
       VALUES ('foreignroot', 'none', 'obs_1', 'succeeded',
               '${NOW.toISOString()}', '${NOW.toISOString()}', '${NOW.toISOString()}')`,
      SQLSTATE.foreignKey,
    );
  });

  test("pending without evidence is rejected", async () => {
    await expectRejected(
      sql,
      `INSERT INTO hns_root_delegation_state
         (normalized_root_label, rollover_state, state_changed_at, created_at, updated_at)
       VALUES ('pendingroot', 'none', '${NOW.toISOString()}', '${NOW.toISOString()}', '${NOW.toISOString()}');
       UPDATE hns_root_delegation_state SET pending_evidence_ref = 'tx_1'
        WHERE normalized_root_label = 'pendingroot'`,
      SQLSTATE.check,
    );
  });

  test("a child DS cannot cross roots or claim a match without issuance", async () => {
    await expectRejected(
      sql,
      `INSERT INTO hns_root_observed_ds
         (observed_ds_id, parent_observation_id, normalized_root_label, key_tag, algorithm,
          digest_type, digest, classification, matched_issued_ds_id, created_at)
       VALUES ('ods_bad', 'obs_1', 'otherroot', 39280, 13, 2, 'aabb', 'matching', 'ds_1',
               '${NOW.toISOString()}')`,
      SQLSTATE.foreignKey,
    );
    await expectRejected(
      sql,
      `INSERT INTO hns_root_observed_ds
         (observed_ds_id, parent_observation_id, normalized_root_label, key_tag, algorithm,
          digest_type, digest, classification, created_at)
       VALUES ('ods_bad2', 'obs_1', 'dankmeme', 39280, 13, 2, 'aabb', 'matching',
               '${NOW.toISOString()}')`,
      SQLSTATE.check,
    );
  });
});
