#!/usr/bin/env bun

import { $ } from "bun";
import { createHmac, randomUUID } from "node:crypto";

type Options = {
  apiUrl: string;
  rootLabel: string;
  displayName: string;
  description: string | null;
  databaseRegion: string;
  publisherSsh: string;
  publisherBin: string;
  walletExport: string;
  issuer: string;
  audience: string;
  subject: string;
};

type SessionExchangeResponse = {
  access_token?: string;
  user?: { user_id?: string };
};

type NamespaceSession = {
  namespace_verification_session_id?: string;
  namespace_verification_id?: string | null;
  status?: string;
  normalized_root_label?: string | null;
  challenge_payload?: {
    txt_key?: string;
    txt_value?: string;
    web_url?: string;
    freedom_url?: string;
  } | null;
  failure_reason?: string | null;
};

type CommunityCreateResponse = {
  community?: {
    community_id?: string;
    display_name?: string;
    route_slug?: string | null;
    namespace_verification_id?: string | null;
    provisioning_state?: string;
    status?: string;
  };
  job?: {
    job_id?: string;
    status?: string;
    error_code?: string | null;
  };
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  rtk infisical run --env prod --path /services/api -- \\
    rtk bun scripts/community/create-prod-spaces-community.ts \\
      --root-label xn--t77hga \\
      --display-name '🇵🇸'

Environment:
  AUTH_UPSTREAM_JWT_SHARED_SECRET  Required.
  CONTROL_PLANE_DATABASE_URL       Required.

Options:
  --api-url URL                    Default: https://api.pirate.sc
  --root-label LABEL               Spaces root label, canonical ASCII preferred.
  --display-name TEXT              Community display name.
  --description TEXT               Optional community description.
  --database-region REGION         Default: aws-us-east-1
  --publisher-ssh HOST             Default: root@verifier.pirate.sc
  --publisher-bin PATH             Default: /srv/pirate-spaces/bin/spaces-publisher
  --wallet-export PATH             Default: /srv/pirate-spaces/data/spaced/mainnet/wallets/default/wallet.json
  --issuer ISSUER                  Default: pirate-production-upstream
  --audience AUDIENCE              Default: api-core
  --subject SUBJECT                Default: launch-owner-palestine-space-20260429
  -h, --help                       Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiUrl: "https://api.pirate.sc",
    rootLabel: "",
    displayName: "",
    description: null,
    databaseRegion: "aws-us-east-1",
    publisherSsh: "root@verifier.pirate.sc",
    publisherBin: "/srv/pirate-spaces/bin/spaces-publisher",
    walletExport: "/srv/pirate-spaces/data/spaced/mainnet/wallets/default/wallet.json",
    issuer: "pirate-production-upstream",
    audience: "api-core",
    subject: "launch-owner-palestine-space-20260429",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1] ?? "";
    switch (arg) {
      case "--api-url":
        options.apiUrl = value;
        index += 2;
        break;
      case "--root-label":
        options.rootLabel = canonicalSpacesRoot(value);
        index += 2;
        break;
      case "--display-name":
        options.displayName = value.trim();
        index += 2;
        break;
      case "--description":
        options.description = value.trim() || null;
        index += 2;
        break;
      case "--database-region":
        options.databaseRegion = value.trim() || options.databaseRegion;
        index += 2;
        break;
      case "--publisher-ssh":
        options.publisherSsh = value.trim() || options.publisherSsh;
        index += 2;
        break;
      case "--publisher-bin":
        options.publisherBin = value.trim() || options.publisherBin;
        index += 2;
        break;
      case "--wallet-export":
        options.walletExport = value.trim() || options.walletExport;
        index += 2;
        break;
      case "--issuer":
        options.issuer = value.trim() || options.issuer;
        index += 2;
        break;
      case "--audience":
        options.audience = value.trim() || options.audience;
        index += 2;
        break;
      case "--subject":
        options.subject = value.trim() || options.subject;
        index += 2;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.rootLabel || !options.displayName) {
    usage();
  }

  return options;
}

function canonicalSpacesRoot(value: string): string {
  const label = value.trim().normalize("NFKC").toLowerCase().replace(/^@/u, "");
  if (!label || label.includes(".")) {
    throw new Error(`invalid Spaces root label: ${value}`);
  }
  const hostname = new URL(`http://${label}.invalid`).hostname;
  const canonical = hostname.slice(0, -".invalid".length);
  if (!canonical || canonical.includes(".")) {
    throw new Error(`invalid Spaces root label: ${value}`);
  }
  return canonical;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer
    .from(JSON.stringify(value))
    .toString("base64url");
}

