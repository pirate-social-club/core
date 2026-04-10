import type {
  AuthBootstrapStore,
  AuthBootstrapTx,
  InsertNamespaceVerificationInput,
  InsertNamespaceVerificationSessionInput,
  InsertVerificationSessionInput,
  UpdateUserVerificationInput,
} from "./db";
import { createHash } from "node:crypto";
import { authError, badRequestError, conflictError, internalError, notFoundError, notImplementedError, verificationRequired } from "./errors";
import { createId } from "./ids";
import { inspectHnsNamespace } from "./hns-verification-provider";
import { verifyPirateAccessToken } from "./pirate-session-jwt";
import { nowIso } from "./time";
import { DEFAULT_VERIFICATION_CAPABILITIES, serializeVerificationCapabilities } from "./verification-serializer";
import type { Env } from "../types/env";
import type { NamespaceVerificationRow, NamespaceVerificationSessionRow, UserRow, VerificationSessionRow } from "../types/db";

type SelfSdkModule = {
  AllIds: unknown;
  DefaultConfigStore: new (config: { minimumAge?: number }) => unknown;
  SelfBackendVerifier: new (
    scope: string,
    callbackUrl: string,
    mockPassport: boolean,
    allIds: unknown,
    configStore: unknown,
    userIdType: string,
  ) => {
    verify: (
      attestationId: 1 | 2 | 3 | 4,
      proof: unknown,
      pubSignals: unknown[],
      userContextData: string,
    ) => Promise<{ attestationId: string | number }>;
  };
};

let selfSdkModulePromise: Promise<SelfSdkModule> | null = null;

type RequestedCapability = "unique_human" | "age_over_18" | "nationality" | "gender";

type StartVerificationRequestBody = {
  provider?: "self" | "very";
  requested_capabilities?: RequestedCapability[];
  verification_intent?:
    | "profile_verification"
    | "community_creation"
    | "post_access_18_plus"
    | "commerce_pricing"
    | "qualifier_disclosure"
    | null;
  policy_id?: string | null;
};

type CompleteVerificationRequestBody = {
  attestation_id?: string | null;
  proof_hash?: string | null;
  proof?: string | null;
};

type SelfCallbackRequestBody = {
  attestationId?: number | string | null;
  proof?: {
    a?: [string | number, string | number];
    b?: [[string | number, string | number], [string | number, string | number]];
    c?: [string | number, string | number];
  } | null;
  pubSignals?: Array<string | number> | null;
  publicSignals?: Array<string | number> | null;
  userContextData?: string | null;
};

type StartNamespaceVerificationRequestBody = {
  family?: "hns";
  root_label?: string;
};

type CompleteNamespaceVerificationRequestBody = {
  restart_challenge?: boolean | null;
};

function requireUser(row: UserRow | null): UserRow {
  if (!row) {
    throw authError();
  }
  return row;
}

function addMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60_000).toISOString();
}

function normalizeRootLabel(value: string): string {
  return value.trim().toLowerCase();
}

function buildNamespaceTxtChallenge(input: {
  namespaceVerificationSessionId: string;
  normalizedRootLabel: string;
  now: Date;
}) {
  return {
    challengeHost: `_pirate.${input.normalizedRootLabel}`,
    challengeTxtValue: `pirate-verify=${input.namespaceVerificationSessionId}.${createId("nonce")}`,
    challengeExpiresAt: addMinutes(input.now, 15),
  };
}

function getCapabilityState(user: UserRow, capability: "unique_human" | "age_over_18") {
  try {
    const parsed = JSON.parse(user.verification_capabilities_json) as Record<string, { state?: string }>;
    return parsed[capability]?.state ?? null;
  } catch {
    return null;
  }
}

function isCapabilityVerified(user: UserRow, capability: "unique_human" | "age_over_18") {
  return getCapabilityState(user, capability) === "verified";
}

function toDbBool(value: boolean | null): 0 | 1 | null {
  if (value == null) {
    return null;
  }
  return value ? 1 : 0;
}

function parseRequestedCapabilities(value: unknown): RequestedCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw authError("Verification request is invalid");
  }

  const allowed = new Set<RequestedCapability>(["unique_human", "age_over_18", "nationality", "gender"]);
  const requested = value.filter(
    (item): item is RequestedCapability => typeof item === "string" && allowed.has(item as RequestedCapability),
  );

  if (requested.length === 0) {
    throw authError("Verification request is invalid");
  }

  return requested;
}

