import { describe, expect, test } from "bun:test";
import {
  createTursoControlPlaneOperatorHandler,
  resolveOperatorHost,
  resolveOperatorPort,
} from "./turso-control-plane-operator";

const baseEnv = {
  CONTROL_PLANE_DATABASE_URL: "file:/tmp/control-plane.db",
  TURSO_PLATFORM_API_TOKEN: "platform-token",
  TURSO_ORGANIZATION_SLUG: "pirate-prod",
  EXPECTED_TURSO_ORGANIZATION_SLUG: "pirate-prod",
  TURSO_COMMUNITY_DB_WRAP_KEY: "11".repeat(32),
  TURSO_COMMUNITY_DB_WRAP_KEY_VERSION: "7",
  COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN: "operator-shared-token",
} as const;

describe("turso control-plane operator handler", () => {
  test("refuses to start when the Turso organization does not match the expected slug", () => {
    expect(() => createTursoControlPlaneOperatorHandler({
      ...baseEnv,
      TURSO_ORGANIZATION_SLUG: "pirate-social",
    })).toThrow("TURSO_ORGANIZATION_SLUG mismatch: expected pirate-prod, got pirate-social");
  });

  test("health endpoint is readable without auth", async () => {
    const handler = createTursoControlPlaneOperatorHandler(baseEnv);
    const response = await handler(new Request("http://operator.test/health"));
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; requires_bearer_auth: boolean };
    expect(body.ok).toBe(true);
    expect(body.requires_bearer_auth).toBe(true);
  });

  test("private routes require bearer auth", async () => {
    const handler = createTursoControlPlaneOperatorHandler(baseEnv);
    const response = await handler(new Request("http://operator.test/internal/v0/community-provisioning/provision", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(401);
    const body = await response.json() as { error_code: string };
    expect(body.error_code).toBe("unauthorized");
  });

  test("provision route delegates and returns the worker-facing response shape", async () => {
    let received: Record<string, unknown> | null = null;
    const handler = createTursoControlPlaneOperatorHandler(baseEnv, {
      provisionCommunityFn: async (input) => {
        received = input as unknown as Record<string, unknown>;
        return {
          communityId: "cmt_01",
          jobId: "job_01",
          communityDatabaseBindingId: "cdb_01",
          communityDbCredentialId: "cdc_01",
          organizationSlug: "pirate-prod",
          groupName: "region-aws-us-east-1",
          groupId: "grp_01",
          databaseName: "main-cmt-01",
          databaseId: "db_01",
          databaseUrl: "libsql://main-cmt-01-pirate-prod.aws-us-east-1.turso.io",
          location: "aws-us-east-1",
          tokenName: "worker-cmt_01-v1",
          plaintextToken: "db-token-01",
          issuedAt: "2026-04-12T00:00:00.000Z",
          expiresAt: null,
          rotationNumber: 1,
        };
      },
    });

    const response = await handler(new Request("http://operator.test/internal/v0/community-provisioning/provision", {
      method: "POST",
      headers: {
        authorization: `Bearer ${baseEnv.COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        community_id: "cmt_01",
        creator_user_id: "usr_01",
        display_name: "Infinity",
        namespace_verification_id: "nv_01",
        group_location: "aws-us-east-1",
        bootstrap_payload: {
          description: "hello",
          membership_mode: "gated",
          default_age_gate_policy: "18_plus",
          membership_unique_human_provider: "very",
          posting_unique_human_provider: "very",
          handle_policy_template: "standard",
          handle_pricing_model: null,
          namespace_label: "infinity",
          initial_settings: {
            human_verification_lane: "very",
            agent_posting_policy: "allow",
            agent_posting_scope: "top_level_and_replies",
            agent_daily_post_cap: 10,
            agent_daily_reply_cap: 50,
            accepted_agent_ownership_providers: ["clawkey"],
          },
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(received).toMatchObject({
      controlPlaneDatabaseUrl: baseEnv.CONTROL_PLANE_DATABASE_URL,
      tursoPlatformApiToken: baseEnv.TURSO_PLATFORM_API_TOKEN,
      tursoOrganizationSlug: baseEnv.TURSO_ORGANIZATION_SLUG,
      tursoCommunityDbWrapKey: baseEnv.TURSO_COMMUNITY_DB_WRAP_KEY,
      tursoCommunityDbWrapKeyVersion: 7,
      communityId: "cmt_01",
      creatorUserId: "usr_01",
      displayName: "Infinity",
      namespaceVerificationId: "nv_01",
      groupLocation: "aws-us-east-1",
      description: "hello",
      membershipMode: "gated",
      defaultAgeGatePolicy: "18_plus",
      membershipUniqueHumanProvider: "very",
      postingUniqueHumanProvider: "very",
      handlePolicyTemplate: "standard",
      namespaceLabel: "infinity",
      initialSettings: {
        human_verification_lane: "very",
        agent_posting_policy: "allow",
        agent_posting_scope: "top_level_and_replies",
        agent_daily_post_cap: 10,
        agent_daily_reply_cap: 50,
        accepted_agent_ownership_providers: ["clawkey"],
      },
    });

    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      community_id: "cmt_01",
      organization_slug: "pirate-prod",
      group_name: "region-aws-us-east-1",
      group_id: "grp_01",
      database_name: "main-cmt-01",
      database_id: "db_01",
      database_url: "libsql://main-cmt-01-pirate-prod.aws-us-east-1.turso.io",
      location: "aws-us-east-1",
      token_name: "worker-cmt_01-v1",
      plaintext_token: "db-token-01",
      rotation_number: 1,
    });
  });

  test("provision route accepts namespaceless community requests", async () => {
    let received: Record<string, unknown> | null = null;
    const handler = createTursoControlPlaneOperatorHandler(baseEnv, {
      provisionCommunityFn: async (input) => {
        received = input as unknown as Record<string, unknown>;
        return {
          communityId: "cmt_no_namespace",
          jobId: "job_no_namespace",
          communityDatabaseBindingId: "cdb_no_namespace",
          communityDbCredentialId: "cdc_no_namespace",
          organizationSlug: "pirate-prod",
          groupName: "region-aws-us-east-1",
          groupId: "grp_no_namespace",
          databaseName: "main-cmt-no-namespace",
          databaseId: "db_no_namespace",
          databaseUrl: "libsql://main-cmt-no-namespace-pirate-prod.aws-us-east-1.turso.io",
          location: "aws-us-east-1",
          tokenName: "worker-cmt_no_namespace-v1",
          plaintextToken: "db-token-no-namespace",
          issuedAt: "2026-04-12T00:00:00.000Z",
          expiresAt: null,
          rotationNumber: 1,
        };
      },
    });

    const response = await handler(new Request("http://operator.test/internal/v0/community-provisioning/provision", {
      method: "POST",
      headers: {
        authorization: `Bearer ${baseEnv.COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        community_id: "cmt_no_namespace",
        creator_user_id: "usr_01",
        display_name: "Namespaceless",
        namespace_verification_id: null,
        group_location: "aws-us-east-1",
        bootstrap_payload: {
          description: "hello",
          membership_mode: "open",
          default_age_gate_policy: "none",
          membership_unique_human_provider: null,
          posting_unique_human_provider: null,
          handle_policy_template: "standard",
          handle_pricing_model: null,
          namespace_label: null,
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(received).toMatchObject({
      communityId: "cmt_no_namespace",
      creatorUserId: "usr_01",
      displayName: "Namespaceless",
      namespaceVerificationId: null,
      groupLocation: "aws-us-east-1",
      namespaceLabel: null,
    });
  });

  test("doctor route delegates and returns findings", async () => {
    const handler = createTursoControlPlaneOperatorHandler(baseEnv, {
      doctorControlPlaneFn: async () => ({
        checkedCommunityCount: 1,
        checkedBindingCount: 1,
        checkedCredentialCount: 1,
        findingCount: 1,
        findings: [
          {
            severity: "error",
            code: "binding_database_url_invalid",
            communityId: "cmt_01",
            communityDatabaseBindingId: "cdb_01",
            message: "bad url",
          },
        ],
      }),
    });

    const response = await handler(new Request("http://operator.test/internal/v0/community-provisioning/doctor", {
      method: "POST",
      headers: {
        authorization: `Bearer ${baseEnv.COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        community_id: "cmt_01",
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      checked_communities: number;
      finding_count: number;
      findings: Array<{ code: string }>;
    };
    expect(body.checked_communities).toBe(1);
    expect(body.finding_count).toBe(1);
    expect(body.findings[0]?.code).toBe("binding_database_url_invalid");
  });

  test("port helper defaults and validates", () => {
    expect(resolveOperatorHost({})).toBe("127.0.0.1");
    expect(resolveOperatorPort({})).toBe(8789);
    expect(resolveOperatorPort({ COMMUNITY_PROVISION_OPERATOR_PORT: "9001" })).toBe(9001);
    expect(() => resolveOperatorPort({ COMMUNITY_PROVISION_OPERATOR_PORT: "0" })).toThrow(
      "COMMUNITY_PROVISION_OPERATOR_PORT must be a positive integer",
    );
  });
});