function signHs256Jwt(input: {
  issuer: string;
  audience: string;
  subject: string;
  sharedSecret: string;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: input.issuer,
    aud: input.audience,
    sub: input.subject,
    iat: nowSeconds,
    exp: nowSeconds + 600,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", input.sharedSecret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function buildDefaultCapabilities(now: string) {
  return {
    unique_human: {
      state: "verified",
      provider: "self",
      proof_type: "unique_human",
      mechanism: "prod_launch_bootstrap",
      verified_at: now,
    },
    age_over_18: { state: "unverified", provider: null, proof_type: null, mechanism: null, verified_at: null },
    minimum_age: { state: "unverified", value: null, provider: null, proof_type: null, mechanism: null, verified_at: null },
    nationality: { state: "unverified", value: null, provider: null, proof_type: null, mechanism: null, verified_at: null },
    gender: { state: "unverified", value: null, provider: null, proof_type: null, mechanism: null, verified_at: null },
    wallet_score: {
      state: "unverified",
      provider: null,
      proof_type: null,
      mechanism: null,
      verified_at: null,
      score: null,
      score_threshold: null,
      passing_score: null,
      last_score_timestamp: null,
      expiration_timestamp: null,
      stamps: null,
    },
  };
}

async function apiRequest<T>(input: {
  apiUrl: string;
  path: string;
  method: "GET" | "POST";
  accessToken?: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/u, "")}${input.path}`, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API request failed: ${input.method} ${input.path} status=${response.status} body=${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

async function exchangeLaunchOwner(options: Options): Promise<{ userId: string; accessToken: string }> {
  const sharedSecret = requireEnv("AUTH_UPSTREAM_JWT_SHARED_SECRET");
  const jwt = signHs256Jwt({
    issuer: options.issuer,
    audience: options.audience,
    subject: options.subject,
    sharedSecret,
  });

  const response = await apiRequest<SessionExchangeResponse>({
    apiUrl: options.apiUrl,
    path: "/auth/session/exchange",
    method: "POST",
    body: {
      proof: {
        type: "jwt_based_auth",
        jwt,
      },
    },
  });
  const userId = response.user?.user_id?.trim();
  const accessToken = response.access_token?.trim();
  if (!userId || !accessToken) {
    throw new Error("session exchange did not return user_id and access_token");
  }
  return { userId, accessToken };
}

async function markLaunchOwnerVerified(input: {
  db: Bun.SQL;
  userId: string;
  subject: string;
}): Promise<{ verificationSessionId: string | null; attestationId: string | null; auditEventId: string | null; reused: boolean }> {
  const now = new Date().toISOString();
  const verificationSessionId = makeId("vs");
  const attestationId = makeId("uat");
  const auditEventId = makeId("aud");
  const capabilities = buildDefaultCapabilities(now);

  const existingRows = await input.db<{
    verification_state: string;
    verification_capabilities_json: unknown;
    current_verification_session_id: string | null;
  }[]>`
    SELECT verification_state, verification_capabilities_json, current_verification_session_id
    FROM users
    WHERE user_id = ${input.userId}
    LIMIT 1
  `;
  const existing = existingRows[0];
  if (!existing) {
    throw new Error(`launch owner user does not exist: ${input.userId}`);
  }
  const existingCaps = typeof existing.verification_capabilities_json === "string"
    ? JSON.parse(existing.verification_capabilities_json) as { unique_human?: { state?: string } }
    : existing.verification_capabilities_json as { unique_human?: { state?: string } };
  if (existing.verification_state === "verified" && existingCaps?.unique_human?.state === "verified") {
    return {
      verificationSessionId: existing.current_verification_session_id,
      attestationId: null,
      auditEventId: null,
      reused: true,
    };
  }

  await input.db.begin(async (tx) => {
    await tx`
      INSERT INTO verification_sessions (
        verification_session_id, user_id, provider, session_kind, requested_capabilities_json,
        verification_requirements_json, status, upstream_session_ref, result_ref, failure_code,
        wallet_attachment_id, verification_intent, policy_id, started_at, completed_at, expires_at,
        created_at, updated_at
      ) VALUES (
        ${verificationSessionId}, ${input.userId}, 'self', 'prod_launch_bootstrap',
        ${JSON.stringify(["unique_human"])}, ${JSON.stringify([])}, 'verified',
        ${`prod-launch:${input.subject}`}, ${JSON.stringify({ reason: "initial_prod_space_launch" })},
        NULL, NULL, 'community_launch', NULL, ${now}, ${now}, NULL, ${now}, ${now}
      )
      ON CONFLICT (verification_session_id) DO NOTHING
    `;

    await tx`
      INSERT INTO user_attestations (
        user_attestation_id, user_id, source_verification_session_id, provider, attestation_type,
        capability_key, status, value_json, verified_at, expires_at, revoked_at, created_at, updated_at
      ) VALUES (
        ${attestationId}, ${input.userId}, ${verificationSessionId}, 'self', 'unique_human',
        'unique_human', 'accepted', ${JSON.stringify({ mechanism: "prod_launch_bootstrap" })},
        ${now}, NULL, NULL, ${now}, ${now}
      )
      ON CONFLICT (user_attestation_id) DO NOTHING
    `;

    await tx`
      UPDATE users
      SET verification_state = 'verified',
          capability_provider = 'self',
          verification_capabilities_json = ${JSON.stringify(capabilities)},
          verified_at = ${now},
          current_verification_session_id = ${verificationSessionId},
          updated_at = ${now}
      WHERE user_id = ${input.userId}
    `;

    await tx`
      INSERT INTO audit_log (
        audit_event_id, actor_type, actor_id, action, target_type, target_id,
        community_id, metadata_json, created_at
      ) VALUES (
        ${auditEventId}, 'operator', 'prod-launch-script', 'user.unique_human_bootstrap',
        'user', ${input.userId}, NULL,
        ${JSON.stringify({ subject: input.subject, verification_session_id: verificationSessionId })},
        ${now}
      )
    `;
  });

  return { verificationSessionId, attestationId, auditEventId, reused: false };
}

async function findVerifiedNamespace(input: {
  db: Bun.SQL;
  userId: string;
  rootLabel: string;
}): Promise<string | null> {
  const rows = await input.db<{ namespace_verification_id: string }[]>`
    SELECT namespace_verification_id
    FROM namespace_verifications
    WHERE user_id = ${input.userId}
      AND family = 'spaces'
      AND normalized_root_label = ${input.rootLabel}
      AND status = 'verified'
    ORDER BY accepted_at DESC
    LIMIT 1
  `;
  return rows[0]?.namespace_verification_id ?? null;
}

async function findReusableNamespaceSession(input: {
  db: Bun.SQL;
  userId: string;
  rootLabel: string;
}): Promise<NamespaceSession | null> {
  const rows = await input.db<{
    namespace_verification_session_id: string;
    namespace_verification_id: string | null;
    status: string;
    normalized_root_label: string | null;
    challenge_payload_json: unknown;
    failure_reason: string | null;
  }[]>`
    SELECT
      namespace_verification_session_id,
      namespace_verification_id,
      status,
      normalized_root_label,
      challenge_payload_json,
      failure_reason
    FROM namespace_verification_sessions
    WHERE user_id = ${input.userId}
      AND family = 'spaces'
      AND normalized_root_label = ${input.rootLabel}
      AND status IN ('challenge_required', 'challenge_pending')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    namespace_verification_session_id: row.namespace_verification_session_id,
    namespace_verification_id: row.namespace_verification_id,
    status: row.status,
    normalized_root_label: row.normalized_root_label,
    challenge_payload: typeof row.challenge_payload_json === "string"
      ? JSON.parse(row.challenge_payload_json)
      : row.challenge_payload_json as NamespaceSession["challenge_payload"],
    failure_reason: row.failure_reason,
  };
}

