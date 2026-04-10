#!/usr/bin/env bun

import { createHmac, generateKeyPairSync } from "node:crypto";
import { createFetchHandler, createRuntimeStore } from "../references/templates/api-worker-auth-first-slice/src/runtime";
import type { Env } from "../references/templates/api-worker-auth-first-slice/src/types/env";

type Options = {
  subject: string;
  namespaceLabel: string;
  displayName: string;
  apiBaseUrl: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/local-new-account-flow.ts [options]

Runs the local first-time account -> unique_human verify -> namespace verify -> community create flow
against the in-process reference API runtime. No local API server is required.

Options:
  --subject SUB              Optional unique subject. Default: generated per run
  --namespace-label LABEL    Optional HNS root label. Default: generated per run
  --display-name NAME        Optional community display name. Default: derived from namespace label
  --api-base-url URL         Default: http://127.0.0.1:8787
  -h, --help                 Show this help text.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const suffix = Date.now().toString(36);
  const defaultNamespaceLabel = `club-${suffix}`;

  const options: Options = {
    subject: `local-subject-${suffix}`,
    namespaceLabel: defaultNamespaceLabel,
    displayName: `Club ${suffix}`,
    apiBaseUrl: "http://127.0.0.1:8787",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--subject":
        options.subject = value ?? options.subject;
        index += 2;
        break;
      case "--namespace-label":
        options.namespaceLabel = value ?? options.namespaceLabel;
        index += 2;
        break;
      case "--display-name":
        options.displayName = value ?? options.displayName;
        index += 2;
        break;
      case "--api-base-url":
        options.apiBaseUrl = value ?? options.apiBaseUrl;
        index += 2;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.displayName) {
    options.displayName = options.namespaceLabel;
  }

  return options;
}

function requireEnv(name: keyof Env): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing env var: ${name}`);
  }
  return value;
}

function envOrDefault(name: keyof Env, fallback: string): string {
  return process.env[name] || fallback;
}

function loadEnv(): Env {
  const pirateIssuer = process.env.PIRATE_APP_JWT_ISSUER || "pirate-dev-local";
  const pirateAudience = process.env.PIRATE_APP_JWT_AUDIENCE || "pirate-app";
  const generatedKeyPair =
    process.env.PIRATE_APP_JWT_PRIVATE_KEY && process.env.PIRATE_APP_JWT_PUBLIC_KEY
      ? null
      : generateKeyPairSync("rsa", {
          modulusLength: 2048,
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
          },
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
        });

  const privateKey = process.env.PIRATE_APP_JWT_PRIVATE_KEY || generatedKeyPair?.privateKey;
  const publicKey = process.env.PIRATE_APP_JWT_PUBLIC_KEY || generatedKeyPair?.publicKey;

  if (!privateKey || !publicKey) {
    throw new Error("failed to construct Pirate app JWT key material");
  }

  return {
    CONTROL_PLANE_DATABASE_URL: requireEnv("CONTROL_PLANE_DATABASE_URL"),
    AUTH_UPSTREAM_JWT_ISSUER: envOrDefault("AUTH_UPSTREAM_JWT_ISSUER", "pirate-dev-upstream"),
    AUTH_UPSTREAM_JWT_AUDIENCE: envOrDefault("AUTH_UPSTREAM_JWT_AUDIENCE", "pirate-api"),
    AUTH_UPSTREAM_JWT_SHARED_SECRET: envOrDefault("AUTH_UPSTREAM_JWT_SHARED_SECRET", "dev-upstream-secret"),
    PIRATE_APP_JWT_ISSUER: pirateIssuer,
    PIRATE_APP_JWT_AUDIENCE: pirateAudience,
    PIRATE_APP_JWT_PRIVATE_KEY: privateKey,
    PIRATE_APP_JWT_PUBLIC_KEY: publicKey,
    VERY_VERIFY_URL: "https://very.local.test/api/v1/verify",
    HNS_VERIFIER_BASE_URL: "https://hns.local.test/inspect",
    REGISTRY_PUBLISHER_BASE_URL: "https://registry.local.test",
    REGISTRY_PUBLISHER_AUTH_TOKEN: "local-dev-publisher",
  };
}

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function mintUpstreamJwt(input: {
  issuer: string;
  audience: string;
  subject: string;
  secret: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload = {
    iss: input.issuer,
    aud: input.audience,
    sub: input.subject,
    iat: now,
    nbf: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", input.secret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${signingInput}.${signature}`;
}

