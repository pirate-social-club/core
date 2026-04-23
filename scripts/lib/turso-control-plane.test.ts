import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { doctorControlPlane, provisionCommunity, rotateCommunityToken } from "./turso-control-plane";
import { seedControlPlaneFixtures } from "./control-plane-fixtures";
import { decryptCommunityDbCredential } from "./shared/community-db-credential-crypto";
import { splitSqlStatements, toSqliteCompatibleStatement } from "./shared/sql-migration";

type Cleanup = () => Promise<void>;

let cleanup: Cleanup | null = null;

async function createControlPlaneTestDatabase(): Promise<{
  databaseUrl: string;
  client: ReturnType<typeof createClient>;
  cleanup: Cleanup;
}> {
  const databasePath = join(tmpdir(), `pirate-v2-turso-control-plane-${Date.now()}.db`);
  const client = createClient({
    url: `file:${databasePath}`,
  });
  const migrationsDir = new URL("../../db/control-plane/migrations/", import.meta.url);
  const entries = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  const baselineEntry = entries.find((entry) => entry.startsWith("0000_") && entry.includes("baseline"));
  const entriesToApply = baselineEntry ? [baselineEntry] : entries;

  for (const entry of entriesToApply) {
    const rawSql = await readFile(new URL(entry, migrationsDir), "utf8");
    for (const statement of splitSqlStatements(rawSql)) {
      const sqliteStatement = toSqliteCompatibleStatement(statement);
      if (!sqliteStatement) {
        continue;
      }
      await client.execute(sqliteStatement);
    }
  }

  return {
    databaseUrl: `file:${databasePath}`,
    client,
    cleanup: async () => {
      client.close();
      await rm(databasePath, { force: true });
    },
  };
}

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
});