function serializeVerificationSession(row: VerificationSessionRow) {
  const requestedCapabilities = JSON.parse(row.requested_capabilities_json) as RequestedCapability[];
  const isSelf = row.provider === "self";
  const selfCallbackUrl = isSelf && row.upstream_session_ref
    ? row.upstream_session_ref
    : `/verification-sessions/${row.verification_session_id}/callback`;

  return {
    verification_session_id: row.verification_session_id,
    user_id: row.user_id,
    provider: row.provider,
    provider_mode: isSelf ? "qr_deeplink" : "widget",
    requested_capabilities: requestedCapabilities,
    verification_intent: row.session_kind === "interactive" ? null : row.session_kind,
    policy_id: isSelf ? null : row.upstream_session_ref,
    status: row.status === "canceled" ? "failed" : row.status,
    launch: isSelf
      ? {
          mode: "qr_deeplink",
          self_app: {
            app_name: "Pirate",
            endpoint: selfCallbackUrl,
            endpoint_type: "https",
            scope: "pirate-verification-v0",
            session_id: row.verification_session_id,
            user_id: row.user_id,
            user_id_type: "hex",
            disclosures: {
              nationality: requestedCapabilities.includes("nationality"),
              minimum_age: requestedCapabilities.includes("age_over_18") ? 18 : null,
              gender: requestedCapabilities.includes("gender"),
            },
          },
        }
      : {
          mode: "widget",
          very_widget: {
            app_id: "pirate-app",
            context: row.verification_session_id,
            type_id: "palm-scan-v0",
            query: {
              conditions: [],
              options: {
                externalNullifier: "pirate-community-creation",
              },
            },
            verify_url: "https://verify.very.org/api/v1/verify",
          },
        },
    callback_path: isSelf ? selfCallbackUrl : `/verification-sessions/${row.verification_session_id}/callback`,
    attestation_id: row.result_ref,
    proof_hash: row.failure_code,
    verified_at: row.completed_at,
    failure_reason: row.status === "failed" ? row.failure_code : null,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

function serializeNamespaceVerificationSession(row: NamespaceVerificationSessionRow) {
  return {
    namespace_verification_session_id: row.namespace_verification_session_id,
    namespace_verification_id: row.namespace_verification_id,
    user_id: row.user_id,
    family: row.family,
    submitted_root_label: row.submitted_root_label,
    normalized_root_label: row.normalized_root_label,
    status: row.status,
    challenge_host: row.challenge_host,
    challenge_txt_value: row.challenge_txt_value,
    challenge_expires_at: row.challenge_expires_at,
    assertions: {
      root_exists: row.root_exists == null ? null : Boolean(row.root_exists),
      root_control_verified: row.root_control_verified == null ? null : Boolean(row.root_control_verified),
      expiry_horizon_sufficient: row.expiry_horizon_sufficient == null ? null : Boolean(row.expiry_horizon_sufficient),
      routing_enabled: row.routing_enabled == null ? null : Boolean(row.routing_enabled),
      pirate_dns_authority_verified: row.pirate_dns_authority_verified == null ? null : Boolean(row.pirate_dns_authority_verified),
    },
    capabilities: {
      club_attach_allowed: row.club_attach_allowed == null ? null : Boolean(row.club_attach_allowed),
      pirate_web_routing_allowed: row.pirate_web_routing_allowed == null ? null : Boolean(row.pirate_web_routing_allowed),
      pirate_subdomain_issuance_allowed: row.pirate_subdomain_issuance_allowed == null ? null : Boolean(row.pirate_subdomain_issuance_allowed),
    },
    control_class: row.control_class,
    operation_class: row.operation_class,
    observation_provider: row.observation_provider,
    evidence_bundle_ref: row.evidence_bundle_ref,
    failure_reason: row.failure_reason,
    accepted_at: row.accepted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

function buildUpdatedUserVerification(input: {
  user: UserRow;
  provider: "self" | "very";
  requestedCapabilities: RequestedCapability[];
  verificationSessionId: string;
  nowString: string;
}): UpdateUserVerificationInput {
  const capabilities = {
    ...DEFAULT_VERIFICATION_CAPABILITIES,
    ...serializeVerificationCapabilities(input.user.verification_capabilities_json),
  };

  if (input.requestedCapabilities.includes("unique_human")) {
    capabilities.unique_human = {
      state: "verified",
      provider: input.provider,
      proof_type: "unique_human",
      mechanism: input.provider === "self" ? "self-sdk" : "very-widget",
      verified_at: input.nowString,
    };
  }

  if (input.provider === "self" && input.requestedCapabilities.includes("age_over_18")) {
    capabilities.age_over_18 = {
      state: "verified",
      provider: "self",
      proof_type: "age_over_18",
      mechanism: "self-sdk",
      verified_at: input.nowString,
    };
  }

  if (input.provider === "self" && input.requestedCapabilities.includes("nationality")) {
    capabilities.nationality = {
      state: "verified",
      provider: "self",
      proof_type: "nationality",
      mechanism: "self-sdk",
      verified_at: input.nowString,
      value: null,
    };
  }

  if (input.provider === "self" && input.requestedCapabilities.includes("gender")) {
    capabilities.gender = {
      state: "verified",
      provider: "self",
      proof_type: "gender",
      mechanism: "self-sdk",
      verified_at: input.nowString,
      value: null,
    };
  }

  return {
    user_id: input.user.user_id,
    verification_state: capabilities.unique_human.state === "verified" ? "verified" : input.user.verification_state,
    capability_provider: input.requestedCapabilities.includes("unique_human") ? input.provider : input.user.capability_provider,
    verification_capabilities_json: JSON.stringify(capabilities),
    verified_at: capabilities.unique_human.state === "verified" ? input.nowString : input.user.verified_at,
    nationality: input.user.nationality,
    current_verification_session_id: input.verificationSessionId,
    updated_at: input.nowString,
  };
}

function getVeryWidgetConfig(env: Env) {
  return {
    appId: env.VERY_WIDGET_APP_ID?.trim() || "pirate-app",
    typeId: env.VERY_WIDGET_TYPE_ID?.trim() || "palm-scan-v0",
    externalNullifier: env.VERY_WIDGET_EXTERNAL_NULLIFIER?.trim() || "pirate-community-creation",
    verifyUrl: env.VERY_VERIFY_URL?.trim() || "https://verify.very.org/api/v1/verify",
  };
}

function getSelfVerificationConfig(env: Env) {
  return {
    scope: env.SELF_VERIFICATION_SCOPE?.trim() || "pirate-verification-v0",
    mockPassport: env.SELF_MOCK_PASSPORT === "true",
  };
}

function getPirateApiPublicOrigin(env: Env) {
  const origin = env.PIRATE_API_PUBLIC_ORIGIN?.trim();
  if (!origin) {
    throw internalError("PIRATE_API_PUBLIC_ORIGIN is required for Self verification");
  }

  return origin.replace(/\/+$/u, "");
}

function buildSelfUserIdentifierHex(userId: string) {
  return `0x${createHash("sha256").update(userId).digest("hex")}`;
}

function buildVerificationCallbackUrl(env: Env, verificationSessionId: string) {
  return `${getPirateApiPublicOrigin(env)}/verification-sessions/${verificationSessionId}/callback`;
}

function serializeVerificationSessionWithEnv(row: VerificationSessionRow, env: Env) {
  const serialized = serializeVerificationSession(row) as ReturnType<typeof serializeVerificationSession>;

  if (row.provider === "very" && serialized.launch.very_widget) {
    const config = getVeryWidgetConfig(env);
    serialized.launch.very_widget = {
      ...serialized.launch.very_widget,
      app_id: config.appId,
      type_id: config.typeId,
      query: {
        conditions: [],
        options: {
          externalNullifier: config.externalNullifier,
        },
      },
      verify_url: config.verifyUrl,
    };
  }

  if (row.provider === "self" && serialized.launch.self_app) {
    const config = getSelfVerificationConfig(env);
    serialized.launch.self_app = {
      ...serialized.launch.self_app,
      scope: config.scope,
      user_id: buildSelfUserIdentifierHex(row.user_id),
      user_id_type: "hex",
    };
  }

  return serialized;
}

async function verifyVeryProof(input: {
  proof: string;
  env: Env;
}): Promise<{ proofHash: string }> {
  const verifyUrl = getVeryWidgetConfig(input.env).verifyUrl;
  let response: Response;
  try {
    response = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        proof: input.proof,
      }),
    });
  } catch {
    throw internalError("Very proof verification failed");
  }

  let body: { status?: string } | null = null;
  try {
    body = await response.json() as { status?: string };
  } catch {
    body = null;
  }

  if (!response.ok || body?.status !== "valid") {
    throw verificationRequired("Very proof was not valid");
  }

  return {
    proofHash: createHash("sha256").update(input.proof).digest("hex"),
  };
}