async function expectJson<T>(response: Response, expectedStatus: number, label: string): Promise<T> {
  const body = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`${label} failed: expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
  }

  return body as T;
}

function installMockFetch(env: Env) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === env.VERY_VERIFY_URL) {
      return new Response(JSON.stringify({ status: "valid" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    if (url.startsWith(env.HNS_VERIFIER_BASE_URL || "")) {
      const parsed = new URL(url);
      const challengeHost = parsed.searchParams.get("challenge_host");
      const challengeTxtValue = parsed.searchParams.get("challenge_txt_value");

      return new Response(JSON.stringify({
        root_exists: true,
        authoritative_dns_ready: true,
        expiry_horizon_sufficient: true,
        routing_enabled: true,
        pirate_dns_authority_verified: false,
        challenge_present: challengeHost && challengeTxtValue ? true : null,
        challenge_matches: challengeHost && challengeTxtValue ? true : null,
        control_class: "single_holder_root",
        operation_class: "owner_managed_namespace",
        observation_provider: "local-hns-mock",
        evidence_bundle_ref: `mock:${parsed.searchParams.get("root_label") ?? "unknown"}`,
        failure_reason: null,
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    if (url === `${env.REGISTRY_PUBLISHER_BASE_URL}/internal/v0/create-community-attempt`) {
      return new Response(JSON.stringify({
        ok: true,
        registry_attempt_id: `rga_${Date.now().toString(36)}`,
        attempts_table: "community_create_attempts_current_84532_1",
        result_ref: "tableland://community_create_attempts_current_84532_1/demo",
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    }

    return originalFetch(input as never, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export async function runLocalNewAccountFlow(options: Options) {
  const env = loadEnv();
  const restoreFetch = installMockFetch(env);

  try {
    const store = createRuntimeStore(env);
    const handler = createFetchHandler({
      env,
      store,
    });

    const upstreamJwt = mintUpstreamJwt({
      issuer: env.AUTH_UPSTREAM_JWT_ISSUER,
      audience: env.AUTH_UPSTREAM_JWT_AUDIENCE,
      subject: options.subject,
      secret: env.AUTH_UPSTREAM_JWT_SHARED_SECRET,
    });

    const exchange = await expectJson<{
      access_token: string;
      user: { user_id: string };
      profile: { global_handle: { label: string } };
      onboarding: {
        unique_human_verification_status: string;
        namespace_verification_status: string;
        community_creation_ready: boolean;
        missing_requirements: string[];
      };
    }>(
      await handler(new Request(`${options.apiBaseUrl}/auth/session/exchange`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          proof: {
            type: "jwt_based_auth",
            jwt: upstreamJwt,
          },
        }),
      })),
      200,
      "auth/session/exchange",
    );

    const accessToken = exchange.access_token;

    const verificationSession = await expectJson<{
      verification_session_id: string;
    }>(
      await handler(new Request(`${options.apiBaseUrl}/verification-sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          provider: "very",
          requested_capabilities: ["unique_human"],
          verification_intent: "community_creation",
        }),
      })),
      201,
      "start verification session",
    );

    await expectJson(
      await handler(new Request(`${options.apiBaseUrl}/verification-sessions/${verificationSession.verification_session_id}/complete`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          proof: "{\"proof\":\"local-demo\"}",
        }),
      })),
      200,
      "complete unique_human verification",
    );

    const namespaceSession = await expectJson<{
      namespace_verification_session_id: string;
      namespace_verification_id?: string | null;
      status: string;
      challenge_host?: string | null;
      challenge_txt_value?: string | null;
    }>(
      await handler(new Request(`${options.apiBaseUrl}/namespace-verification-sessions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          family: "hns",
          root_label: options.namespaceLabel,
        }),
      })),
      201,
      "start namespace verification session",
    );

    const completedNamespace = await expectJson<{
      namespace_verification_id?: string | null;
      status: string;
    }>(
      await handler(new Request(`${options.apiBaseUrl}/namespace-verification-sessions/${namespaceSession.namespace_verification_session_id}/complete`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      })),
      200,
      "complete namespace verification",
    );

    const namespaceVerificationId = completedNamespace.namespace_verification_id;
    if (!namespaceVerificationId || completedNamespace.status !== "verified") {
      throw new Error(`namespace verification did not complete: ${JSON.stringify(completedNamespace)}`);
    }

    const onboarding = await expectJson<{
      unique_human_verification_status: string;
      namespace_verification_status: string;
      community_creation_ready: boolean;
      missing_requirements: string[];
    }>(
      await handler(new Request(`${options.apiBaseUrl}/onboarding/status`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      })),
      200,
      "get onboarding status",
    );

    const communityCreate = await expectJson<{
      community: { community_id: string; display_name: string; namespace_verification_id?: string | null };
      job: { job_id: string; status: string };
    }>(
      await handler(new Request(`${options.apiBaseUrl}/communities`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          display_name: options.displayName,
          membership_mode: "open",
          governance_mode: "centralized",
          handle_policy: {
            policy_template: "standard",
          },
          namespace: {
            namespace_verification_id: namespaceVerificationId,
          },
        }),
      })),
      202,
      "create community",
    );

    return {
      ok: true,
      subject: options.subject,
      user_id: exchange.user.user_id,
      global_handle: exchange.profile.global_handle.label,
      access_token: accessToken,
      onboarding,
      namespace_verification_id: namespaceVerificationId,
      community_id: communityCreate.community.community_id,
      community_display_name: communityCreate.community.display_name,
      provisioning_job_id: communityCreate.job.job_id,
      provisioning_job_status: communityCreate.job.status,
    };
  } finally {
    restoreFetch();
  }
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const result = await runLocalNewAccountFlow(options);
  console.log(JSON.stringify(result, null, 2));
}
