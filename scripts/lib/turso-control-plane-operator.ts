import {
  doctorControlPlane,
  provisionCommunityRuntime,
  rotateCommunityToken,
  type DoctorResult,
  type ProvisionCommunityResult,
  type ProvisionCommunityRuntimeResult,
  type RotateCommunityTokenResult,
} from "./turso-control-plane";

export type TursoControlPlaneOperatorEnv = {
  CONTROL_PLANE_DATABASE_URL?: string;
  TURSO_CONTROL_PLANE_AUTH_TOKEN?: string;
  TURSO_PLATFORM_API_TOKEN?: string;
  TURSO_ORGANIZATION_SLUG?: string;
  TURSO_COMMUNITY_DB_WRAP_KEY?: string;
  TURSO_COMMUNITY_DB_WRAP_KEY_VERSION?: string;
  COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN?: string;
  COMMUNITY_PROVISION_OPERATOR_HOST?: string;
  COMMUNITY_PROVISION_OPERATOR_PORT?: string;
};

type ProvisionRouteBody = {
  community_id?: string;
  creator_user_id?: string;
  display_name?: string;
  namespace_verification_id?: string;
  group_location?: string;
  database_token_expiration?: string | null;
  bootstrap_payload?: {
    description?: string | null;
    membership_mode?: "open" | "request" | "gated";
    default_age_gate_policy?: "none" | "18_plus";
    membership_unique_human_provider?: "self" | "very" | null;
    posting_unique_human_provider?: "self" | "very" | null;
    handle_policy_template?: "standard" | "premium" | "membership_gated" | "custom";
    handle_pricing_model?: string | null;
    namespace_label?: string | null;
  } | null;
};

type RotateRouteBody = {
  community_id?: string;
  reason?: string | null;
  database_token_expiration?: string | null;
};

type DoctorRouteBody = {
  community_id?: string | null;
};

