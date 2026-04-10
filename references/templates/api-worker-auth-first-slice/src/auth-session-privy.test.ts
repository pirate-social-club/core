import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createFetchHandler } from "./runtime";
import { UniqueConstraintError } from "./lib/db";
import { encodeJwt, signEs256 } from "./lib/jwt-codec";
import type { AuthBootstrapStore, AuthBootstrapTx, InsertAuthProviderLinkInput, InsertGlobalHandleInput, InsertProfileInput, InsertUserInput, InsertWalletAttachmentInput, UpdateUserPrimaryWalletAttachmentInput } from "./lib/db";
import type { Env } from "./types/env";
import type { AuthProviderLinkRow, GlobalHandleRow, ProfileRow, UserRow, WalletAttachmentRow } from "./types/db";

function createEnv() {
  const pirateKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const privyKeys = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const env: Env = {
    CONTROL_PLANE_DATABASE_URL: "postgres://unused",
    AUTH_UPSTREAM_JWT_ISSUER: "unused",
    AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
    PRIVY_APP_ID: "privy-app-demo",
    PRIVY_ISSUER: "privy.io",
    PRIVY_JWT_VERIFICATION_KEY: privyKeys.publicKey,
    PIRATE_APP_JWT_ISSUER: "pirate-dev-local",
    PIRATE_APP_JWT_AUDIENCE: "pirate-app",
    PIRATE_APP_JWT_PUBLIC_KEY: pirateKeys.publicKey,
    PIRATE_APP_JWT_PRIVATE_KEY: pirateKeys.privateKey,
  };

  return {
    env,
    privyPrivateKey: privyKeys.privateKey,
  };
}

async function mintPrivyJwt(input: {
  privateKeyPem: string;
  env: Env;
  sub: string;
  extraClaims?: Record<string, unknown>;
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    typ: "JWT",
  };
  const payload = {
    iss: input.env.PRIVY_ISSUER ?? "privy.io",
    aud: input.env.PRIVY_APP_ID ?? "",
    sub: input.sub,
    iat: now,
    nbf: now,
    exp: now + 3600,
    ...input.extraClaims,
  };
  const unsigned = encodeJwt({
    header,
    payload,
    signature: new Uint8Array(),
  });
  const signingInput = unsigned.slice(0, unsigned.lastIndexOf("."));
  const signature = await signEs256({
    signingInput,
    privateKeyPem: input.privateKeyPem,
  });

  return encodeJwt({
    header,
    payload,
    signature,
  });
}

function createStore() {
  const users = new Map<string, UserRow>();
  const profiles = new Map<string, ProfileRow>();
  const globalHandles = new Map<string, GlobalHandleRow>();
  const authLinksBySubject = new Map<string, AuthProviderLinkRow>();
  const walletAttachments = new Map<string, WalletAttachmentRow>();

  const tx = {
    async findActiveAuthProviderLink(provider: string, providerSubject: string) {
      const row = authLinksBySubject.get(`${provider}:${providerSubject}`) ?? null;
      return row;
    },
    async getUser(userId: string) {
      return users.get(userId) ?? null;
    },
    async getProfileByUserId(userId: string) {
      return profiles.get(userId) ?? null;
    },
    async getGlobalHandleById(globalHandleId: string) {
      return globalHandles.get(globalHandleId) ?? null;
    },
    async listActiveWalletAttachments(userId: string) {
      return Array.from(walletAttachments.values())
        .filter((row) => row.user_id === userId && row.status === "active")
        .sort((left, right) => right.is_primary - left.is_primary || left.attached_at.localeCompare(right.attached_at));
    },
    async getLatestNamespaceVerificationForUser() { return null; },
    async getLatestNamespaceVerificationSessionForUser() { return null; },
    async getLatestRedditVerificationSessionForUser() { return null; },
    async getLatestExternalReputationSnapshotForUser() { return null; },
    async getLatestJobByTypeAndSubject() { return null; },
    async insertUser(input: InsertUserInput) {
      users.set(input.user_id, {
        user_id: input.user_id,
        primary_wallet_attachment_id: null,
        verification_state: "unverified",
        capability_provider: null,
        verification_capabilities_json: input.verification_capabilities_json,
        verified_at: null,
        nationality: null,
        current_verification_session_id: null,
        created_at: input.created_at,
        updated_at: input.updated_at,
      });
    },
    async insertGlobalHandle(input: InsertGlobalHandleInput) {
      globalHandles.set(input.global_handle_id, {
        global_handle_id: input.global_handle_id,
        user_id: input.user_id,
        label_normalized: input.label_normalized,
        label_display: input.label_display,
        status: "active",
        tier: "generated",
        issuance_source: "generated_signup",
        redirect_target_global_handle_id: null,
        price_paid_usd: null,
        free_rename_consumed: 0,
        issued_at: input.issued_at,
        replaced_at: null,
        created_at: input.created_at,
        updated_at: input.updated_at,
      });
    },
    async insertProfile(input: InsertProfileInput) {
      profiles.set(input.user_id, {
        user_id: input.user_id,
        display_name: null,
        bio: null,
        avatar_ref: null,
        cover_ref: null,
        global_handle_id: input.global_handle_id,
        created_at: input.created_at,
        updated_at: input.updated_at,
      });
    },
    async insertAuthProviderLink(input: InsertAuthProviderLinkInput) {
      const key = `${input.provider}:${input.provider_subject}`;
      if (authLinksBySubject.has(key)) {
        throw new UniqueConstraintError("auth_provider_links.provider_subject");
      }
      authLinksBySubject.set(key, {
        auth_provider_link_id: input.auth_provider_link_id,
        user_id: input.user_id,
        provider: input.provider,
        provider_subject: input.provider_subject,
        provider_user_ref: input.provider_user_ref,
        status: "active",
        linked_at: input.linked_at,
        revoked_at: null,
        created_at: input.created_at,
        updated_at: input.updated_at,
      });
    },
    async insertWalletAttachment(input: InsertWalletAttachmentInput) {
      const duplicate = Array.from(walletAttachments.values()).find((row) =>
        row.user_id === input.user_id &&
        row.status === "active" &&
        row.chain_namespace === input.chain_namespace &&
        row.wallet_address_normalized === input.wallet_address_normalized,
      );
      if (duplicate) {
        throw new UniqueConstraintError("wallet_attachments.user_wallet");
      }
      if (input.is_primary === 1) {
        const primary = Array.from(walletAttachments.values()).find((row) =>
          row.user_id === input.user_id && row.status === "active" && row.is_primary === 1,
        );
        if (primary) {
          throw new UniqueConstraintError("wallet_attachments.primary");
        }
      }
      walletAttachments.set(input.wallet_attachment_id, { ...input });
    },
    async updateUserPrimaryWalletAttachment(input: UpdateUserPrimaryWalletAttachmentInput) {
      const existing = users.get(input.user_id);
      if (!existing) {
        throw new Error("missing user");
      }
      users.set(input.user_id, {
        ...existing,
        primary_wallet_attachment_id: input.primary_wallet_attachment_id,
        updated_at: input.updated_at,
      });
    },
  };

  const store = {
    withTransaction<T>(fn: (inner: AuthBootstrapTx) => Promise<T>): Promise<T> {
      return fn(tx as unknown as AuthBootstrapTx);
    },
    ...tx,
  } as unknown as AuthBootstrapStore;

  return {
    store,
    readUsers: () => Array.from(users.values()),
    readWallets: () => Array.from(walletAttachments.values()),
  };
}

