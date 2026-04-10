import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  completeNamespaceVerificationSession,
  startNamespaceVerificationSession,
} from "./lib/verification-service";
import { signPirateAccessToken } from "./lib/pirate-session-jwt";
import { buildDefaultVerificationCapabilitiesJson } from "./lib/verification-serializer";
import type {
  AuthBootstrapStore,
  AuthBootstrapTx,
  InsertNamespaceVerificationInput,
  InsertNamespaceVerificationSessionInput,
} from "./lib/db";
import type { Env } from "./types/env";
import type { NamespaceVerificationRow, NamespaceVerificationSessionRow, UserRow } from "./types/db";

class NamespaceVerificationStore {
  users = new Map<string, UserRow>();
  namespaceVerificationSessions = new Map<string, NamespaceVerificationSessionRow>();
  namespaceVerifications = new Map<string, NamespaceVerificationRow>();

  async withTransaction<T>(fn: (tx: AuthBootstrapTx) => Promise<T>): Promise<T> {
    return fn(this as unknown as AuthBootstrapTx);
  }

  async getUser(userId: string): Promise<UserRow | null> {
    return this.users.get(userId) ?? null;
  }

  async getNamespaceVerificationSessionById(namespaceVerificationSessionId: string): Promise<NamespaceVerificationSessionRow | null> {
    return this.namespaceVerificationSessions.get(namespaceVerificationSessionId) ?? null;
  }

  async insertNamespaceVerificationSession(input: InsertNamespaceVerificationSessionInput): Promise<void> {
    this.namespaceVerificationSessions.set(
      input.namespace_verification_session_id,
      input as NamespaceVerificationSessionRow,
    );
  }

  async updateNamespaceVerificationSession(input: InsertNamespaceVerificationSessionInput): Promise<void> {
    this.namespaceVerificationSessions.set(
      input.namespace_verification_session_id,
      input as NamespaceVerificationSessionRow,
    );
  }

  async insertNamespaceVerification(input: InsertNamespaceVerificationInput): Promise<void> {
    this.namespaceVerifications.set(input.namespace_verification_id, input as NamespaceVerificationRow);
  }
}

function createEnv(overrides: Partial<Env> = {}): Env {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  return {
    CONTROL_PLANE_DATABASE_URL: "postgres://unused",
    AUTH_UPSTREAM_JWT_ISSUER: "pirate-dev-upstream",
    AUTH_UPSTREAM_JWT_AUDIENCE: "pirate-api",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: "dev-upstream-secret",
    PIRATE_APP_JWT_ISSUER: "pirate-dev-local",
    PIRATE_APP_JWT_AUDIENCE: "pirate-app",
    PIRATE_APP_JWT_PRIVATE_KEY: keys.privateKey,
    PIRATE_APP_JWT_PUBLIC_KEY: keys.publicKey,
    PIRATE_API_PUBLIC_ORIGIN: "https://api.pirate.example",
    SELF_VERIFICATION_SCOPE: "pirate-verification-v0",
    VERY_VERIFY_URL: "https://verify.very.test/api/v1/verify",
    VERY_WIDGET_APP_ID: "pirate-app",
    VERY_WIDGET_TYPE_ID: "palm-scan-v0",
    VERY_WIDGET_EXTERNAL_NULLIFIER: "pirate-community-creation",
    HNS_VERIFIER_BASE_URL: "https://hns-verifier.test/inspect",
    ...overrides,
  };
}