function parseSelfCallbackRequestBody(value: CompleteVerificationRequestBody | SelfCallbackRequestBody) {
  const body = value as SelfCallbackRequestBody;
  const attestationIdRaw = body.attestationId;
  const attestationId = typeof attestationIdRaw === "number"
    ? attestationIdRaw
    : typeof attestationIdRaw === "string" && attestationIdRaw.trim() !== ""
      ? Number(attestationIdRaw)
      : NaN;
  const proof = body.proof;
  const pubSignals = Array.isArray(body.pubSignals)
    ? body.pubSignals
    : Array.isArray(body.publicSignals)
      ? body.publicSignals
      : null;
  const userContextData = typeof body.userContextData === "string" ? body.userContextData : null;

  if (!Number.isInteger(attestationId) || !proof || !Array.isArray(pubSignals) || !userContextData) {
    throw badRequestError("Self callback payload is invalid");
  }

  return {
    attestationId,
    proof,
    pubSignals,
    userContextData,
  };
}

async function loadSelfSdk(): Promise<SelfSdkModule> {
  if (!selfSdkModulePromise) {
    selfSdkModulePromise = import("../../../../../pirate-web/node_modules/@selfxyz/core/dist/index.js")
      .then((module) => module as SelfSdkModule)
      .catch(() => {
        selfSdkModulePromise = null;
        throw notImplementedError("Self verification backend is not installed in this runtime");
      });
  }

  return await selfSdkModulePromise;
}

async function verifySelfCallback(input: {
  row: VerificationSessionRow;
  requestBody: CompleteVerificationRequestBody | SelfCallbackRequestBody;
  env: Env;
}) {
  const parsed = parseSelfCallbackRequestBody(input.requestBody);
  const config = getSelfVerificationConfig(input.env);
  const { AllIds, DefaultConfigStore, SelfBackendVerifier } = await loadSelfSdk();
  const verifier = new SelfBackendVerifier(
    config.scope,
    input.row.upstream_session_ref ?? buildVerificationCallbackUrl(input.env, input.row.verification_session_id),
    config.mockPassport,
    AllIds,
    new DefaultConfigStore({
      minimumAge: JSON.parse(input.row.requested_capabilities_json).includes("age_over_18") ? 18 : undefined,
    }),
    "hex",
  );
  const verification = await verifier.verify(
    parsed.attestationId as 1 | 2 | 3 | 4,
    parsed.proof,
    parsed.pubSignals,
    parsed.userContextData,
  );

  return {
    attestationId: String(verification.attestationId),
    proofHash: createHash("sha256")
      .update(JSON.stringify({
        attestationId: parsed.attestationId,
        proof: parsed.proof,
        pubSignals: parsed.pubSignals,
        userContextData: parsed.userContextData,
      }))
      .digest("hex"),
  };
}

