import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { joinCommunity } from "./lib/community-join-service";
import type { AuthBootstrapStore, AuthBootstrapTx } from "./lib/db";
import type {
  CommunityDatabaseBindingRow,
  CommunityGateRuleRow,
  CommunityMembershipProjectionRow,
  CommunityMembershipRequestRow,
  CommunityRow,
  UserRow,
  WalletAttachmentRow,
} from "./types/db";
import type { Env } from "./types/env";

const originalFetch = globalThis.fetch;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function buildUser(overrides?: Partial<UserRow>): UserRow {
  return {
    user_id: "usr_01",
    primary_wallet_attachment_id: "wal_01",
    verification_state: "verified",
    capability_provider: "self",
    verification_capabilities_json: JSON.stringify({
      unique_human: { state: "verified" },
      age_over_18: { state: "unverified" },
      nationality: { state: "unverified", value: null },
      gender: { state: "unverified", value: null },
      sanctions_clear: { state: "unverified" },
      wallet_score: { state: "unverified", passing_score: false, score: null },
    }),
    verified_at: "2026-04-10T00:00:00Z",
    nationality: null,
    current_verification_session_id: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

function buildCommunity(overrides?: Partial<CommunityRow>): CommunityRow {
  return {
    community_id: "cmt_01",
    creator_user_id: "usr_owner",
    display_name: "Collectors",
    membership_mode: "gated",
    status: "active",
    provisioning_state: "active",
    transfer_state: "none",
    registry_publication_state: "published",
    registry_attempt_id: null,
    registry_published_at: null,
    registry_publication_job_id: null,
    registry_error_code: null,
    route_slug: null,
    namespace_verification_id: null,
    primary_database_binding_id: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

function buildWallet(overrides?: Partial<WalletAttachmentRow>): WalletAttachmentRow {
  return {
    wallet_attachment_id: "wal_01",
    user_id: "usr_01",
    chain_namespace: "eip155:1",
    wallet_address_normalized: "0x1111111111111111111111111111111111111111",
    wallet_address_display: "0x1111111111111111111111111111111111111111",
    source_provider: "privy",
    source_subject: null,
    attachment_kind: "external",
    is_primary: 1,
    status: "active",
    attached_at: "2026-04-10T00:00:00Z",
    detached_at: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

function buildErc721Rule(overrides?: Partial<CommunityGateRuleRow>): CommunityGateRuleRow {
  return {
    gate_rule_id: "gate_01",
    community_id: "cmt_01",
    scope: "membership",
    gate_family: "token_holding",
    gate_type: "erc721_holding",
    proof_requirements_json: null,
    chain_namespace: "eip155:1",
    gate_config_json: JSON.stringify({
      standard: "erc721",
      mode: "contract_any",
      chain_namespace: "eip155:1",
      contract_address: "0x2222222222222222222222222222222222222222",
    }),
    status: "active",
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

function buildIdentityRule(overrides?: Partial<CommunityGateRuleRow>): CommunityGateRuleRow {
  return {
    gate_rule_id: "gate_identity_01",
    community_id: "cmt_01",
    scope: "membership",
    gate_family: "identity_proof",
    gate_type: "age_over_18",
    proof_requirements_json: null,
    chain_namespace: null,
    gate_config_json: null,
    status: "active",
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
    ...overrides,
  };
}

function buildEnv(overrides?: Partial<Env>): Env {
  return {
    CONTROL_PLANE_DATABASE_URL: "unused",
    AUTH_UPSTREAM_JWT_ISSUER: "unused",
    AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
    PIRATE_APP_JWT_ISSUER: "unused",
    PIRATE_APP_JWT_AUDIENCE: "unused",
    PIRATE_APP_JWT_PUBLIC_KEY: "unused",
    PIRATE_APP_JWT_PRIVATE_KEY: "unused",
    ...overrides,
  };
}

function buildStore(input?: {
  rules?: CommunityGateRuleRow[];
  existingProjection?: CommunityMembershipProjectionRow | null;
  existingPendingRequest?: CommunityMembershipRequestRow | null;
  activeBinding?: CommunityDatabaseBindingRow | null;
}) {
  let projection = input?.existingProjection ?? null;
  let pendingRequest = input?.existingPendingRequest ?? null;

  const tx: Pick<
    AuthBootstrapTx,
    "upsertCommunityMembershipProjection" | "getPendingCommunityMembershipRequest" | "insertCommunityMembershipRequest"
  > = {
    async upsertCommunityMembershipProjection(next) {
      projection = {
        projection_id: next.projection_id,
        community_id: next.community_id,
        user_id: next.user_id,
        membership_state: next.membership_state,
        role_summary_json: next.role_summary_json,
        source_updated_at: next.source_updated_at,
        created_at: next.created_at,
        updated_at: next.updated_at,
      };
    },
    async getPendingCommunityMembershipRequest(): Promise<CommunityMembershipRequestRow | null> {
      return pendingRequest;
    },
    async insertCommunityMembershipRequest(next) {
      pendingRequest = {
        membership_request_id: next.membership_request_id,
        community_id: next.community_id,
        applicant_user_id: next.applicant_user_id,
        status: next.status,
        note: next.note,
        reviewed_by_user_id: next.reviewed_by_user_id,
        review_reason: next.review_reason,
        resolved_at: next.resolved_at,
        expires_at: next.expires_at,
        created_at: next.created_at,
        updated_at: next.updated_at,
      };
    },
  };

  const store = {
    async withTransaction<T>(fn: (inner: AuthBootstrapTx) => Promise<T>): Promise<T> {
      return fn(tx as unknown as AuthBootstrapTx);
    },
    async listActiveCommunityGateRules(): Promise<CommunityGateRuleRow[]> {
      return input?.rules ?? [];
    },
    async getCommunityMembershipProjection(): Promise<CommunityMembershipProjectionRow | null> {
      return projection;
    },
    async getActiveCommunityDatabaseBinding(): Promise<CommunityDatabaseBindingRow | null> {
      return input?.activeBinding ?? null;
    },
  } as unknown as AuthBootstrapStore;

  return {
    store,
    readProjection: () => projection,
    readPendingRequest: () => pendingRequest,
  };
}

function createBootstrappedCommunityDb(input?: { membershipMode?: "open" | "request" | "gated" }) {
  const dir = mkdtempSync(join(tmpdir(), "pirate-community-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "community.db");
  const result = Bun.spawnSync(
    [
      "bash",
      resolve(repoRoot, "scripts/bootstrap-community-db.sh"),
      "--db",
      dbPath,
      "--community-id",
      "cmt_01",
      "--user-id",
      "usr_owner",
      "--display-name",
      "Collectors",
      "--namespace-verification-id",
      "nsv_01",
      "--membership-mode",
      input?.membershipMode ?? "request",
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || "failed to bootstrap community db");
  }

  return {
    dir,
    dbPath,
  };
}

function querySqliteValue(dbPath: string, sql: string): string {
  const result = Bun.spawnSync(["sqlite3", "-noheader", dbPath, sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || "sqlite query failed");
  }

  return new TextDecoder().decode(result.stdout).trim();
}

function runSqlite(dbPath: string, sql: string): void {
  const result = Bun.spawnSync(["sqlite3", dbPath, sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || "sqlite statement failed");
  }
}

describe("community join service", () => {
  test("joins an open community when the platform baseline credential passes", async () => {
    const { store, readProjection } = buildStore();
    const result = await joinCommunity({
      community: buildCommunity({ membership_mode: "open" }),
      user: buildUser(),
      env: buildEnv(),
      store,
      walletAttachments: [buildWallet()],
    });

    expect(result).toEqual({
      community_id: "cmt_01",
      status: "joined",
    });
    expect(readProjection()?.membership_state).toBe("member");
  });

  test("joins a gated ERC-721 community when a linked wallet holds the required NFT", async () => {
    let fetchCalls = 0;
    globalThis.fetch = ((async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          ownedNfts: [{ tokenId: "7", raw: { metadata: {} } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown) as typeof fetch;

    const { store, readProjection } = buildStore({
      rules: [buildErc721Rule()],
    });
    const result = await joinCommunity({
      community: buildCommunity(),
      user: buildUser({
        verification_capabilities_json: JSON.stringify({
          unique_human: { state: "unverified" },
          age_over_18: { state: "unverified" },
          nationality: { state: "unverified", value: null },
          gender: { state: "unverified", value: null },
          sanctions_clear: { state: "unverified" },
          wallet_score: { state: "unverified", passing_score: false, score: null },
        }),
      }),
      env: buildEnv({
        ALCHEMY_ETH_MAINNET_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/test-key",
      }),
      store,
      walletAttachments: [buildWallet()],
    });

    expect(result.status).toBe("joined");
    expect(readProjection()?.membership_state).toBe("member");
    expect(fetchCalls).toBe(1);
  });

  test("rejects join attempts for non-active communities", async () => {
    const { store } = buildStore();

    await expect(
      joinCommunity({
        community: buildCommunity({ status: "archived" }),
        user: buildUser(),
        env: buildEnv(),
        store,
        walletAttachments: [buildWallet()],
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: {
        code: "conflict",
        message: "Community is not accepting joins",
        retryable: false,
      },
    });
  });

  test("rejects banned users before evaluating gates", async () => {
    const { store } = buildStore({
      existingProjection: {
        projection_id: "cmp_01",
        community_id: "cmt_01",
        user_id: "usr_01",
        membership_state: "banned",
        role_summary_json: null,
        source_updated_at: "2026-04-10T00:00:00Z",
        created_at: "2026-04-10T00:00:00Z",
        updated_at: "2026-04-10T00:00:00Z",
      },
    });

    await expect(
      joinCommunity({
        community: buildCommunity(),
        user: buildUser(),
        env: buildEnv(),
        store,
        walletAttachments: [buildWallet()],
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: {
        code: "gate_failed",
        message: "Membership is blocked for this community",
        retryable: false,
      },
    });
  });

  test("rejects gated ERC-721 joins when no linked wallet satisfies the rule", async () => {
    globalThis.fetch = ((async () =>
      new Response(
        JSON.stringify({
          ownedNfts: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown) as typeof fetch;

    const { store, readProjection } = buildStore({
      rules: [buildErc721Rule()],
    });

    await expect(
      joinCommunity({
        community: buildCommunity(),
        user: buildUser({
          verification_capabilities_json: JSON.stringify({
            unique_human: { state: "unverified" },
            age_over_18: { state: "unverified" },
            nationality: { state: "unverified", value: null },
            gender: { state: "unverified", value: null },
            sanctions_clear: { state: "unverified" },
            wallet_score: { state: "unverified", passing_score: false, score: null },
          }),
        }),
        env: buildEnv({
          ALCHEMY_ETH_MAINNET_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/test-key",
        }),
        store,
        walletAttachments: [buildWallet()],
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: {
        code: "gate_failed",
        message: "A platform baseline trust credential is required to join this community",
        retryable: false,
      },
    });
    expect(readProjection()).toBeNull();
  });

  test("propagates retryable gate failures when ERC-721 lookup is unavailable", async () => {
    globalThis.fetch = ((async () =>
      new Response(
        JSON.stringify({
          error: "upstream unavailable",
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      )) as unknown) as typeof fetch;

    const { store } = buildStore({
      rules: [buildErc721Rule()],
    });

    await expect(
      joinCommunity({
        community: buildCommunity(),
        user: buildUser({
          verification_capabilities_json: JSON.stringify({
            unique_human: { state: "unverified" },
            age_over_18: { state: "unverified" },
            nationality: { state: "unverified", value: null },
            gender: { state: "unverified", value: null },
            sanctions_clear: { state: "unverified" },
            wallet_score: { state: "unverified", passing_score: false, score: null },
          }),
        }),
        env: buildEnv({
          ALCHEMY_ETH_MAINNET_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/test-key",
        }),
        store,
        walletAttachments: [buildWallet()],
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: {
        code: "gate_failed",
        message: "Alchemy returned 503 while evaluating wallet ownership",
        retryable: true,
      },
    });
  });

  test("evaluates identity-proof membership gates after baseline passes", async () => {
    const { store } = buildStore({
      rules: [buildIdentityRule()],
    });

    await expect(
      joinCommunity({
        community: buildCommunity(),
        user: buildUser({
          verification_capabilities_json: JSON.stringify({
            unique_human: { state: "verified" },
            age_over_18: { state: "unverified" },
            nationality: { state: "unverified", value: null },
            gender: { state: "unverified", value: null },
            sanctions_clear: { state: "unverified" },
            wallet_score: { state: "unverified", passing_score: false, score: null },
          }),
        }),
        env: buildEnv(),
        store,
        walletAttachments: [buildWallet()],
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: {
        code: "gate_failed",
        message: "age_over_18 verification is required",
        retryable: false,
      },
    });
  });

  test("creates a pending membership request for request-mode communities", async () => {
    const { store, readProjection, readPendingRequest } = buildStore();

    const result = await joinCommunity({
      community: buildCommunity({ membership_mode: "request" }),
      user: buildUser(),
      env: buildEnv(),
      store,
      walletAttachments: [buildWallet()],
    });

    expect(result).toEqual({
      community_id: "cmt_01",
      status: "requested",
    });
    expect(readProjection()).toBeNull();
    expect(readPendingRequest()).toMatchObject({
      community_id: "cmt_01",
      applicant_user_id: "usr_01",
      status: "pending",
    });
  });

  test("reuses an existing pending membership request for request-mode communities", async () => {
    const { store, readProjection, readPendingRequest } = buildStore({
      existingPendingRequest: {
        membership_request_id: "cmr_01",
        community_id: "cmt_01",
        applicant_user_id: "usr_01",
        status: "pending",
        note: null,
        reviewed_by_user_id: null,
        review_reason: null,
        resolved_at: null,
        expires_at: null,
        created_at: "2026-04-10T00:00:00Z",
        updated_at: "2026-04-10T00:00:00Z",
      },
    });

    const result = await joinCommunity({
      community: buildCommunity({ membership_mode: "request" }),
      user: buildUser(),
      env: buildEnv(),
      store,
      walletAttachments: [buildWallet()],
    });

    expect(result).toEqual({
      community_id: "cmt_01",
      status: "requested",
    });
    expect(readProjection()).toBeNull();
    expect(readPendingRequest()).toMatchObject({
      membership_request_id: "cmr_01",
      status: "pending",
    });
  });

  test("writes request-mode joins into the canonical community db when a binding is active", async () => {
    const { dbPath } = createBootstrappedCommunityDb({ membershipMode: "request" });
    const { store, readProjection } = buildStore({
      activeBinding: {
        community_database_binding_id: "cdb_01",
        community_id: "cmt_01",
        binding_role: "primary",
        organization_slug: "local-dev",
        group_name: "club-cmt_01",
        group_id: null,
        database_name: "main",
        database_id: null,
        database_url: `file://${dbPath}`,
        location: "local",
        status: "active",
        transferred_at: null,
        created_at: "2026-04-10T00:00:00Z",
        updated_at: "2026-04-10T00:00:00Z",
      },
    });

    const result = await joinCommunity({
      community: buildCommunity({ membership_mode: "request" }),
      user: buildUser(),
      env: buildEnv(),
      store,
      walletAttachments: [buildWallet()],
    });

    expect(result).toEqual({
      community_id: "cmt_01",
      status: "requested",
    });
    expect(readProjection()).toBeNull();
    expect(
      querySqliteValue(
        dbPath,
        "SELECT status FROM membership_requests WHERE community_id = 'cmt_01' AND applicant_user_id = 'usr_01' LIMIT 1;",
      ),
    ).toBe("pending");
  });

  test("reads membership gate rules from the canonical community db when a binding is active", async () => {
    const { dbPath } = createBootstrappedCommunityDb({ membershipMode: "gated" });
    runSqlite(
      dbPath,
      `
      INSERT INTO community_gate_rules (
        gate_rule_id,
        community_id,
        scope,
        gate_family,
        gate_type,
        proof_requirements_json,
        chain_namespace,
        gate_config_json,
        status,
        created_at,
        updated_at
      ) VALUES (
        'gate_canonical_01',
        'cmt_01',
        'membership',
        'token_holding',
        'erc721_holding',
        NULL,
        'eip155:1',
        '{"standard":"erc721","mode":"contract_any","chain_namespace":"eip155:1","contract_address":"0x2222222222222222222222222222222222222222"}',
        'active',
        '2026-04-10T00:00:00Z',
        '2026-04-10T00:00:00Z'
      );
      `,
    );

    globalThis.fetch = ((async () =>
      new Response(
        JSON.stringify({
          ownedNfts: [{ tokenId: "7", raw: { metadata: {} } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown) as typeof fetch;

    const { store, readProjection } = buildStore({
      activeBinding: {
        community_database_binding_id: "cdb_01",
        community_id: "cmt_01",
        binding_role: "primary",
        organization_slug: "local-dev",
        group_name: "club-cmt_01",
        group_id: null,
        database_name: "main",
        database_id: null,
        database_url: `file://${dbPath}`,
        location: "local",
        status: "active",
        transferred_at: null,
        created_at: "2026-04-10T00:00:00Z",
        updated_at: "2026-04-10T00:00:00Z",
      },
    });

    const result = await joinCommunity({
      community: buildCommunity({ membership_mode: "gated" }),
      user: buildUser({
        verification_capabilities_json: JSON.stringify({
          unique_human: { state: "unverified" },
          age_over_18: { state: "unverified" },
          nationality: { state: "unverified", value: null },
          gender: { state: "unverified", value: null },
          sanctions_clear: { state: "unverified" },
          wallet_score: { state: "unverified", passing_score: false, score: null },
        }),
      }),
      env: buildEnv({
        ALCHEMY_ETH_MAINNET_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/test-key",
      }),
      store,
      walletAttachments: [buildWallet()],
    });

    expect(result).toEqual({
      community_id: "cmt_01",
      status: "joined",
    });
    expect(readProjection()?.membership_state).toBe("member");
  });
});
