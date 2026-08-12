import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { postgresMigrationStatements } from "../lib/postgres-migrations";

const ADMIN_URL =
  process.env.CONTROL_PLANE_MIGRATION_TEST_ADMIN_URL ??
  process.env.BOOKINGS_MIGRATION_TEST_ADMIN_URL;
const RUN = Boolean(ADMIN_URL);
const TEST_DB = "content_security_scans_migration_test";
const MIGRATOR_PASSWORD = "test-content-security-migrator";
const RW_PASSWORD = "test-content-security-rw";
const RO_PASSWORD = "test-content-security-ro";
const OPS_PASSWORD = "test-content-security-ops";

function urlFor(options: { db?: string; user?: string; password?: string }): string {
  const url = new URL(ADMIN_URL as string);
  if (options.user !== undefined) url.username = options.user;
  if (options.password !== undefined) url.password = options.password;
  if (options.db !== undefined) url.pathname = `/${options.db}`;
  if (!url.searchParams.get("sslmode")) url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function connect(options: { db?: string; user?: string; password?: string }): SQL {
  return new SQL({
    url: urlFor(options),
    tls: false,
    max: 1,
    connectionTimeout: 5,
  } as Record<string, unknown>);
}

async function expectSqlState(sql: SQL, statement: string, expected: string): Promise<void> {
  let caught: { errno?: string } | undefined;
  try {
    await sql.unsafe(statement);
  } catch (error) {
    caught = error as { errno?: string };
  }
  expect(caught, `expected SQLSTATE ${expected}, got success`).toBeDefined();
  expect(caught?.errno).toBe(expected);
}

async function applyMigration(sql: SQL, path: string): Promise<void> {
  for (const statement of postgresMigrationStatements(readFileSync(path, "utf8"))) {
    await sql.unsafe(statement);
  }
}

const RELEASE_VALUES = `
  'csr_release', 'download_file_v1', 'staged', 'revision',
  '${"a".repeat(64)}', 'sha256:${"b".repeat(64)}',
  'sha256:${"c".repeat(64)}', '1.5.4', '28085',
  '2026-08-07T00:00:00Z', '${"d".repeat(64)}',
  'sha256:${"e".repeat(64)}', 'sbom://scanner', 'evidence://corpus',
  '2026-08-12T00:00:00Z'
`;

describe.skipIf(!RUN)("content security scan migration 0219 (real Postgres)", () => {
  beforeAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.unsafe(`CREATE DATABASE ${TEST_DB}`);
    await root.end();

    const db = connect({ db: TEST_DB });
    for (const [role, password] of [
      ["control_plane_migrator", MIGRATOR_PASSWORD],
      ["control_plane_api_rw", RW_PASSWORD],
      ["control_plane_api_ro", RO_PASSWORD],
      ["control_plane_ops_ro", OPS_PASSWORD],
    ] as const) {
      await db.unsafe(`DROP ROLE IF EXISTS ${role}`);
      await db.unsafe(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
      );
    }
    await db.unsafe("GRANT CREATE, USAGE ON SCHEMA public TO control_plane_migrator");
    for (const role of ["control_plane_api_rw", "control_plane_api_ro", "control_plane_ops_ro"]) {
      await db.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    }
    await db.end();

    const migrator = connect({
      db: TEST_DB,
      user: "control_plane_migrator",
      password: MIGRATOR_PASSWORD,
    });
    await migrator.unsafe("CREATE TABLE communities (community_id TEXT PRIMARY KEY)");
    await migrator.unsafe("CREATE TABLE users (user_id TEXT PRIMARY KEY)");
    await applyMigration(
      migrator,
      "db/control-plane/migrations/0218_control_plane_content_blobs.sql",
    );
    await applyMigration(
      migrator,
      "db/control-plane/migrations/0219_control_plane_content_security_scans.sql",
    );
    await applyMigration(
      migrator,
      "db/control-plane/migrations/0222_control_plane_content_security_release_revocation.sql",
    );
    await migrator.unsafe("INSERT INTO communities (community_id) VALUES ('community')");
    await migrator.unsafe("INSERT INTO users (user_id) VALUES ('user')");
    await migrator.unsafe(`
      INSERT INTO content_blobs (
        content_blob_id, community_id, uploader_user_id, status,
        validation_profile, declared_mime_type, declared_size_bytes,
        verified_size_bytes, verified_content_hash, security_scan_state,
        plaintext_retention_state, storage_ref, created_at, updated_at
      ) VALUES (
        'cbl_source', 'community', 'user', 'uploaded',
        'download_file_v1', 'text/plain', 5,
        5, '0x${"f".repeat(64)}', 'pending',
        'active', 'internal://content/cbl_source',
        '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z'
      )
    `);
    await migrator.unsafe(`
      INSERT INTO content_security_scanner_releases (
        scanner_release_id, security_scan_profile, status, source_revision,
        runtime_lock_sha256, base_image_digest, engine_image_digest,
        engine_version, signature_version, signature_date, definition_digest,
        deployed_image_digest, sbom_ref, corpus_evidence_ref, created_at
      ) VALUES (${RELEASE_VALUES})
    `);
    await migrator.unsafe(`
      INSERT INTO content_security_scan_jobs (
        scan_job_id, content_blob_id, scanner_release_id, scan_sequence,
        request_reason, security_scan_profile, expected_content_hash,
        expected_size_bytes, status, max_attempts, queued_at, created_at, updated_at
      ) VALUES (
        'csj_initial', 'cbl_source', 'csr_release', 1,
        'initial_upload', 'download_file_v1', '0x${"f".repeat(64)}',
        5, 'queued', 3, '2026-08-12T00:01:00Z',
        '2026-08-12T00:01:00Z', '2026-08-12T00:01:00Z'
      )
    `);
    await migrator.end();
  });

  afterAll(async () => {
    const root = connect({});
    await root.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => undefined);
    for (const role of [
      "control_plane_api_rw",
      "control_plane_api_ro",
      "control_plane_ops_ro",
      "control_plane_migrator",
    ]) {
      await root.unsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
    }
    await root.end();
  });

  test("allows terminal revocation without fabricating activation and rejects rollback", async () => {
    const migrator = connect({
      db: TEST_DB,
      user: "control_plane_migrator",
      password: MIGRATOR_PASSWORD,
    });
    await migrator.unsafe(`
      UPDATE content_security_scanner_releases
      SET status = 'active', activated_at = '2026-08-12T00:02:00Z'
      WHERE scanner_release_id = 'csr_release'
    `);
    await migrator.unsafe(`
      UPDATE content_security_scanner_releases
      SET status = 'retired', retired_at = '2026-08-12T00:03:00Z'
      WHERE scanner_release_id = 'csr_release'
    `);
    await migrator.unsafe(`
      UPDATE content_security_scanner_releases
      SET status = 'revoked'
      WHERE scanner_release_id = 'csr_release'
    `);
    await expectSqlState(
      migrator,
      `UPDATE content_security_scanner_releases
       SET status = 'staged', activated_at = NULL
       WHERE scanner_release_id = 'csr_release'`,
      "23514",
    );
    await migrator.unsafe(`
      INSERT INTO content_security_scanner_releases (
        scanner_release_id, security_scan_profile, status, source_revision,
        runtime_lock_sha256, base_image_digest, engine_image_digest,
        engine_version, signature_version, signature_date, definition_digest,
        deployed_image_digest, sbom_ref, corpus_evidence_ref, created_at
      )
      SELECT
        'csr_rejected_staged', security_scan_profile, 'staged', source_revision,
        runtime_lock_sha256, base_image_digest, engine_image_digest,
        engine_version, signature_version, signature_date, definition_digest,
        deployed_image_digest, sbom_ref, corpus_evidence_ref,
        '2026-08-12T00:04:00Z'
      FROM content_security_scanner_releases
      WHERE scanner_release_id = 'csr_release'
    `);
    await migrator.unsafe(`
      UPDATE content_security_scanner_releases
      SET status = 'revoked', retired_at = '2026-08-12T00:05:00Z'
      WHERE scanner_release_id = 'csr_rejected_staged'
    `);
    const stagedRevocation = await migrator.unsafe(`
      SELECT status, activated_at, retired_at
      FROM content_security_scanner_releases
      WHERE scanner_release_id = 'csr_rejected_staged'
    `);
    expect(stagedRevocation[0]?.status).toBe("revoked");
    expect(stagedRevocation[0]?.activated_at).toBeNull();
    expect(stagedRevocation[0]?.retired_at).not.toBeNull();
    await expectSqlState(
      migrator,
      `UPDATE content_security_scanner_releases
       SET definition_digest = '${"0".repeat(64)}'
       WHERE scanner_release_id = 'csr_release'`,
      "23514",
    );
    await migrator.end();
  });

  test("keeps job identity immutable and attempt count bounded", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PASSWORD });
    await rw.unsafe(`
      UPDATE content_security_scan_jobs
      SET status = 'running', attempt_count = 1, lease_owner = 'consumer',
          lease_expires_at = '2026-08-12T00:07:00Z',
          started_at = '2026-08-12T00:02:00Z', updated_at = '2026-08-12T00:02:00Z'
      WHERE scan_job_id = 'csj_initial'
    `);
    await expectSqlState(
      rw,
      `UPDATE content_security_scan_jobs
       SET expected_size_bytes = 6
       WHERE scan_job_id = 'csj_initial'`,
      "23514",
    );
    await expectSqlState(
      rw,
      `UPDATE content_security_scan_jobs
       SET attempt_count = 4
       WHERE scan_job_id = 'csj_initial'`,
      "23514",
    );
    await expectSqlState(
      rw,
      "DELETE FROM content_security_scan_jobs WHERE scan_job_id = 'csj_initial'",
      "42501",
    );
    await rw.end();
  });

  test("accepts append-only matching result and read evidence", async () => {
    const rw = connect({ db: TEST_DB, user: "control_plane_api_rw", password: RW_PASSWORD });
    await rw.unsafe(`
      INSERT INTO content_source_read_audits (
        source_read_audit_id, scan_job_id, content_blob_id, attempt_number,
        purpose, actor_role, expected_content_hash, expected_size_bytes,
        bytes_read, outcome, started_at, completed_at
      ) VALUES (
        'csra_initial', 'csj_initial', 'cbl_source', 1,
        'initial_scan', 'scanner_job', '0x${"f".repeat(64)}', 5,
        5, 'completed', '2026-08-12T00:02:00Z', '2026-08-12T00:02:01Z'
      )
    `);
    await rw.unsafe(`
      INSERT INTO content_security_scan_results (
        scan_result_id, scan_job_id, content_blob_id, scanner_release_id,
        attempt_number, content_hash, size_bytes, outcome, security_scan_profile,
        scanner_policy_version, engine_version, signature_version, signature_date,
        engine_image_digest, definition_digest, finding_code, error_code,
        duration_ms, recorded_at
      ) VALUES (
        'csr_initial', 'csj_initial', 'cbl_source', 'csr_release',
        1, '0x${"f".repeat(64)}', 5, 'clean', 'download_file_v1',
        'clamav-text-v1', '1.5.4', '28085', '2026-08-07T00:00:00Z',
        'sha256:${"c".repeat(64)}', '${"d".repeat(64)}', NULL, NULL,
        100, '2026-08-12T00:02:01Z'
      )
    `);
    await expectSqlState(
      rw,
      "UPDATE content_security_scan_results SET duration_ms = 101 WHERE scan_result_id = 'csr_initial'",
      "42501",
    );
    await expectSqlState(
      rw,
      "DELETE FROM content_source_read_audits WHERE source_read_audit_id = 'csra_initial'",
      "42501",
    );
    await rw.end();

    for (const [user, password] of [
      ["control_plane_api_ro", RO_PASSWORD],
      ["control_plane_ops_ro", OPS_PASSWORD],
    ] as const) {
      const ro = connect({ db: TEST_DB, user, password });
      const rows = await ro.unsafe(
        "SELECT outcome FROM content_security_scan_results WHERE scan_result_id = 'csr_initial'",
      );
      expect(rows[0]?.outcome).toBe("clean");
      await expectSqlState(
        ro,
        "DELETE FROM content_security_scan_results WHERE scan_result_id = 'csr_initial'",
        "42501",
      );
      await ro.end();
    }
  });
});