describe("namespace verification hardening", () => {
  let env: Env;
  let store: NamespaceVerificationStore;
  let token: string;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    env = createEnv();
    store = new NamespaceVerificationStore();
    originalFetch = globalThis.fetch;

    const now = new Date().toISOString();
    store.users.set("usr_namespace_demo", {
      user_id: "usr_namespace_demo",
      primary_wallet_attachment_id: null,
      verification_state: "verified",
      capability_provider: "self",
      verification_capabilities_json: buildDefaultVerificationCapabilitiesJson(),
      verified_at: null,
      nationality: null,
      current_verification_session_id: null,
      created_at: now,
      updated_at: now,
    });

    store.users.set("usr_namespace_demo", {
      ...(store.users.get("usr_namespace_demo") as UserRow),
      verification_capabilities_json: JSON.stringify({
        unique_human: { state: "verified" },
        age_over_18: { state: "unverified" },
        nationality: { state: "unverified" },
        gender: { state: "unverified" },
      }),
      verified_at: now,
    });

    token = await signPirateAccessToken({
      userId: "usr_namespace_demo",
      env,
      now: new Date(now),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("start returns dns_setup_required when the verifier reports no authoritative DNS", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      root_exists: true,
      authoritative_dns_ready: false,
      expiry_horizon_sufficient: true,
      routing_enabled: false,
      pirate_dns_authority_verified: false,
      observation_provider: "fire-hsd",
      failure_reason: "authoritative_dns_required",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const session = await startNamespaceVerificationSession({
      bearerToken: token,
      requestBody: {
        family: "hns",
        root_label: "Infinity",
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date("2026-04-10T12:00:00.000Z"),
    });

    expect(session.status).toBe("dns_setup_required");
    expect(session.normalized_root_label).toBe("infinity");
    expect(session.challenge_host).toBeNull();
    expect(session.failure_reason).toBe("authoritative_dns_required");
  });

  test("start issues a challenge and complete verifies it through the configured verifier", async () => {
    const responses = [
      {
        root_exists: true,
        authoritative_dns_ready: true,
        expiry_horizon_sufficient: true,
        routing_enabled: true,
        pirate_dns_authority_verified: false,
        observation_provider: "fire-hsd",
        evidence_bundle_ref: "evidence:start",
      },
      {
        root_exists: true,
        authoritative_dns_ready: true,
        expiry_horizon_sufficient: true,
        routing_enabled: true,
        pirate_dns_authority_verified: false,
        challenge_present: true,
        challenge_matches: true,
        observation_provider: "fire-hsd",
        evidence_bundle_ref: "evidence:complete",
      },
    ];
    globalThis.fetch = (async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const session = await startNamespaceVerificationSession({
      bearerToken: token,
      requestBody: {
        family: "hns",
        root_label: "Infinity",
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date("2026-04-10T12:00:00.000Z"),
    });

    expect(session.status).toBe("challenge_pending");
    expect(session.challenge_host).toBe("_pirate.infinity");
    expect(session.challenge_txt_value).toContain("pirate-verify=nvs_");

    const completed = await completeNamespaceVerificationSession({
      bearerToken: token,
      namespaceVerificationSessionId: session.namespace_verification_session_id,
      requestBody: {},
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date("2026-04-10T12:05:00.000Z"),
    });

    expect(completed.status).toBe("verified");
    expect(completed.namespace_verification_id).toMatch(/^nv_/);
    expect(completed.assertions.root_control_verified).toBe(true);
    expect(completed.capabilities.club_attach_allowed).toBe(true);
    expect(store.namespaceVerifications.size).toBe(1);
  });

  test("complete fails closed when unique_human is no longer verified", async () => {
    const responses = [
      {
        root_exists: true,
        authoritative_dns_ready: true,
        expiry_horizon_sufficient: true,
        routing_enabled: false,
        pirate_dns_authority_verified: false,
        observation_provider: "fire-hsd",
      },
      {
        root_exists: true,
        authoritative_dns_ready: true,
        expiry_horizon_sufficient: true,
        routing_enabled: false,
        pirate_dns_authority_verified: false,
        challenge_present: true,
        challenge_matches: true,
        observation_provider: "fire-hsd",
      },
    ];
    globalThis.fetch = (async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const session = await startNamespaceVerificationSession({
      bearerToken: token,
      requestBody: {
        family: "hns",
        root_label: "Infinity",
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date("2026-04-10T12:00:00.000Z"),
    });

    store.users.set("usr_namespace_demo", {
      ...(store.users.get("usr_namespace_demo") as UserRow),
      verification_capabilities_json: JSON.stringify({
        unique_human: { state: "expired" },
      }),
    });

    const completed = await completeNamespaceVerificationSession({
      bearerToken: token,
      namespaceVerificationSessionId: session.namespace_verification_session_id,
      requestBody: {},
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date("2026-04-10T12:05:00.000Z"),
    });

    expect(completed.status).toBe("failed");
    expect(completed.failure_reason).toBe("creator_not_unique_human_verified");
    expect(store.namespaceVerifications.size).toBe(0);
  });

  test("start fails closed when no verifier is configured", async () => {
    env.HNS_VERIFIER_BASE_URL = undefined;

    await expect(startNamespaceVerificationSession({
      bearerToken: token,
      requestBody: {
        family: "hns",
        root_label: "Infinity",
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date("2026-04-10T12:00:00.000Z"),
    })).rejects.toMatchObject({
      status: 501,
    });
  });
});