type OperatorDeps = {
  provisionCommunityFn?: typeof provisionCommunityRuntime;
  rotateCommunityTokenFn?: typeof rotateCommunityToken;
  doctorControlPlaneFn?: typeof doctorControlPlane;
};

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function trim(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function requireText(value: string | null | undefined, label: string): string {
  const normalized = trim(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function requirePositiveIntString(value: string | null | undefined, label: string): number {
  const normalized = requireText(value, label);
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

function requireOperatorAuth(request: Request, env: TursoControlPlaneOperatorEnv): Response | null {
  const expected = trim(env.COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN);
  if (!expected) {
    return json({ error_code: "operator_auth_not_configured" }, { status: 500 });
  }

  return request.headers.get("authorization") === `Bearer ${expected}`
    ? null
    : json({ error_code: "unauthorized" }, { status: 401 });
}

function requireOperatorRuntime(env: TursoControlPlaneOperatorEnv): {
  controlPlaneDatabaseUrl: string;
  controlPlaneAuthToken: string | null;
  tursoPlatformApiToken: string;
  tursoOrganizationSlug: string;
  tursoCommunityDbWrapKey: string;
  tursoCommunityDbWrapKeyVersion: number;
} {
  return {
    controlPlaneDatabaseUrl: requireText(env.CONTROL_PLANE_DATABASE_URL, "CONTROL_PLANE_DATABASE_URL"),
    controlPlaneAuthToken: trim(env.TURSO_CONTROL_PLANE_AUTH_TOKEN) || null,
    tursoPlatformApiToken: requireText(env.TURSO_PLATFORM_API_TOKEN, "TURSO_PLATFORM_API_TOKEN"),
    tursoOrganizationSlug: requireText(env.TURSO_ORGANIZATION_SLUG, "TURSO_ORGANIZATION_SLUG"),
    tursoCommunityDbWrapKey: requireText(env.TURSO_COMMUNITY_DB_WRAP_KEY, "TURSO_COMMUNITY_DB_WRAP_KEY"),
    tursoCommunityDbWrapKeyVersion: requirePositiveIntString(
      env.TURSO_COMMUNITY_DB_WRAP_KEY_VERSION,
      "TURSO_COMMUNITY_DB_WRAP_KEY_VERSION",
    ),
  };
}

function mapProvisionResponse(
  result: ProvisionCommunityResult | ProvisionCommunityRuntimeResult,
): Record<string, unknown> {
  return {
    community_id: result.communityId,
    job_id: "jobId" in result ? result.jobId : undefined,
    binding_id: "communityDatabaseBindingId" in result ? result.communityDatabaseBindingId : undefined,
    credential_id: "communityDbCredentialId" in result ? result.communityDbCredentialId : undefined,
    organization_slug: result.organizationSlug,
    group_name: result.groupName,
    group_id: result.groupId,
    database_name: result.databaseName,
    database_id: result.databaseId,
    database_url: result.databaseUrl,
    location: result.location,
    token_name: result.tokenName,
    plaintext_token: result.plaintextToken,
    issued_at: result.issuedAt,
    expires_at: result.expiresAt,
    rotation_number: result.rotationNumber,
  };
}

function mapRotateResponse(result: RotateCommunityTokenResult): Record<string, unknown> {
  return {
    community_id: result.communityId,
    binding_id: result.communityDatabaseBindingId,
    credential_id: result.communityDbCredentialId,
    database_name: result.databaseName,
    database_url: result.databaseUrl,
    token_name: result.tokenName,
    rotation_number: result.rotationNumber,
  };
}

function mapDoctorResponse(result: DoctorResult): Record<string, unknown> {
  return {
    checked_communities: result.checkedCommunityCount,
    checked_bindings: result.checkedBindingCount,
    checked_credentials: result.checkedCredentialCount,
    findings: result.findings,
    finding_count: result.findingCount,
  };
}

export function createTursoControlPlaneOperatorHandler(
  env: TursoControlPlaneOperatorEnv,
  deps: OperatorDeps = {},
): (request: Request) => Promise<Response> {
  const provisionCommunityFn = deps.provisionCommunityFn ?? provisionCommunityRuntime;
  const rotateCommunityTokenFn = deps.rotateCommunityTokenFn ?? rotateCommunityToken;
  const doctorControlPlaneFn = deps.doctorControlPlaneFn ?? doctorControlPlane;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        bind_host: trim(env.COMMUNITY_PROVISION_OPERATOR_HOST) || "127.0.0.1",
        bind_port: Number(trim(env.COMMUNITY_PROVISION_OPERATOR_PORT) || "8789"),
        requires_bearer_auth: Boolean(trim(env.COMMUNITY_PROVISION_OPERATOR_AUTH_TOKEN)),
      });
    }

    const authResponse = requireOperatorAuth(request, env);
    if (authResponse) {
      return authResponse;
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      if (url.pathname === "/internal/v0/community-provisioning/provision") {
        const body = await readJson<ProvisionRouteBody>(request);
        const runtime = requireOperatorRuntime(env);
        const result = await provisionCommunityFn({
          ...runtime,
          communityId: requireText(body.community_id, "community_id"),
          creatorUserId: requireText(body.creator_user_id, "creator_user_id"),
          displayName: requireText(body.display_name, "display_name"),
          namespaceVerificationId: requireText(body.namespace_verification_id, "namespace_verification_id"),
          groupLocation: requireText(body.group_location, "group_location"),
          description: body.bootstrap_payload?.description ?? null,
          membershipMode: body.bootstrap_payload?.membership_mode ?? "open",
          defaultAgeGatePolicy: body.bootstrap_payload?.default_age_gate_policy ?? "none",
          membershipUniqueHumanProvider: body.bootstrap_payload?.membership_unique_human_provider ?? null,
          postingUniqueHumanProvider: body.bootstrap_payload?.posting_unique_human_provider ?? null,
          handlePolicyTemplate: body.bootstrap_payload?.handle_policy_template ?? "standard",
          handlePricingModel: body.bootstrap_payload?.handle_pricing_model ?? null,
          namespaceLabel: body.bootstrap_payload?.namespace_label ?? null,
          databaseTokenExpiration: trim(body.database_token_expiration ?? "") || null,
        });
        return json(mapProvisionResponse(result));
      }

      if (url.pathname === "/internal/v0/community-provisioning/rotate-token") {
        const body = await readJson<RotateRouteBody>(request);
        const runtime = requireOperatorRuntime(env);
        const result = await rotateCommunityTokenFn({
          controlPlaneDatabaseUrl: runtime.controlPlaneDatabaseUrl,
          controlPlaneAuthToken: runtime.controlPlaneAuthToken,
          tursoPlatformApiToken: runtime.tursoPlatformApiToken,
          tursoCommunityDbWrapKey: runtime.tursoCommunityDbWrapKey,
          tursoCommunityDbWrapKeyVersion: runtime.tursoCommunityDbWrapKeyVersion,
          communityId: requireText(body.community_id, "community_id"),
          reason: trim(body.reason ?? "") || null,
          databaseTokenExpiration: trim(body.database_token_expiration ?? "") || null,
        });
        return json(mapRotateResponse(result));
      }

      if (url.pathname === "/internal/v0/community-provisioning/doctor") {
        const body = await readJson<DoctorRouteBody>(request);
        const result = await doctorControlPlaneFn({
          controlPlaneDatabaseUrl: requireText(env.CONTROL_PLANE_DATABASE_URL, "CONTROL_PLANE_DATABASE_URL"),
          controlPlaneAuthToken: trim(env.TURSO_CONTROL_PLANE_AUTH_TOKEN) || null,
          communityId: trim(body.community_id ?? "") || null,
          tursoCommunityDbWrapKey: requireText(env.TURSO_COMMUNITY_DB_WRAP_KEY, "TURSO_COMMUNITY_DB_WRAP_KEY"),
        });
        return json(mapDoctorResponse(result));
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "operator request failed";
      const isValidationError = message.endsWith(" is required")
        || message.includes("must be valid JSON")
        || message.endsWith("must be a positive integer");
      console.error("[community-provision-operator]", request.method, url.pathname, message);
      return json(
        {
          error_code: isValidationError ? "invalid_request" : "community_provision_operator_failed",
          message,
        },
        { status: isValidationError ? 400 : 500 },
      );
    }
  };
}

export function resolveOperatorHost(env: TursoControlPlaneOperatorEnv): string {
  return trim(env.COMMUNITY_PROVISION_OPERATOR_HOST) || "127.0.0.1";
}

export function resolveOperatorPort(env: TursoControlPlaneOperatorEnv): number {
  const raw = trim(env.COMMUNITY_PROVISION_OPERATOR_PORT);
  if (!raw) {
    return 8789;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("COMMUNITY_PROVISION_OPERATOR_PORT must be a positive integer");
  }
  return parsed;
}