async function publishSpacesChallenge(options: Options, session: NamespaceSession): Promise<void> {
  const payload = session.challenge_payload;
  const txtKey = payload?.txt_key?.trim();
  const txtValue = payload?.txt_value?.trim();
  const webUrl = payload?.web_url?.trim();
  const freedomUrl = payload?.freedom_url?.trim();
  if (!txtKey || !txtValue || !webUrl || !freedomUrl) {
    throw new Error("namespace session did not return a complete Spaces publish challenge");
  }

  await $`rtk ssh ${options.publisherSsh} ${options.publisherBin} publish ${`@${options.rootLabel}`} --wallet-export ${options.walletExport} --web ${webUrl} --freedom ${freedomUrl} --txt ${`${txtKey}=${txtValue}`} --max-index 10000`;
}

async function completeNamespaceWithRetry(options: Options, input: {
  accessToken: string;
  sessionId: string;
}): Promise<NamespaceSession> {
  let last: NamespaceSession | null = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    last = await apiRequest<NamespaceSession>({
      apiUrl: options.apiUrl,
      path: `/namespace-verification-sessions/${encodeURIComponent(input.sessionId)}/complete`,
      method: "POST",
      accessToken: input.accessToken,
      body: {},
    });
    if (last.status === "verified" && last.namespace_verification_id) {
      return last;
    }
    if (last.status === "failed" || last.status === "expired") {
      break;
    }
    await Bun.sleep(4000);
  }
  throw new Error(`namespace verification did not complete; status=${last?.status ?? "unknown"} failure=${last?.failure_reason ?? "none"}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = requireEnv("CONTROL_PLANE_DATABASE_URL");
  const db = new Bun.SQL(databaseUrl);

  try {
    const owner = await exchangeLaunchOwner(options);
    const bootstrap = await markLaunchOwnerVerified({
      db,
      userId: owner.userId,
      subject: options.subject,
    });

    const existingNamespaceVerificationId = await findVerifiedNamespace({
      db,
      userId: owner.userId,
      rootLabel: options.rootLabel,
    });
    const namespaceStarted = existingNamespaceVerificationId
      ? null
      : await findReusableNamespaceSession({
          db,
          userId: owner.userId,
          rootLabel: options.rootLabel,
        }) ?? await apiRequest<NamespaceSession>({
          apiUrl: options.apiUrl,
          path: "/namespace-verification-sessions",
          method: "POST",
          accessToken: owner.accessToken,
          body: {
            family: "spaces",
            root_label: options.rootLabel,
          },
        });
    const namespaceSessionId = namespaceStarted?.namespace_verification_session_id;
    if (!existingNamespaceVerificationId && !namespaceSessionId) {
      throw new Error("namespace start did not return namespace_verification_session_id");
    }

    if (namespaceStarted) {
      await publishSpacesChallenge(options, namespaceStarted);
    }

    const namespaceCompleted = existingNamespaceVerificationId
      ? null
      : await completeNamespaceWithRetry(options, {
          accessToken: owner.accessToken,
          sessionId: namespaceSessionId as string,
        });
    const namespaceVerificationId = existingNamespaceVerificationId ?? namespaceCompleted?.namespace_verification_id;
    if (!namespaceVerificationId) {
      throw new Error("namespace completion did not return namespace_verification_id");
    }

    const created = await apiRequest<CommunityCreateResponse>({
      apiUrl: options.apiUrl,
      path: "/communities",
      method: "POST",
      accessToken: owner.accessToken,
      body: {
        display_name: options.displayName,
        description: options.description,
        database_region: options.databaseRegion,
        membership_mode: "open",
        allow_anonymous_identity: false,
        default_age_gate_policy: "none",
        governance_mode: "centralized",
        namespace: {
          namespace_verification_id: namespaceVerificationId,
        },
        handle_policy: {
          policy_template: "standard",
        },
      },
    });

    const communityId = created.community?.community_id;
    if (!communityId) {
      throw new Error("community create did not return community_id");
    }

    const bindingRows = await db<{
      community_id: string;
      display_name: string;
      route_slug: string | null;
      provisioning_state: string;
      organization_slug: string | null;
      group_name: string | null;
      database_name: string | null;
      database_url: string | null;
      requires_credentials: number | string | boolean | null;
    }[]>`
      SELECT
        c.community_id,
        c.display_name,
        c.route_slug,
        c.provisioning_state,
        b.organization_slug,
        b.group_name,
        b.database_name,
        b.database_url,
        b.requires_credentials
      FROM communities AS c
      LEFT JOIN community_database_bindings AS b
        ON b.community_database_binding_id = c.primary_database_binding_id
      WHERE c.community_id = ${communityId}
      LIMIT 1
    `;
    const binding = bindingRows[0] ?? null;

    console.log(JSON.stringify({
      status: "created",
      launch_owner_user_id: owner.userId,
      launch_owner_bootstrap: {
        verification_session_id: bootstrap.verificationSessionId,
        user_attestation_id: bootstrap.attestationId,
        audit_event_id: bootstrap.auditEventId,
        reused: bootstrap.reused,
      },
      spaces_root_label: options.rootLabel,
      route_slug: created.community?.route_slug ?? binding?.route_slug ?? null,
      namespace_verification_session_id: namespaceSessionId ?? null,
      namespace_verification_id: namespaceVerificationId,
      community_id: communityId,
      community_status: created.community?.status ?? null,
      provisioning_state: created.community?.provisioning_state ?? binding?.provisioning_state ?? null,
      job_id: created.job?.job_id ?? null,
      job_status: created.job?.status ?? null,
      job_error_code: created.job?.error_code ?? null,
      turso: binding ? {
        organization_slug: binding.organization_slug,
        group_name: binding.group_name,
        database_name: binding.database_name,
        database_url: binding.database_url,
        requires_credentials: binding.requires_credentials === true || binding.requires_credentials === 1 || binding.requires_credentials === "1",
      } : null,
    }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
