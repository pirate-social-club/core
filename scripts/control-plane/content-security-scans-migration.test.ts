import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { postgresMigrationStatements } from "../lib/postgres-migrations";

const migration = readFileSync(
  "db/control-plane/migrations/0219_control_plane_content_security_scans.sql",
  "utf8",
);
const revocationMigration = readFileSync(
  "db/control-plane/migrations/0222_control_plane_content_security_release_revocation.sql",
  "utf8",
);

describe("content security scans control-plane migration", () => {
  test("pins promoted scanner identity independently from jobs", () => {
    expect(migration).toContain("CREATE TABLE content_security_scanner_releases");
    expect(migration).toContain("idx_content_security_scanner_releases_active_profile");
    expect(migration).toContain("content_security_scanner_release_identity_immutable");
    expect(migration).toContain("deployed_image_digest TEXT NOT NULL");
    expect(migration).toContain("corpus_evidence_ref TEXT NOT NULL");
  });

  test("keeps revocation terminal without fabricating staged activation", () => {
    expect(revocationMigration).toContain("status = 'revoked' AND retired_at IS NOT NULL");
    expect(revocationMigration).toContain(
      "OLD.status = 'retired' AND NEW.status IN ('retired', 'revoked')",
    );
    expect(revocationMigration).toContain(
      "OLD.status = 'revoked' AND NEW.status = 'revoked'",
    );
    expect(revocationMigration).not.toContain(
      "status = 'revoked' AND activated_at IS NOT NULL",
    );
  });

  test("keeps one active hash-bound job per blob", () => {
    expect(migration).toContain("CREATE TABLE content_security_scan_jobs");
    expect(migration).toContain("expected_content_hash TEXT NOT NULL");
    expect(migration).toContain("expected_size_bytes BIGINT NOT NULL");
    expect(migration).toContain("idx_content_security_scan_jobs_active_blob");
    expect(migration).toContain("WHERE status IN ('queued', 'running', 'retryable_error')");
    expect(migration).toContain("content_security_scan_jobs_lease_pair_check");
    expect(migration).toContain("content_security_scan_jobs_attempt_limit_check");
    expect(migration).toContain("content_security_scan_jobs_no_delete");
    expect(migration).toContain("content_security_scan_job_identity_immutable");
  });

  test("records immutable result and source-read evidence per attempt", () => {
    expect(migration).toContain("CREATE TABLE content_security_scan_results");
    expect(migration).toContain("CREATE TABLE content_source_read_audits");
    expect(migration).toContain("UNIQUE (scan_job_id, attempt_number)");
    expect(migration).toContain("content_security_scan_results_immutable");
    expect(migration).toContain("content_source_read_audits_immutable");
    expect(migration).toContain("content security scanner release records cannot be deleted");
    expect(migration).not.toContain("storage_object_key TEXT");
  });

  test("grants only intended runtime and read roles", () => {
    const statements = postgresMigrationStatements(migration);
    expect(statements.some((statement) =>
      statement.includes("REVOKE ALL ON TABLE")
      && statement.includes("content_security_scan_jobs")
      && statement.includes("FROM PUBLIC;")
    )).toBe(true);
    expect(statements.some((statement) =>
      statement.includes("GRANT SELECT, INSERT, UPDATE")
      && statement.includes("content_security_scan_jobs")
      && statement.includes("TO control_plane_api_rw;")
    )).toBe(true);
    expect(migration).toMatch(
      /GRANT SELECT, INSERT\s+ON TABLE\s+content_security_scan_results,\s+content_source_read_audits\s+TO control_plane_api_rw;/,
    );
    expect(statements.some((statement) =>
      statement.includes("GRANT SELECT")
      && statement.includes("TO control_plane_api_ro, control_plane_ops_ro;")
    )).toBe(true);
  });
});
