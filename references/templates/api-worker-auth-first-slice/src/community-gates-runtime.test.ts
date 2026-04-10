import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createFetchHandler } from "./runtime";
import { signPirateAccessToken } from "./lib/pirate-session-jwt";
import type { AuthBootstrapStore, AuthBootstrapTx, InsertAuditLogInput } from "./lib/db";
import type {
  CommunityGateRuleRow,
  CommunityMembershipProjectionRow,
  CommunityRow,
  UserRow,
  WalletAttachmentRow,
} from "./types/db";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("community gates runtime", () => {
  test("operator can provision an ERC-721 gate and an eligible user can join", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const communities = new Map<string, CommunityRow>([
      [
        "cmt_01",
        {
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
        },
      ],
    ]);
    const users = new Map<string, UserRow>([
      [
        "usr_01",
        {
          user_id: "usr_01",
          primary_wallet_attachment_id: "wal_01",
          verification_state: "verified",
          capability_provider: null,
          verification_capabilities_json: JSON.stringify({
            unique_human: { state: "unverified" },
            age_over_18: { state: "unverified" },
            nationality: { state: "unverified", value: null },
            gender: { state: "unverified", value: null },
            sanctions_clear: { state: "unverified" },
            wallet_score: { state: "unverified", passing_score: false, score: null },
          }),
          verified_at: null,
          nationality: null,
          current_verification_session_id: null,
          created_at: "2026-04-10T00:00:00Z",
          updated_at: "2026-04-10T00:00:00Z",
        },
      ],
    ]);
    const wallets = new Map<string, WalletAttachmentRow[]>([
      [
        "usr_01",
        [
          {
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
          },
        ],
      ],
    ]);
    const gateRules = new Map<string, CommunityGateRuleRow>();
    const projections = new Map<string, CommunityMembershipProjectionRow>();
    const audit: InsertAuditLogInput[] = [];

    const tx: Pick<
      AuthBootstrapTx,
      "upsertCommunityGateRule" | "insertAuditLog" | "upsertCommunityMembershipProjection" | "getCommunityGateRuleById"
    > = {
      async upsertCommunityGateRule(input) {
        gateRules.set(input.gate_rule_id, {
          gate_rule_id: input.gate_rule_id,
          community_id: input.community_id,
          scope: input.scope,
          gate_family: input.gate_family,
          gate_type: input.gate_type,
          proof_requirements_json: input.proof_requirements_json,
          chain_namespace: input.chain_namespace,
          gate_config_json: input.gate_config_json,
          status: input.status,
          created_at: input.created_at,
          updated_at: input.updated_at,
        });
      },
      async insertAuditLog(input) {
        audit.push(input);
      },
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return gateRules.get(gateRuleId) ?? null;
      },
      async upsertCommunityMembershipProjection(input) {
        projections.set(`${input.community_id}:${input.user_id}`, {
          projection_id: input.projection_id,
          community_id: input.community_id,
          user_id: input.user_id,
          membership_state: input.membership_state,
          role_summary_json: input.role_summary_json,
          source_updated_at: input.source_updated_at,
          created_at: input.created_at,
          updated_at: input.updated_at,
        });
      },
    };

    const store = {
      async withTransaction<T>(fn: (inner: AuthBootstrapTx) => Promise<T>): Promise<T> {
        return fn(tx as AuthBootstrapTx);
      },
      async getCommunityById(communityId: string): Promise<CommunityRow | null> {
        return communities.get(communityId) ?? null;
      },
      async listCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]> {
        return [...gateRules.values()].filter((rule) => rule.community_id === communityId);
      },
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return gateRules.get(gateRuleId) ?? null;
      },
      async listActiveCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]> {
        return [...gateRules.values()].filter((rule) => rule.community_id === communityId && rule.status === "active");
      },
      async getCommunityMembershipProjection(
        communityId: string,
        userId: string,
      ): Promise<CommunityMembershipProjectionRow | null> {
        return projections.get(`${communityId}:${userId}`) ?? null;
      },
      async getUser(userId: string): Promise<UserRow | null> {
        return users.get(userId) ?? null;
      },
      async listActiveWalletAttachments(userId: string): Promise<WalletAttachmentRow[]> {
        return wallets.get(userId) ?? [];
      },
    } as unknown as AuthBootstrapStore;

    const env = {
      CONTROL_PLANE_DATABASE_URL: "unused",
      AUTH_UPSTREAM_JWT_ISSUER: "unused",
      AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
      AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
      PIRATE_APP_JWT_ISSUER: "pirate-app",
      PIRATE_APP_JWT_AUDIENCE: "pirate-app",
      PIRATE_APP_JWT_PUBLIC_KEY: publicKey,
      PIRATE_APP_JWT_PRIVATE_KEY: privateKey,
      COMMUNITY_GATE_OPERATOR_AUTH_TOKEN: "operator-secret",
      ALCHEMY_ETH_MAINNET_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/test-key",
    } as const;

    const handler = createFetchHandler({
      env,
      store,
    });

    const provisionResponse = await handler(
      new Request("https://pirate.example/internal/communities/cmt_01/gate-rules", {
        method: "POST",
        headers: {
          authorization: "Bearer operator-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scope: "membership",
          gate_family: "token_holding",
          gate_type: "erc721_holding",
          gate_config: {
            standard: "erc721",
            mode: "contract_any",
            chain_namespace: "eip155:1",
            contract_address: "0x2222222222222222222222222222222222222222",
          },
        }),
      }),
    );
    expect(provisionResponse.status).toBe(200);
    const provisionedRule = (await provisionResponse.json()) as { gate_rule_id: string };

    const listResponse = await handler(
      new Request("https://pirate.example/internal/communities/cmt_01/gate-rules", {
        method: "GET",
        headers: {
          authorization: "Bearer operator-secret",
        },
      }),
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      expect.objectContaining({
        gate_rule_id: provisionedRule.gate_rule_id,
        scope: "membership",
        gate_family: "token_holding",
        gate_type: "erc721_holding",
      }),
    ]);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ownedNfts: [{ tokenId: "9", raw: { metadata: {} } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as unknown as typeof fetch;

    const accessToken = await signPirateAccessToken({
      userId: "usr_01",
      env,
      now: new Date(),
    });
    const joinResponse = await handler(
      new Request("https://pirate.example/communities/cmt_01/join", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      }),
    );

    expect(joinResponse.status).toBe(200);
    expect(await joinResponse.json()).toEqual({
      community_id: "cmt_01",
      status: "joined",
    });
    expect(projections.get("cmt_01:usr_01")?.membership_state).toBe("member");
    expect(audit.some((entry) => entry.action === "community.gate_rule_created")).toBe(true);
  });
});