describe("turso control-plane provision-community", () => {
  test("provisions control-plane rows, stores an encrypted credential, and bootstraps the remote DB with the minted token", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_turso_01",
      subject: "turso-user-01",
      handle: "turso",
      namespaceLabel: "turso-root",
    });

    const requests: string[] = [];
    let bootstrapInput: Record<string, unknown> | null = null;
    const result = await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_turso_01",
      creatorUserId: fixture.userId,
      displayName: "Turso Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      groupLocation: "iad",
      fetch: async (url, init) => {
        requests.push(`${String(init?.method ?? "GET")} ${String(url)}`);
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_01",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-turso-01",
              db_id: "db_01",
              hostname: "main-cmt-turso-01-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-turso-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-01" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => {
        bootstrapInput = input as unknown as Record<string, unknown>;
        return {
          databaseUrl: input.databaseUrl,
          communityId: input.communityId,
          namespaceId: `ns_${input.communityId}`,
        };
      },
      now: new Date("2026-04-12T00:00:00.000Z"),
    });

    expect(result.communityId).toBe("cmt_turso_01");
    expect(result.groupName).toBe("region-iad");
    expect(result.databaseName).toBe("main-cmt-turso-01");
    expect(result.tokenName).toBe("worker-cmt_turso_01-v1");
    expect(result.rotationNumber).toBe(1);
    expect(result.databaseUrl).toBe("libsql://main-cmt-turso-01-pirate-org.iad.turso.io");

    expect(bootstrapInput).toEqual({
      databaseUrl: "libsql://main-cmt-turso-01-pirate-org.iad.turso.io",
      databaseAuthToken: "db-token-01",
      communityId: "cmt_turso_01",
      userId: fixture.userId,
      displayName: "Turso Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      description: null,
      membershipMode: "open",
      defaultAgeGatePolicy: "none",
      membershipUniqueHumanProvider: null,
      postingUniqueHumanProvider: null,
      handlePolicyTemplate: "standard",
      handlePricingModel: null,
      namespaceLabel: "turso-root",
      now: new Date("2026-04-12T00:00:00.000Z"),
    });

    const communities = await db.client.execute({
      sql: `
        SELECT provisioning_state, primary_database_binding_id
        FROM communities
        WHERE community_id = ?1
      `,
      args: ["cmt_turso_01"],
    });
    expect(communities.rows[0]?.provisioning_state).toBe("active");
    expect(communities.rows[0]?.primary_database_binding_id).toBe(result.communityDatabaseBindingId);

    const bindings = await db.client.execute({
      sql: `
        SELECT organization_slug, group_name, database_name, database_url, status
        FROM community_database_bindings
        WHERE community_database_binding_id = ?1
      `,
      args: [result.communityDatabaseBindingId],
    });
    expect(bindings.rows[0]?.organization_slug).toBe("pirate-org");
    expect(bindings.rows[0]?.group_name).toBe("region-iad");
    expect(bindings.rows[0]?.database_name).toBe("main-cmt-turso-01");
    expect(bindings.rows[0]?.database_url).toBe("libsql://main-cmt-turso-01-pirate-org.iad.turso.io");
    expect(bindings.rows[0]?.status).toBe("active");

    const credentials = await db.client.execute({
      sql: `
        SELECT token_name, encrypted_token, encryption_key_version, status
        FROM community_db_credentials
        WHERE community_database_binding_id = ?1
      `,
      args: [result.communityDatabaseBindingId],
    });
    expect(credentials.rows).toHaveLength(1);
    expect(credentials.rows[0]?.token_name).toBe("worker-cmt_turso_01-v1");
    expect(credentials.rows[0]?.status).toBe("active");
    expect(String(credentials.rows[0]?.encrypted_token ?? "") === "db-token-01").toBe(false);
    expect(
      decryptCommunityDbCredential({
        encryptedToken: String(credentials.rows[0]?.encrypted_token ?? ""),
        encryptionKeyVersion: Number(credentials.rows[0]?.encryption_key_version ?? 0),
        wrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    ).toBe("db-token-01");

    const jobs = await db.client.execute({
      sql: `
        SELECT status, result_ref, error_code
        FROM jobs
        WHERE job_id = ?1
      `,
      args: [result.jobId],
    });
    expect(jobs.rows[0]?.status).toBe("succeeded");
    expect(jobs.rows[0]?.result_ref).toBe("libsql://main-cmt-turso-01-pirate-org.iad.turso.io");
    expect(jobs.rows[0]?.error_code).toBeNull();

    expect(requests).toEqual([
      "GET https://api.turso.tech/v1/organizations/pirate-org/groups",
      "POST https://api.turso.tech/v1/organizations/pirate-org/groups",
      "PATCH https://api.turso.tech/v1/organizations/pirate-org/groups/region-iad/configuration",
      "GET https://api.turso.tech/v1/organizations/pirate-org/databases?group=region-iad",
      "POST https://api.turso.tech/v1/organizations/pirate-org/databases",
      "PATCH https://api.turso.tech/v1/organizations/pirate-org/databases/main-cmt-turso-01/configuration",
      "POST https://api.turso.tech/v1/organizations/pirate-org/databases/main-cmt-turso-01/auth/tokens?authorization=full-access",
    ]);
  });

  test("provisions a namespaceless community without requiring namespace verification", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_turso_no_namespace",
      subject: "turso-no-namespace-user",
      handle: "turso-nsless",
    });

    let bootstrapInput: Record<string, unknown> | null = null;
    const result = await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_turso_no_namespace",
      creatorUserId: fixture.userId,
      displayName: "Turso Namespaceless Club",
      namespaceVerificationId: null,
      groupLocation: "iad",
      fetch: async (url, init) => {
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_no_namespace",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-turso-no-namespace",
              db_id: "db_no_namespace",
              hostname: "main-cmt-turso-no-namespace-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-turso-no-namespace/auth/tokens")) {
          return Response.json({ jwt: "db-token-no-namespace" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => {
        bootstrapInput = input as unknown as Record<string, unknown>;
        return {
          databaseUrl: input.databaseUrl,
          communityId: input.communityId,
          namespaceId: null,
        };
      },
      now: new Date("2026-04-18T00:00:00.000Z"),
    });

    expect(result.communityId).toBe("cmt_turso_no_namespace");
    expect(bootstrapInput).toEqual({
      databaseUrl: "libsql://main-cmt-turso-no-namespace-pirate-org.iad.turso.io",
      databaseAuthToken: "db-token-no-namespace",
      communityId: "cmt_turso_no_namespace",
      userId: fixture.userId,
      displayName: "Turso Namespaceless Club",
      namespaceVerificationId: null,
      description: null,
      membershipMode: "open",
      defaultAgeGatePolicy: "none",
      membershipUniqueHumanProvider: null,
      postingUniqueHumanProvider: null,
      handlePolicyTemplate: "standard",
      handlePricingModel: null,
      namespaceLabel: null,
      now: new Date("2026-04-18T00:00:00.000Z"),
    });

    const communities = await db.client.execute({
      sql: `
        SELECT namespace_verification_id, provisioning_state
        FROM communities
        WHERE community_id = ?1
      `,
      args: ["cmt_turso_no_namespace"],
    });
    expect(communities.rows[0]?.namespace_verification_id).toBeNull();
    expect(communities.rows[0]?.provisioning_state).toBe("active");
  });

  test("reuses a region pool group while creating a separate database per community", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const firstFixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_region_pool_01",
      subject: "region-pool-user-01",
      handle: "regionpoolone",
      namespaceLabel: "region-pool-one",
    });
    const secondFixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_region_pool_02",
      subject: "region-pool-user-02",
      handle: "regionpooltwo",
      namespaceLabel: "region-pool-two",
    });

    const requests: string[] = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const method = String(init?.method ?? "GET");
      const text = String(url);
      requests.push(`${method} ${text}`);

      if (text.endsWith("/groups")) {
        return Response.json({
          groups: [
            {
              name: "region-aws-ap-south-1",
              uuid: "grp_india",
              locations: ["aws-ap-south-1"],
              primary: "aws-ap-south-1",
              delete_protection: true,
            },
          ],
        });
      }
      if (text.includes("/databases?group=region-aws-ap-south-1")) {
        return Response.json({ databases: [] });
      }
      if (text.endsWith("/databases")) {
        const rawBody = typeof init?.body === "string" ? init.body : "{}";
        const body = JSON.parse(rawBody) as { name?: string; group?: string };
        return Response.json({
          database: {
            name: body.name,
            db_id: `db_${body.name}`,
            hostname: `${body.name}-pirate-org.aws-ap-south-1.turso.io`,
            group: body.group,
            primary_region: "aws-ap-south-1",
            regions: ["aws-ap-south-1"],
            delete_protection: true,
          },
        });
      }
      if (text.includes("/auth/tokens")) {
        return Response.json({ jwt: `token-${text.split("/databases/")[1]?.split("/")[0]}` });
      }
      return new Response("not found", { status: 404 });
    };

    const baseInput = {
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      groupLocation: "aws-ap-south-1",
      fetch,
      bootstrapCommunityDatabaseFn: async (input: Parameters<NonNullable<Parameters<typeof provisionCommunity>[0]["bootstrapCommunityDatabaseFn"]>>[0]) => ({
        databaseUrl: input.databaseUrl,
        communityId: input.communityId,
        namespaceId: `ns_${input.communityId}`,
      }),
    };

    const first = await provisionCommunity({
      ...baseInput,
      communityId: "cmt_region_pool_01",
      creatorUserId: firstFixture.userId,
      displayName: "Region Pool One",
      namespaceVerificationId: firstFixture.namespaceVerificationId,
    });
    const second = await provisionCommunity({
      ...baseInput,
      communityId: "cmt_region_pool_02",
      creatorUserId: secondFixture.userId,
      displayName: "Region Pool Two",
      namespaceVerificationId: secondFixture.namespaceVerificationId,
    });

    expect(first.groupName).toBe("region-aws-ap-south-1");
    expect(second.groupName).toBe("region-aws-ap-south-1");
    expect(first.databaseName).toBe("main-cmt-region-pool-01");
    expect(second.databaseName).toBe("main-cmt-region-pool-02");
    expect(requests.filter((request) => request === "POST https://api.turso.tech/v1/organizations/pirate-org/groups")).toHaveLength(0);

    const bindings = await db.client.execute({
      sql: `
        SELECT community_id, group_name, database_name, location
        FROM community_database_bindings
        WHERE community_id IN (?1, ?2)
        ORDER BY community_id ASC
      `,
      args: ["cmt_region_pool_01", "cmt_region_pool_02"],
    });
    expect(bindings.rows).toEqual([
      {
        community_id: "cmt_region_pool_01",
        group_name: "region-aws-ap-south-1",
        database_name: "main-cmt-region-pool-01",
        location: "aws-ap-south-1",
      },
      {
        community_id: "cmt_region_pool_02",
        group_name: "region-aws-ap-south-1",
        database_name: "main-cmt-region-pool-02",
        location: "aws-ap-south-1",
      },
    ]);
  });

  test("passes membership-scope unique-human gate bootstrap input through provisioning", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_join_gate_01",
      subject: "join-gate-user-01",
      handle: "joingate",
      namespaceLabel: "join-gate-root",
    });

    let bootstrapInput: Record<string, unknown> | null = null;
    await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_join_gate_01",
      creatorUserId: fixture.userId,
      displayName: "Join Gate Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      groupLocation: "iad",
      membershipMode: "gated",
      membershipUniqueHumanProvider: "very",
      fetch: async (url, init) => {
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_join",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-join-gate-01",
              db_id: "db_join",
              hostname: "main-cmt-join-gate-01-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-join-gate-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-join" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => {
        bootstrapInput = input as unknown as Record<string, unknown>;
        return {
          databaseUrl: input.databaseUrl,
          communityId: input.communityId,
          namespaceId: `ns_${input.communityId}`,
        };
      },
    });

    expect(bootstrapInput).toMatchObject({
      membershipMode: "gated",
      membershipUniqueHumanProvider: "very",
      postingUniqueHumanProvider: null,
    });
  });
});

