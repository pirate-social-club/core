import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { postgresMigrationStatements } from "../lib/postgres-migrations";

const migration = readFileSync(
  "db/control-plane/migrations/0218_control_plane_content_blobs.sql",
  "utf8",
);

describe("content blobs control-plane migration", () => {
  test("installs content-neutral blob and upload-session storage", () => {
    expect(migration).toContain("CREATE TABLE content_blobs");
    expect(migration).toContain("CREATE TABLE content_upload_sessions");
    expect(migration).toContain("validation_profile TEXT NOT NULL");
    expect(migration).toContain("upload_mode IN ('proxy', 'direct_multipart')");
    expect(migration).toContain("REFERENCES content_blobs(content_blob_id) ON DELETE CASCADE");
  });

  test("requires verified metadata and scan evidence before ready", () => {
    expect(migration).toContain("CONSTRAINT content_blobs_ready_metadata_check");
    expect(migration).toContain("security_scan_state IN ('clean', 'not_required')");
    expect(migration).toContain("CONSTRAINT content_blobs_scan_evidence_check");
    expect(migration).toContain("CONSTRAINT content_blobs_clean_scanner_version_check");
  });

  test("enforces one claim and one active upload session", () => {
    expect(migration).toContain("CONSTRAINT content_blobs_claim_pair_check");
    expect(migration).toContain("CREATE UNIQUE INDEX idx_content_blobs_claim");
    expect(migration).toContain("CREATE UNIQUE INDEX idx_content_upload_sessions_active_blob");
    expect(migration).toContain("WHERE status NOT IN ('uploaded', 'aborted')");
  });

  test("grants only the intended runtime and read roles", () => {
    const statements = postgresMigrationStatements(migration);

    expect(statements).toContain(
      "REVOKE ALL ON TABLE content_blobs, content_upload_sessions FROM PUBLIC;",
    );
    expect(statements.some((statement) =>
      statement.includes("TO control_plane_api_rw;")
      && statement.includes("SELECT, INSERT, UPDATE, DELETE")
    )).toBe(true);
    expect(statements.some((statement) =>
      statement.includes("TO control_plane_api_ro, control_plane_ops_ro;")
      && statement.includes("GRANT SELECT")
    )).toBe(true);
  });
});