export async function startVerificationSession(input: {
  bearerToken: string;
  requestBody: StartVerificationRequestBody;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const session = await verifyPirateAccessToken(input.bearerToken, input.env);
  const user = requireUser(await input.store.getUser(session.userId));
  const provider = input.requestBody.provider;
  if (provider !== "self" && provider !== "very") {
    throw authError("Verification request is invalid");
  }

  const requestedCapabilities = parseRequestedCapabilities(input.requestBody.requested_capabilities);
  const nowString = nowIso(now);
  const verificationSessionId = createId("ver_sess");
  const row: InsertVerificationSessionInput = {
    verification_session_id: verificationSessionId,
    user_id: user.user_id,
    provider,
    session_kind: input.requestBody.verification_intent ?? "interactive",
    requested_capabilities_json: JSON.stringify(requestedCapabilities),
    status: "pending",
    upstream_session_ref: provider === "self"
      ? buildVerificationCallbackUrl(input.env, verificationSessionId)
      : input.requestBody.policy_id ?? null,
    result_ref: null,
    failure_code: null,
    started_at: nowString,
    completed_at: null,
    expires_at: addMinutes(now, 15),
    created_at: nowString,
    updated_at: nowString,
  };

  await input.store.withTransaction(async (tx) => {
    await tx.insertVerificationSession(row);

    const capabilities = serializeVerificationCapabilities(user.verification_capabilities_json);
    if (requestedCapabilities.includes("unique_human")) {
      capabilities.unique_human = {
        state: "pending",
        provider,
        proof_type: "unique_human",
        mechanism: provider === "self" ? "self-sdk" : "very-widget",
        verified_at: null,
      };
    }

    await tx.updateUserVerification({
      user_id: user.user_id,
      verification_state: requestedCapabilities.includes("unique_human") ? "pending" : user.verification_state,
      capability_provider: requestedCapabilities.includes("unique_human") ? provider : user.capability_provider,
      verification_capabilities_json: JSON.stringify(capabilities),
      verified_at: user.verified_at,
      nationality: user.nationality,
      current_verification_session_id: row.verification_session_id,
      updated_at: nowString,
    });
  });

  return serializeVerificationSessionWithEnv(row as VerificationSessionRow, input.env);
}

export async function getVerificationSession(input: {
  bearerToken: string;
  verificationSessionId: string;
  env: Env;
  store: AuthBootstrapStore;
}) {
  const session = await verifyPirateAccessToken(input.bearerToken, input.env);
  const row = await input.store.getVerificationSessionById(input.verificationSessionId);
  if (!row || row.user_id !== session.userId) {
    throw notFoundError("Verification session not found");
  }

  return serializeVerificationSessionWithEnv(row, input.env);
}

export async function completeVerificationSession(input: {
  bearerToken: string;
  verificationSessionId: string;
  requestBody: CompleteVerificationRequestBody;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowString = nowIso(now);
  const session = await verifyPirateAccessToken(input.bearerToken, input.env);
  const row = await input.store.getVerificationSessionById(input.verificationSessionId);
  if (!row || row.user_id !== session.userId) {
    throw notFoundError("Verification session not found");
  }
  if (row.provider !== "very") {
    throw notImplementedError("This verification provider cannot be completed from the browser in the reference runtime");
  }
  if (row.status === "verified") {
    return serializeVerificationSessionWithEnv(row, input.env);
  }
  if (row.status !== "pending") {
    throw conflictError("Verification session is not pending");
  }
  if (typeof input.requestBody.proof !== "string" || input.requestBody.proof.trim() === "") {
    throw badRequestError("Verification proof is required");
  }

  const user = requireUser(await input.store.getUser(session.userId));
  const requestedCapabilities = JSON.parse(row.requested_capabilities_json) as RequestedCapability[];
  const veryProof = await verifyVeryProof({
    proof: input.requestBody.proof,
    env: input.env,
  });
  const updatedRow: InsertVerificationSessionInput = {
    verification_session_id: row.verification_session_id,
    user_id: row.user_id,
    provider: row.provider,
    session_kind: row.session_kind,
    requested_capabilities_json: row.requested_capabilities_json,
    status: "verified",
    upstream_session_ref: row.upstream_session_ref,
    result_ref: input.requestBody.attestation_id ?? createId("att"),
    failure_code: input.requestBody.proof_hash ?? veryProof.proofHash,
    started_at: row.started_at,
    completed_at: nowString,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: nowString,
  };

  await input.store.withTransaction(async (tx) => {
    await tx.updateVerificationSession(updatedRow);
    await tx.updateUserVerification(
      buildUpdatedUserVerification({
        user,
        provider: row.provider,
        requestedCapabilities,
        verificationSessionId: row.verification_session_id,
        nowString,
      }),
    );
  });

  return serializeVerificationSessionWithEnv(updatedRow as VerificationSessionRow, input.env);
}

export async function completeVerificationSessionByCallback(input: {
  verificationSessionId: string;
  requestBody: CompleteVerificationRequestBody;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowString = nowIso(now);
  const row = await input.store.getVerificationSessionById(input.verificationSessionId);
  if (!row) {
    throw notFoundError("Verification session not found");
  }
  if (row.provider !== "self") {
    throw notImplementedError(`Secure ${row.provider} callback verification is not implemented in the reference runtime`);
  }
  if (row.status === "verified") {
    return serializeVerificationSessionWithEnv(row, input.env);
  }
  if (row.status !== "pending") {
    throw conflictError("Verification session is not pending");
  }

  const user = requireUser(await input.store.getUser(row.user_id));
  const requestedCapabilities = JSON.parse(row.requested_capabilities_json) as RequestedCapability[];
  const selfVerification = await verifySelfCallback({
    row,
    requestBody: input.requestBody,
    env: input.env,
  });
  const updatedRow: InsertVerificationSessionInput = {
    verification_session_id: row.verification_session_id,
    user_id: row.user_id,
    provider: row.provider,
    session_kind: row.session_kind,
    requested_capabilities_json: row.requested_capabilities_json,
    status: "verified",
    upstream_session_ref: row.upstream_session_ref,
    result_ref: input.requestBody.attestation_id ?? selfVerification.attestationId,
    failure_code: input.requestBody.proof_hash ?? selfVerification.proofHash,
    started_at: row.started_at,
    completed_at: nowString,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: nowString,
  };

  await input.store.withTransaction(async (tx) => {
    await tx.updateVerificationSession(updatedRow);
    await tx.updateUserVerification(
      buildUpdatedUserVerification({
        user,
        provider: row.provider,
        requestedCapabilities,
        verificationSessionId: row.verification_session_id,
        nowString,
      }),
    );
  });

  return serializeVerificationSessionWithEnv(updatedRow as VerificationSessionRow, input.env);
}

export async function startNamespaceVerificationSession(input: {
  bearerToken: string;
  requestBody: StartNamespaceVerificationRequestBody;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const session = await verifyPirateAccessToken(input.bearerToken, input.env);
  if (input.requestBody.family !== "hns" || typeof input.requestBody.root_label !== "string" || input.requestBody.root_label.trim() === "") {
    throw authError("Namespace verification request is invalid");
  }

  const normalizedRootLabel = normalizeRootLabel(input.requestBody.root_label);
  const nowString = nowIso(now);
  const namespaceVerificationSessionId = createId("nvs");
  const inspection = await inspectHnsNamespace({
    env: input.env,
    normalizedRootLabel,
  });
  const challenge = inspection.rootExists && inspection.authoritativeDnsReady
    ? buildNamespaceTxtChallenge({
        namespaceVerificationSessionId,
        normalizedRootLabel,
        now,
      })
    : null;
  const initialStatus: NamespaceVerificationSessionRow["status"] = !inspection.rootExists
    ? "failed"
    : inspection.authoritativeDnsReady
      ? "challenge_pending"
      : "dns_setup_required";
  const row: InsertNamespaceVerificationSessionInput = {
    namespace_verification_session_id: namespaceVerificationSessionId,
    namespace_verification_id: null,
    user_id: session.userId,
    family: "hns",
    submitted_root_label: input.requestBody.root_label,
    normalized_root_label: normalizedRootLabel,
    status: initialStatus,
    challenge_host: challenge?.challengeHost ?? null,
    challenge_txt_value: challenge?.challengeTxtValue ?? null,
    challenge_expires_at: challenge?.challengeExpiresAt ?? null,
    root_exists: toDbBool(inspection.rootExists),
    root_control_verified: 0,
    expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient),
    routing_enabled: toDbBool(inspection.routingEnabled),
    pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
    club_attach_allowed: null,
    pirate_web_routing_allowed: null,
    pirate_subdomain_issuance_allowed: null,
    control_class: inspection.controlClass,
    operation_class: inspection.operationClass,
    observation_provider: inspection.observationProvider,
    evidence_bundle_ref: inspection.evidenceBundleRef,
    failure_reason: !inspection.rootExists
      ? inspection.failureReason ?? "root_not_found"
      : !inspection.authoritativeDnsReady
        ? inspection.failureReason ?? "authoritative_dns_required"
        : null,
    accepted_at: null,
    expires_at: addDays(now, 7),
    created_at: nowString,
    updated_at: nowString,
  };

  await input.store.withTransaction(async (tx) => {
    await tx.insertNamespaceVerificationSession(row);
  });

  return serializeNamespaceVerificationSession(row as NamespaceVerificationSessionRow);
}

export async function getNamespaceVerificationSession(input: {
  bearerToken: string;
  namespaceVerificationSessionId: string;
  env: Env;
  store: AuthBootstrapStore;
}) {
  const session = await verifyPirateAccessToken(input.bearerToken, input.env);
  const row = await input.store.getNamespaceVerificationSessionById(input.namespaceVerificationSessionId);
  if (!row || row.user_id !== session.userId) {
    throw notFoundError("Namespace verification session not found");
  }

  return serializeNamespaceVerificationSession(row);
}

async function ensureNamespaceVerification(tx: AuthBootstrapTx, input: {
  sessionRow: NamespaceVerificationSessionRow;
  nowString: string;
}): Promise<string> {
  if (input.sessionRow.namespace_verification_id) {
    return input.sessionRow.namespace_verification_id;
  }

  const namespaceVerificationId = createId("nv");
  const verificationRow: InsertNamespaceVerificationInput = {
    namespace_verification_id: namespaceVerificationId,
    source_namespace_verification_session_id: input.sessionRow.namespace_verification_session_id,
    user_id: input.sessionRow.user_id,
    family: "hns",
    normalized_root_label: input.sessionRow.normalized_root_label ?? normalizeRootLabel(input.sessionRow.submitted_root_label),
    status: "verified",
    root_exists: input.sessionRow.root_exists ?? 1,
    root_control_verified: input.sessionRow.root_control_verified ?? 1,
    expiry_horizon_sufficient: input.sessionRow.expiry_horizon_sufficient ?? 1,
    routing_enabled: input.sessionRow.routing_enabled ?? 0,
    pirate_dns_authority_verified: input.sessionRow.pirate_dns_authority_verified ?? 0,
    club_attach_allowed: input.sessionRow.club_attach_allowed ?? 1,
    pirate_web_routing_allowed: input.sessionRow.pirate_web_routing_allowed ?? 0,
    pirate_subdomain_issuance_allowed: input.sessionRow.pirate_subdomain_issuance_allowed ?? 0,
    control_class: input.sessionRow.control_class ?? "single_holder_root",
    operation_class: input.sessionRow.operation_class ?? "owner_managed_namespace",
    observation_provider: input.sessionRow.observation_provider,
    evidence_bundle_ref: input.sessionRow.evidence_bundle_ref,
    accepted_at: input.nowString,
    expires_at: addDays(new Date(input.nowString), 365),
    created_at: input.nowString,
    updated_at: input.nowString,
  };

  await tx.insertNamespaceVerification(verificationRow);
  return namespaceVerificationId;
}

export async function completeNamespaceVerificationSession(input: {
  bearerToken: string;
  namespaceVerificationSessionId: string;
  requestBody: CompleteNamespaceVerificationRequestBody;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowString = nowIso(now);
  const session = await verifyPirateAccessToken(input.bearerToken, input.env);
  const row = await input.store.getNamespaceVerificationSessionById(input.namespaceVerificationSessionId);
  if (!row || row.user_id !== session.userId) {
    throw notFoundError("Namespace verification session not found");
  }
  if (row.status === "verified") {
    return serializeNamespaceVerificationSession(row);
  }

  const normalizedRootLabel = row.normalized_root_label ?? normalizeRootLabel(row.submitted_root_label);
  const user = requireUser(await input.store.getUser(session.userId));
  const restartChallenge = input.requestBody.restart_challenge === true;

  const updatedRow = await input.store.withTransaction(async (tx) => {
    if (row.status === "dns_setup_required" || row.status === "draft" || row.status === "inspecting" || row.status === "challenge_required" || restartChallenge) {
      const inspection = await inspectHnsNamespace({
        env: input.env,
        normalizedRootLabel,
      });
      const challenge = inspection.rootExists && inspection.authoritativeDnsReady
        ? buildNamespaceTxtChallenge({
            namespaceVerificationSessionId: row.namespace_verification_session_id,
            normalizedRootLabel,
            now,
          })
        : null;
      const nextStatus: NamespaceVerificationSessionRow["status"] = !inspection.rootExists
        ? "failed"
        : inspection.authoritativeDnsReady
          ? "challenge_pending"
          : "dns_setup_required";
      const nextRow: InsertNamespaceVerificationSessionInput = {
        namespace_verification_session_id: row.namespace_verification_session_id,
        namespace_verification_id: row.namespace_verification_id,
        user_id: row.user_id,
        family: row.family,
        submitted_root_label: row.submitted_root_label,
        normalized_root_label: normalizedRootLabel,
        status: nextStatus,
        challenge_host: challenge?.challengeHost ?? null,
        challenge_txt_value: challenge?.challengeTxtValue ?? null,
        challenge_expires_at: challenge?.challengeExpiresAt ?? null,
        root_exists: toDbBool(inspection.rootExists),
        root_control_verified: 0,
        expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient),
        routing_enabled: toDbBool(inspection.routingEnabled),
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
        club_attach_allowed: null,
        pirate_web_routing_allowed: null,
        pirate_subdomain_issuance_allowed: null,
        control_class: inspection.controlClass ?? row.control_class ?? "single_holder_root",
        operation_class: inspection.operationClass ?? row.operation_class ?? "owner_managed_namespace",
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
        failure_reason: !inspection.rootExists
          ? inspection.failureReason ?? "root_not_found"
          : !inspection.authoritativeDnsReady
            ? inspection.failureReason ?? "authoritative_dns_required"
            : null,
        accepted_at: null,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: nowString,
      };

      await tx.updateNamespaceVerificationSession(nextRow);
      return nextRow;
    }

    if (row.status !== "challenge_pending") {
      throw conflictError("Namespace verification session is not ready for TXT observation");
    }
    if (!row.challenge_host || !row.challenge_txt_value) {
      throw conflictError("Namespace verification challenge is not currently issued");
    }

    const inspection = await inspectHnsNamespace({
      env: input.env,
      normalizedRootLabel,
      challengeHost: row.challenge_host,
      challengeTxtValue: row.challenge_txt_value,
    });

    if (!inspection.rootExists) {
      const nextRow: InsertNamespaceVerificationSessionInput = {
        namespace_verification_session_id: row.namespace_verification_session_id,
        namespace_verification_id: row.namespace_verification_id,
        user_id: row.user_id,
        family: row.family,
        submitted_root_label: row.submitted_root_label,
        normalized_root_label: normalizedRootLabel,
        status: "failed",
        challenge_host: row.challenge_host,
        challenge_txt_value: row.challenge_txt_value,
        challenge_expires_at: row.challenge_expires_at,
        root_exists: 0,
        root_control_verified: 0,
        expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient),
        routing_enabled: toDbBool(inspection.routingEnabled),
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
        club_attach_allowed: 0,
        pirate_web_routing_allowed: 0,
        pirate_subdomain_issuance_allowed: 0,
        control_class: inspection.controlClass ?? row.control_class,
        operation_class: inspection.operationClass ?? row.operation_class,
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
        failure_reason: inspection.failureReason ?? "root_not_found",
        accepted_at: null,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: nowString,
      };
      await tx.updateNamespaceVerificationSession(nextRow);
      return nextRow;
    }

    if (!inspection.authoritativeDnsReady) {
      const nextRow: InsertNamespaceVerificationSessionInput = {
        namespace_verification_session_id: row.namespace_verification_session_id,
        namespace_verification_id: row.namespace_verification_id,
        user_id: row.user_id,
        family: row.family,
        submitted_root_label: row.submitted_root_label,
        normalized_root_label: normalizedRootLabel,
        status: "dns_setup_required",
        challenge_host: null,
        challenge_txt_value: null,
        challenge_expires_at: null,
        root_exists: 1,
        root_control_verified: 0,
        expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient),
        routing_enabled: toDbBool(inspection.routingEnabled),
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
        club_attach_allowed: null,
        pirate_web_routing_allowed: null,
        pirate_subdomain_issuance_allowed: null,
        control_class: inspection.controlClass ?? row.control_class,
        operation_class: inspection.operationClass ?? row.operation_class,
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
        failure_reason: inspection.failureReason ?? "authoritative_dns_required",
        accepted_at: null,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: nowString,
      };
      await tx.updateNamespaceVerificationSession(nextRow);
      return nextRow;
    }

    if (inspection.challengePresent !== true) {
      const nextRow: InsertNamespaceVerificationSessionInput = {
        namespace_verification_session_id: row.namespace_verification_session_id,
        namespace_verification_id: row.namespace_verification_id,
        user_id: row.user_id,
        family: row.family,
        submitted_root_label: row.submitted_root_label,
        normalized_root_label: normalizedRootLabel,
        status: "challenge_pending",
        challenge_host: row.challenge_host,
        challenge_txt_value: row.challenge_txt_value,
        challenge_expires_at: row.challenge_expires_at,
        root_exists: 1,
        root_control_verified: 0,
        expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient),
        routing_enabled: toDbBool(inspection.routingEnabled),
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
        club_attach_allowed: null,
        pirate_web_routing_allowed: null,
        pirate_subdomain_issuance_allowed: null,
        control_class: inspection.controlClass ?? row.control_class,
        operation_class: inspection.operationClass ?? row.operation_class,
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
        failure_reason: inspection.failureReason ?? "challenge_not_published",
        accepted_at: null,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: nowString,
      };
      await tx.updateNamespaceVerificationSession(nextRow);
      return nextRow;
    }

    if (inspection.challengeMatches !== true) {
      const nextRow: InsertNamespaceVerificationSessionInput = {
        namespace_verification_session_id: row.namespace_verification_session_id,
        namespace_verification_id: row.namespace_verification_id,
        user_id: row.user_id,
        family: row.family,
        submitted_root_label: row.submitted_root_label,
        normalized_root_label: normalizedRootLabel,
        status: "challenge_pending",
        challenge_host: row.challenge_host,
        challenge_txt_value: row.challenge_txt_value,
        challenge_expires_at: row.challenge_expires_at,
        root_exists: 1,
        root_control_verified: 0,
        expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient),
        routing_enabled: toDbBool(inspection.routingEnabled),
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
        club_attach_allowed: null,
        pirate_web_routing_allowed: null,
        pirate_subdomain_issuance_allowed: null,
        control_class: inspection.controlClass ?? row.control_class,
        operation_class: inspection.operationClass ?? row.operation_class,
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
        failure_reason: inspection.failureReason ?? "challenge_mismatch",
        accepted_at: null,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: nowString,
      };
      await tx.updateNamespaceVerificationSession(nextRow);
      return nextRow;
    }

    if (!isCapabilityVerified(user, "unique_human")) {
      const nextRow: InsertNamespaceVerificationSessionInput = {
        namespace_verification_session_id: row.namespace_verification_session_id,
        namespace_verification_id: row.namespace_verification_id,
        user_id: row.user_id,
        family: row.family,
        submitted_root_label: row.submitted_root_label,
        normalized_root_label: normalizedRootLabel,
        status: "failed",
        challenge_host: row.challenge_host,
        challenge_txt_value: row.challenge_txt_value,
        challenge_expires_at: row.challenge_expires_at,
        root_exists: 1,
        root_control_verified: 1,
        expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient),
        routing_enabled: toDbBool(inspection.routingEnabled),
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
        club_attach_allowed: 0,
        pirate_web_routing_allowed: 0,
        pirate_subdomain_issuance_allowed: 0,
        control_class: inspection.controlClass ?? row.control_class,
        operation_class: inspection.operationClass ?? row.operation_class,
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
        failure_reason: "creator_not_unique_human_verified",
        accepted_at: null,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: nowString,
      };
      await tx.updateNamespaceVerificationSession(nextRow);
      return nextRow;
    }

    if (!inspection.expiryHorizonSufficient) {
      const nextRow: InsertNamespaceVerificationSessionInput = {
        namespace_verification_session_id: row.namespace_verification_session_id,
        namespace_verification_id: row.namespace_verification_id,
        user_id: row.user_id,
        family: row.family,
        submitted_root_label: row.submitted_root_label,
        normalized_root_label: normalizedRootLabel,
        status: "failed",
        challenge_host: row.challenge_host,
        challenge_txt_value: row.challenge_txt_value,
        challenge_expires_at: row.challenge_expires_at,
        root_exists: 1,
        root_control_verified: 1,
        expiry_horizon_sufficient: 0,
        routing_enabled: toDbBool(inspection.routingEnabled),
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified),
        club_attach_allowed: 0,
        pirate_web_routing_allowed: 0,
        pirate_subdomain_issuance_allowed: 0,
        control_class: inspection.controlClass ?? row.control_class,
        operation_class: inspection.operationClass ?? row.operation_class,
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
        failure_reason: inspection.failureReason ?? "expiry_horizon_insufficient",
        accepted_at: null,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: nowString,
      };
      await tx.updateNamespaceVerificationSession(nextRow);
      return nextRow;
    }

    const namespaceVerificationId = await ensureNamespaceVerification(tx, {
      sessionRow: {
        ...row,
        normalized_root_label: normalizedRootLabel,
        root_exists: 1,
        root_control_verified: 1,
        expiry_horizon_sufficient: toDbBool(inspection.expiryHorizonSufficient) ?? 1,
        routing_enabled: toDbBool(inspection.routingEnabled) ?? 0,
        pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified) ?? 0,
        club_attach_allowed: 1,
        pirate_web_routing_allowed: inspection.routingEnabled ? 1 : 0,
        pirate_subdomain_issuance_allowed: inspection.pirateDnsAuthorityVerified ? 1 : 0,
        control_class: inspection.controlClass ?? row.control_class ?? "single_holder_root",
        operation_class: inspection.operationClass ?? row.operation_class ?? "owner_managed_namespace",
        observation_provider: inspection.observationProvider,
        evidence_bundle_ref: inspection.evidenceBundleRef,
      },
      nowString,
    });

    const nextRow: InsertNamespaceVerificationSessionInput = {
      namespace_verification_session_id: row.namespace_verification_session_id,
      namespace_verification_id: namespaceVerificationId,
      user_id: row.user_id,
      family: row.family,
      submitted_root_label: row.submitted_root_label,
      normalized_root_label: normalizedRootLabel,
      status: "verified",
      challenge_host: row.challenge_host,
      challenge_txt_value: row.challenge_txt_value,
      challenge_expires_at: row.challenge_expires_at,
      root_exists: 1,
      root_control_verified: 1,
      expiry_horizon_sufficient: 1,
      routing_enabled: toDbBool(inspection.routingEnabled) ?? 0,
      pirate_dns_authority_verified: toDbBool(inspection.pirateDnsAuthorityVerified) ?? 0,
      club_attach_allowed: 1,
      pirate_web_routing_allowed: inspection.routingEnabled ? 1 : 0,
      pirate_subdomain_issuance_allowed: inspection.pirateDnsAuthorityVerified ? 1 : 0,
      control_class: inspection.controlClass ?? row.control_class ?? "single_holder_root",
      operation_class: inspection.operationClass ?? row.operation_class ?? "owner_managed_namespace",
      observation_provider: inspection.observationProvider,
      evidence_bundle_ref: inspection.evidenceBundleRef,
      failure_reason: null,
      accepted_at: nowString,
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: nowString,
    };

    await tx.updateNamespaceVerificationSession(nextRow);
    return nextRow;
  });

  return serializeNamespaceVerificationSession(updatedRow as NamespaceVerificationSessionRow);
}