describe("turso control-plane rotate-community-token", () => {
  test("mints a new token, supersedes the prior active credential, and keeps the binding stable", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_rotate_01",
      subject: "rotate-user-01",
      handle: "rotate",
      namespaceLabel: "rotate-root",
    });

    await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_rotate_01",
      creatorUserId: fixture.userId,
      displayName: "Rotate Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      groupLocation: "iad",
      fetch: async (url, init) => {
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_rotate_01",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-rotate-01",
              db_id: "db_rotate_01",
              hostname: "main-cmt-rotate-01-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-rotate-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-v1" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => ({
        databaseUrl: input.databaseUrl,
        communityId: input.communityId,
        namespaceId: `ns_${input.communityId}`,
      }),
      now: new Date("2026-04-12T00:00:00.000Z"),
    });

    const rotateRequests: string[] = [];
    const rotated = await rotateCommunityToken({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 2,
      communityId: "cmt_rotate_01",
      reason: "scheduled_rotation",
      fetch: async (url, init) => {
        rotateRequests.push(`${String(init?.method ?? "GET")} ${String(url)}`);
        if (String(url).includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (String(url).includes("/databases/main-cmt-rotate-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-v2" });
        }
        return new Response("not found", { status: 404 });
      },
      now: new Date("2026-04-12T01:00:00.000Z"),
    });

    expect(rotated.communityId).toBe("cmt_rotate_01");
    expect(rotated.tokenName).toBe("worker-cmt_rotate_01-v2");
    expect(rotated.rotationNumber).toBe(2);
    expect(rotated.databaseName).toBe("main-cmt-rotate-01");
    expect(rotated.databaseUrl).toBe("libsql://main-cmt-rotate-01-pirate-org.iad.turso.io");

    const rows = await db.client.execute({
      sql: `
        SELECT token_name, encrypted_token, encryption_key_version, status, invalidated_at
        FROM community_db_credentials
        WHERE community_database_binding_id = ?1
        ORDER BY created_at ASC
      `,
      args: [rotated.communityDatabaseBindingId],
    });
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.token_name).toBe("worker-cmt_rotate_01-v1");
    expect(rows.rows[0]?.status).toBe("superseded");
    expect(rows.rows[0]?.invalidated_at).toBe("2026-04-12T01:00:00.000Z");
    expect(rows.rows[1]?.token_name).toBe("worker-cmt_rotate_01-v2");
    expect(rows.rows[1]?.status).toBe("active");
    expect(
      decryptCommunityDbCredential({
        encryptedToken: String(rows.rows[1]?.encrypted_token ?? ""),
        encryptionKeyVersion: Number(rows.rows[1]?.encryption_key_version ?? 0),
        wrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    ).toBe("db-token-v2");

    const bindings = await db.client.execute({
      sql: `
        SELECT community_database_binding_id, database_url
        FROM community_database_bindings
        WHERE community_id = ?1
          AND binding_role = 'primary'
      `,
      args: ["cmt_rotate_01"],
    });
    expect(bindings.rows).toHaveLength(1);
    expect(bindings.rows[0]?.community_database_binding_id).toBe(rotated.communityDatabaseBindingId);
    expect(bindings.rows[0]?.database_url).toBe("libsql://main-cmt-rotate-01-pirate-org.iad.turso.io");

    const audits = await db.client.execute({
      sql: `
        SELECT action, metadata_json
        FROM audit_log
        WHERE community_id = ?1
          AND action = 'community.turso_token_rotated'
      `,
      args: ["cmt_rotate_01"],
    });
    expect(audits.rows).toHaveLength(1);
    expect(String(audits.rows[0]?.metadata_json ?? "")).toMatch(/scheduled_rotation/);

    expect(rotateRequests).toEqual([
      "POST https://api.turso.tech/v1/organizations/pirate-org/databases/main-cmt-rotate-01/auth/tokens?authorization=full-access",
    ]);
  });
});

