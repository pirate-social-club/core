import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { buildDefaultVerificationCapabilitiesJson } from "./lib/verification-serializer";
import {
  completeVerificationSession,
  completeVerificationSessionByCallback,
  getVerificationSession,
  startVerificationSession,
} from "./lib/verification-service";
import { signPirateAccessToken } from "./lib/pirate-session-jwt";
import type { AuthBootstrapStore, AuthBootstrapTx, InsertVerificationSessionInput, UpdateUserVerificationInput } from "./lib/db";
import type { Env } from "./types/env";
import type { UserRow, VerificationSessionRow } from "./types/db";

class VerificationStore {
  users = new Map<string, UserRow>();
  verificationSessions = new Map<string, VerificationSessionRow>();

  async withTransaction<T>(fn: (tx: AuthBootstrapTx) => Promise<T>): Promise<T> {
    return fn(this as unknown as AuthBootstrapTx);
  }

  async getUser(userId: string): Promise<UserRow | null> {
    return this.users.get(userId) ?? null;
  }

  async getVerificationSessionById(verificationSessionId: string): Promise<VerificationSessionRow | null> {
    return this.verificationSessions.get(verificationSessionId) ?? null;
  }

  async insertVerificationSession(input: InsertVerificationSessionInput): Promise<void> {
    this.verificationSessions.set(input.verification_session_id, input as VerificationSessionRow);
  }

  async updateVerificationSession(input: InsertVerificationSessionInput): Promise<void> {
    this.verificationSessions.set(input.verification_session_id, input as VerificationSessionRow);
  }

  async updateUserVerification(input: UpdateUserVerificationInput): Promise<void> {
    const existing = this.users.get(input.user_id);
    if (!existing) {
      throw new Error("missing user");
    }

    this.users.set(input.user_id, {
      ...existing,
      verification_state: input.verification_state,
      capability_provider: input.capability_provider,
      verification_capabilities_json: input.verification_capabilities_json,
      verified_at: input.verified_at,
      nationality: input.nationality,
      current_verification_session_id: input.current_verification_session_id,
      updated_at: input.updated_at,
    });
  }
}

function createEnv(): Env {
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
  };
}

describe("verification hardening", () => {
  let env: Env;
  let store: VerificationStore;
  let token: string;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    env = createEnv();
    store = new VerificationStore();
    originalFetch = globalThis.fetch;

    const now = new Date().toISOString();
    store.users.set("usr_verify_demo", {
      user_id: "usr_verify_demo",
      primary_wallet_attachment_id: null,
      verification_state: "unverified",
      capability_provider: null,
      verification_capabilities_json: buildDefaultVerificationCapabilitiesJson(),
      verified_at: null,
      nationality: null,
      current_verification_session_id: null,
      created_at: now,
      updated_at: now,
    });

    token = await signPirateAccessToken({
      userId: "usr_verify_demo",
      env,
      now: new Date(now),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("self verification sessions start and callback rejects malformed payloads", async () => {
    const session = await startVerificationSession({
      bearerToken: token,
      requestBody: {
        provider: "self",
        verification_intent: "profile_verification",
        requested_capabilities: ["unique_human"],
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    });
    expect(session.provider).toBe("self");
    expect(session.launch.self_app?.endpoint).toBe(
      `https://api.pirate.example/verification-sessions/${session.verification_session_id}/callback`,
    );

    await expect(completeVerificationSessionByCallback({
      verificationSessionId: session.verification_session_id,
      requestBody: {},
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    })).rejects.toMatchObject({
      status: 400,
    });
    expect(store.verificationSessions.get(session.verification_session_id)?.status).toBe("pending");
  });

  test("existing self sessions remain readable after public origin config is removed", async () => {
    const session = await startVerificationSession({
      bearerToken: token,
      requestBody: {
        provider: "self",
        verification_intent: "profile_verification",
        requested_capabilities: ["unique_human"],
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    });

    const envWithoutOrigin = {
      ...env,
      PIRATE_API_PUBLIC_ORIGIN: undefined,
    };
    const reread = await getVerificationSession({
      bearerToken: token,
      verificationSessionId: session.verification_session_id,
      env: envWithoutOrigin,
      store: store as unknown as AuthBootstrapStore,
    });

    expect(reread.launch.self_app?.endpoint).toBe(
      `https://api.pirate.example/verification-sessions/${session.verification_session_id}/callback`,
    );
    expect(reread.policy_id).toBeNull();
  });

  test("very verification completion requires proof and re-validates it server-side", async () => {
    const session = await startVerificationSession({
      bearerToken: token,
      requestBody: {
        provider: "very",
        verification_intent: "profile_verification",
        requested_capabilities: ["unique_human"],
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    });

    await expect(completeVerificationSession({
      bearerToken: token,
      verificationSessionId: session.verification_session_id,
      requestBody: {},
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    })).rejects.toMatchObject({
      status: 400,
    });

    globalThis.fetch = (async () => new Response(JSON.stringify({ status: "valid" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    })) as unknown as typeof fetch;

    const completed = await completeVerificationSession({
      bearerToken: token,
      verificationSessionId: session.verification_session_id,
      requestBody: {
        proof: "{\"proof\":\"demo\"}",
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    });

    expect(completed.status).toBe("verified");
    expect(completed.provider).toBe("very");
    expect(store.verificationSessions.get(session.verification_session_id)?.status).toBe("verified");
    expect(store.users.get("usr_verify_demo")?.verification_state).toBe("verified");
  });

  test("callback route no longer promotes verification state", async () => {
    const session = await startVerificationSession({
      bearerToken: token,
      requestBody: {
        provider: "very",
        verification_intent: "profile_verification",
        requested_capabilities: ["unique_human"],
      },
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    });

    await expect(completeVerificationSessionByCallback({
      verificationSessionId: session.verification_session_id,
      requestBody: {},
      env,
      store: store as unknown as AuthBootstrapStore,
      now: new Date(),
    })).rejects.toMatchObject({
      status: 501,
    });
    expect(store.verificationSessions.get(session.verification_session_id)?.status).toBe("pending");
  });
});
