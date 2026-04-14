import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileCommunityProvisioningState } from "./community-provisioning-reconcile";

const tempDirs: string[] = [];

function makeDatabaseUrl(): string {
  const dir = mkdtempSync(join(tmpdir(), "community-provisioning-reconcile-"));
  tempDirs.push(dir);
  return `file:${join(dir, "control-plane.db")}`;
}

async function setupDatabase(databaseUrl: string): Promise<void> {
  const db = new Bun.SQL(databaseUrl);
  try {
    await db.unsafe(`
      CREATE TABLE communities (
        community_id TEXT PRIMARY KEY,
        primary_database_binding_id TEXT,
        status TEXT NOT NULL,
        provisioning_state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE community_database_bindings (
        community_database_binding_id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      );

      CREATE TABLE community_db_credentials (
        community_db_credential_id TEXT PRIMARY KEY,
        community_database_binding_id TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE audit_log (
        audit_event_id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        community_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  } finally {
    await db.end();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("community provisioning reconciliation", () => {
  test("promotes eligible error communities with an active binding and credential", async () => {
    const databaseUrl = makeDatabaseUrl();
    await setupDatabase(databaseUrl);

    const db = new Bun.SQL(databaseUrl);
    try {
      await db.unsafe(`
        INSERT INTO communities (
          community_id,
          primary_database_binding_id,
          status,
          provisioning_state,
          updated_at
        ) VALUES (
          'cmt_ok',
          'cdb_ok',
          'active',
          'error',
          '2026-04-12T00:00:00.000Z'
        );

        INSERT INTO community_database_bindings (
          community_database_binding_id,
          status
        ) VALUES (
          'cdb_ok',
          'active'
        );

        INSERT INTO community_db_credentials (
          community_db_credential_id,
          community_database_binding_id,
          status
        ) VALUES (
          'cdc_ok',
          'cdb_ok',
          'active'
        );
      `);
    } finally {
      await db.end();
    }

    const result = await reconcileCommunityProvisioningState({
      controlPlaneDatabaseUrl: databaseUrl,
      allErrorCommunities: true,
      now: new Date("2026-04-12T01:00:00.000Z"),
    });

    expect(result.checkedCommunityCount).toBe(1);
    expect(result.promotedCommunityCount).toBe(1);
    expect(result.communities).toEqual([
      {
        communityId: "cmt_ok",
        status: "promoted",
        reason: "promoted_to_active",
      },
    ]);

    const verifyDb = new Bun.SQL(databaseUrl);
    try {
      const communities = await verifyDb<{ provisioning_state: string }[]>`
        SELECT provisioning_state
        FROM communities
        WHERE community_id = 'cmt_ok'
      `;
      expect(communities[0]?.provisioning_state).toBe("active");

      const audits = await verifyDb<{ action: string }[]>`
        SELECT action
        FROM audit_log
        WHERE community_id = 'cmt_ok'
      `;
      expect(audits[0]?.action).toBe("community.provisioning_reconciled_active");
    } finally {
      await verifyDb.end();
    }
  });

  test("skips communities with invalid binding or credential shape", async () => {
    const databaseUrl = makeDatabaseUrl();
    await setupDatabase(databaseUrl);

    const db = new Bun.SQL(databaseUrl);
    try {
      await db.unsafe(`
        INSERT INTO communities (
          community_id,
          primary_database_binding_id,
          status,
          provisioning_state,
          updated_at
        ) VALUES (
          'cmt_skip',
          'cdb_skip',
          'active',
          'error',
          '2026-04-12T00:00:00.000Z'
        );

        INSERT INTO community_database_bindings (
          community_database_binding_id,
          status
        ) VALUES (
          'cdb_skip',
          'error'
        );
      `);
    } finally {
      await db.end();
    }

    const result = await reconcileCommunityProvisioningState({
      controlPlaneDatabaseUrl: databaseUrl,
      allErrorCommunities: true,
      now: new Date("2026-04-12T01:00:00.000Z"),
    });

    expect(result.checkedCommunityCount).toBe(1);
    expect(result.promotedCommunityCount).toBe(0);
    expect(result.communities).toEqual([
      {
        communityId: "cmt_skip",
        status: "skipped",
        reason: "binding_status=error",
      },
    ]);
  });

  test("parameterizes explicit community ids when listing candidates", async () => {
    const databaseUrl = makeDatabaseUrl();
    await setupDatabase(databaseUrl);

    const db = new Bun.SQL(databaseUrl);
    try {
      await db.unsafe(`
        INSERT INTO communities (
          community_id,
          primary_database_binding_id,
          status,
          provisioning_state,
          updated_at
        ) VALUES (
          'cmt_quote''d',
          'cdb_quote',
          'active',
          'error',
          '2026-04-12T00:00:00.000Z'
        );

        INSERT INTO community_database_bindings (
          community_database_binding_id,
          status
        ) VALUES (
          'cdb_quote',
          'active'
        );

        INSERT INTO community_db_credentials (
          community_db_credential_id,
          community_database_binding_id,
          status
        ) VALUES (
          'cdc_quote',
          'cdb_quote',
          'active'
        );
      `);
    } finally {
      await db.end();
    }

    const result = await reconcileCommunityProvisioningState({
      controlPlaneDatabaseUrl: databaseUrl,
      communityIds: ["cmt_quote'd"],
      now: new Date("2026-04-12T01:00:00.000Z"),
    });

    expect(result.checkedCommunityCount).toBe(1);
    expect(result.promotedCommunityCount).toBe(1);
    expect(result.communities).toEqual([
      {
        communityId: "cmt_quote'd",
        status: "promoted",
        reason: "promoted_to_active",
      },
    ]);
  });
});