describe("turso control-plane doctor", () => {
  test("returns zero findings for a healthy provisioned community", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_doctor_ok_01",
      subject: "doctor-ok-user-01",
      handle: "doctorok",
      namespaceLabel: "doctor-ok-root",
    });

    await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_doctor_ok_01",
      creatorUserId: fixture.userId,
      displayName: "Doctor OK Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      groupLocation: "iad",
      fetch: async (url, init) => {
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_doctor_ok_01",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-doctor-ok-01",
              db_id: "db_doctor_ok_01",
              hostname: "main-cmt-doctor-ok-01-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-doctor-ok-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-doctor-ok-01" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => ({
        databaseUrl: input.databaseUrl,
        communityId: input.communityId,
        namespaceId: `ns_${input.communityId}`,
      }),
      now: new Date("2026-04-12T02:00:00.000Z"),
    });

    const result = await doctorControlPlane({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      inspectCommunityDatabaseSchemaFn: async () => ({
        missingMigrationNames: [],
        mismatchedMigrationNames: [],
        unexpectedMigrationNames: [],
      }),
    });

    expect(result.checkedCommunityCount).toBe(1);
    expect(result.checkedBindingCount).toBe(1);
    expect(result.checkedCredentialCount).toBe(1);
    expect(result.findingCount).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("reports binding and credential drift for an active community", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_doctor_bad_01",
      subject: "doctor-bad-user-01",
      handle: "doctorbad",
      namespaceLabel: "doctor-bad-root",
    });

    const provisioned = await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_doctor_bad_01",
      creatorUserId: fixture.userId,
      displayName: "Doctor Bad Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      groupLocation: "iad",
      fetch: async (url, init) => {
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_doctor_bad_01",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-doctor-bad-01",
              db_id: "db_doctor_bad_01",
              hostname: "main-cmt-doctor-bad-01-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-doctor-bad-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-doctor-bad-01" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => ({
        databaseUrl: input.databaseUrl,
        communityId: input.communityId,
        namespaceId: `ns_${input.communityId}`,
      }),
      now: new Date("2026-04-12T03:00:00.000Z"),
    });

    await db.client.execute({
      sql: `
        UPDATE community_database_bindings
        SET group_name = 'club-wrong',
            database_name = 'shadow',
            database_url = 'https://example.com/not-libsql'
        WHERE community_database_binding_id = ?1
      `,
      args: [provisioned.communityDatabaseBindingId],
    });
    await db.client.execute({
      sql: `
        UPDATE community_db_credentials
        SET status = 'superseded',
            invalidated_at = '2026-04-12T03:30:00.000Z',
            updated_at = '2026-04-12T03:30:00.000Z'
        WHERE community_database_binding_id = ?1
      `,
      args: [provisioned.communityDatabaseBindingId],
    });
    await db.client.execute({
      sql: `
        UPDATE communities
        SET transfer_state = 'pending'
        WHERE community_id = ?1
      `,
      args: ["cmt_doctor_bad_01"],
    });

    const result = await doctorControlPlane({
      controlPlaneDatabaseUrl: db.databaseUrl,
      communityId: "cmt_doctor_bad_01",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });

    expect(result.checkedCommunityCount).toBe(1);
    expect(result.checkedBindingCount).toBe(1);
    expect(result.checkedCredentialCount).toBe(0);
    expect(result.findingCount).toBe(5);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "community_transfer_state_invalid",
      "binding_group_name_mismatch",
      "binding_database_name_mismatch",
      "binding_database_url_invalid",
      "binding_missing_active_credential",
    ]);
  });

  test("reports schema migration drift for an otherwise healthy active community", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_doctor_schema_01",
      subject: "doctor-schema-user-01",
      handle: "doctorschema",
      namespaceLabel: "doctor-schema-root",
    });

    await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_doctor_schema_01",
      creatorUserId: fixture.userId,
      displayName: "Doctor Schema Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      groupLocation: "iad",
      fetch: async (url, init) => {
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_doctor_schema_01",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-doctor-schema-01",
              db_id: "db_doctor_schema_01",
              hostname: "main-cmt-doctor-schema-01-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-doctor-schema-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-doctor-schema-01" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => ({
        databaseUrl: input.databaseUrl,
        communityId: input.communityId,
        namespaceId: `ns_${input.communityId}`,
      }),
      now: new Date("2026-04-12T04:00:00.000Z"),
    });

    const result = await doctorControlPlane({
      controlPlaneDatabaseUrl: db.databaseUrl,
      communityId: "cmt_doctor_schema_01",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      inspectCommunityDatabaseSchemaFn: async () => ({
        missingMigrationNames: ["1001_community_bootstrap.sql"],
        mismatchedMigrationNames: ["1002_community_memberships.sql"],
        unexpectedMigrationNames: ["9999_manual_hotfix.sql"],
      }),
    });

    expect(result.checkedCommunityCount).toBe(1);
    expect(result.checkedBindingCount).toBe(1);
    expect(result.checkedCredentialCount).toBe(1);
    expect(result.findingCount).toBe(1);
    expect(result.findings[0]?.code).toBe("binding_schema_migrations_mismatch");
  });

  test("reports route slug collisions with another active community namespace", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const fixture = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_doctor_collision_01",
      subject: "doctor-collision-user-01",
      handle: "doctorcollision",
      namespaceLabel: "infinity",
    });

    await provisionCommunity({
      controlPlaneDatabaseUrl: db.databaseUrl,
      tursoPlatformApiToken: "platform-token",
      tursoOrganizationSlug: "pirate-org",
      tursoCommunityDbWrapKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      tursoCommunityDbWrapKeyVersion: 1,
      communityId: "cmt_doctor_collision_01",
      creatorUserId: fixture.userId,
      displayName: "Doctor Collision Club",
      namespaceVerificationId: fixture.namespaceVerificationId,
      groupLocation: "iad",
      fetch: async (url, init) => {
        const text = String(url);
        if (text.includes("/groups") && String(init?.method ?? "GET") === "POST") {
          return Response.json({
            group: {
              name: "region-iad",
              uuid: "grp_doctor_collision_01",
              locations: ["iad"],
              primary: "iad",
              delete_protection: false,
            },
          });
        }
        if (text.endsWith("/groups")) {
          return Response.json({ groups: [] });
        }
        if (text.includes("/databases?group=region-iad")) {
          return Response.json({ databases: [] });
        }
        if (text.endsWith("/databases")) {
          return Response.json({
            database: {
              name: "main-cmt-doctor-collision-01",
              db_id: "db_doctor_collision_01",
              hostname: "main-cmt-doctor-collision-01-pirate-org.iad.turso.io",
              group: "region-iad",
              primary_region: "iad",
              regions: ["iad"],
            },
          });
        }
        if (text.includes("/configuration") && String(init?.method ?? "GET") === "PATCH") {
          return Response.json({ delete_protection: true });
        }
        if (text.includes("/databases/main-cmt-doctor-collision-01/auth/tokens")) {
          return Response.json({ jwt: "db-token-doctor-collision-01" });
        }
        return new Response("not found", { status: 404 });
      },
      bootstrapCommunityDatabaseFn: async (input) => ({
        databaseUrl: input.databaseUrl,
        communityId: input.communityId,
        namespaceId: `ns_${input.communityId}`,
      }),
      now: new Date("2026-04-12T04:00:00.000Z"),
    });

    await db.client.execute({
      sql: `
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
          ?1, ?2, ?3, 'open', 'active', 'active', 'none', ?4, ?5, NULL, ?6, ?6
        )
      `,
      args: [
        "cmt_doctor_collision_legacy",
        fixture.userId,
        "Doctor Collision Legacy",
        "infinity",
        null,
        "2026-04-12T04:30:00.000Z",
      ],
    });
    await db.client.execute({
      sql: `
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
          ?1, ?2, 'primary', 'local-dev', 'club-cmt_doctor_collision_legacy', NULL, 'main', NULL,
          'file:///tmp/pirate-community-dbs/community-cmt_doctor_collision_legacy.db', 'local', 'active', NULL, ?3, ?3
        )
      `,
      args: [
        "cdb_doctor_collision_legacy_primary",
        "cmt_doctor_collision_legacy",
        "2026-04-12T04:30:00.000Z",
      ],
    });
    await db.client.execute({
      sql: `
        UPDATE communities
        SET primary_database_binding_id = ?2
        WHERE community_id = ?1
      `,
      args: [
        "cmt_doctor_collision_legacy",
        "cdb_doctor_collision_legacy_primary",
      ],
    });

    const result = await doctorControlPlane({
      controlPlaneDatabaseUrl: db.databaseUrl,
      communityId: "cmt_doctor_collision_legacy",
    });

    expect(result.findings.map((finding) => finding.code)).toContain("route_slug_namespace_collision");
  });
});