describe("Privy auth session exchange", () => {
  test("creates a user and attaches linked Privy wallets when an identity token is provided", async () => {
    const { env, privyPrivateKey } = createEnv();
    const { store, readUsers, readWallets } = createStore();
    const handler = createFetchHandler({ env, store });

    const userId = "did:privy:demo-user";
    const accessToken = await mintPrivyJwt({
      privateKeyPem: privyPrivateKey,
      env,
      sub: userId,
      extraClaims: { sid: "sess_demo_01" },
    });
    const identityToken = await mintPrivyJwt({
      privateKeyPem: privyPrivateKey,
      env,
      sub: userId,
      extraClaims: {
        linked_accounts: [
          { type: "wallet", address: "0xAbCdEf0000000000000000000000000000000001" },
          { type: "wallet", address: "0xaBcDEF0000000000000000000000000000000002" },
          { type: "email", address: "person@example.com" },
        ],
      },
    });

    const response = await handler(new Request("http://127.0.0.1:8787/auth/session/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proof: {
          type: "privy_access_token",
          privy_access_token: accessToken,
          privy_identity_token: identityToken,
        },
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      user: { user_id: string };
      wallet_attachments: Array<{
        chain_namespace: string;
        wallet_address: string;
        is_primary: boolean;
      }>;
    };

    expect(body.user.user_id.length).toBeGreaterThan(0);
    expect(body.wallet_attachments).toHaveLength(2);
    expect(body.wallet_attachments[0]).toMatchObject({
      chain_namespace: "eip155:1",
      wallet_address: "0xAbCdEf0000000000000000000000000000000001",
      is_primary: true,
    });
    expect(body.wallet_attachments[1]?.is_primary).toBe(false);

    const users = readUsers();
    expect(users).toHaveLength(1);
    expect(users[0]?.primary_wallet_attachment_id).toBeTruthy();
    expect(readWallets()).toHaveLength(2);
  });

  test("reuses the same user on repeat Privy exchange and rejects mismatched identity subjects", async () => {
    const { env, privyPrivateKey } = createEnv();
    const { store, readUsers, readWallets } = createStore();
    const handler = createFetchHandler({ env, store });

    const accessToken = await mintPrivyJwt({
      privateKeyPem: privyPrivateKey,
      env,
      sub: "did:privy:demo-user",
    });
    const goodIdentityToken = await mintPrivyJwt({
      privateKeyPem: privyPrivateKey,
      env,
      sub: "did:privy:demo-user",
      extraClaims: {
        linked_accounts: [
          { type: "wallet", address: "0xAbCdEf0000000000000000000000000000000001" },
        ],
      },
    });

    const first = await handler(new Request("http://127.0.0.1:8787/auth/session/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proof: {
          type: "privy_access_token",
          privy_access_token: accessToken,
          privy_identity_token: goodIdentityToken,
        },
      }),
    }));
    expect(first.status).toBe(200);

    const second = await handler(new Request("http://127.0.0.1:8787/auth/session/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proof: {
          type: "privy_access_token",
          privy_access_token: accessToken,
          privy_identity_token: goodIdentityToken,
        },
      }),
    }));
    expect(second.status).toBe(200);
    expect(readUsers()).toHaveLength(1);
    expect(readWallets()).toHaveLength(1);

    const badIdentityToken = await mintPrivyJwt({
      privateKeyPem: privyPrivateKey,
      env,
      sub: "did:privy:someone-else",
      extraClaims: {
        linked_accounts: [
          { type: "wallet", address: "0xAbCdEf0000000000000000000000000000000001" },
        ],
      },
    });
    const mismatch = await handler(new Request("http://127.0.0.1:8787/auth/session/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proof: {
          type: "privy_access_token",
          privy_access_token: accessToken,
          privy_identity_token: badIdentityToken,
        },
      }),
    }));
    expect(mismatch.status).toBe(401);
  });
});
