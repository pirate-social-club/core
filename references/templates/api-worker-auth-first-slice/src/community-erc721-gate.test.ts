import { describe, expect, test } from "bun:test";
import {
  evaluateErc721GateForWalletAttachments,
  parseErc721GateConfig,
} from "./lib/community-erc721-gate";
import type { WalletAttachmentRow } from "./types/db";
import type { Env } from "./types/env";

function buildEnv(overrides?: Partial<Env>): Env {
  return {
    CONTROL_PLANE_DATABASE_URL: "postgres://example",
    AUTH_UPSTREAM_JWT_ISSUER: "issuer",
    AUTH_UPSTREAM_JWT_AUDIENCE: "aud",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: "secret",
    PIRATE_APP_JWT_ISSUER: "pirate",
    PIRATE_APP_JWT_AUDIENCE: "pirate-aud",
    PIRATE_APP_JWT_PUBLIC_KEY: "public",
    PIRATE_APP_JWT_PRIVATE_KEY: "private",
    ALCHEMY_ETH_MAINNET_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/test-key",
    ...overrides,
  };
}

function buildWalletAttachment(overrides?: Partial<WalletAttachmentRow>): WalletAttachmentRow {
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

describe("ERC-721 community gate", () => {
  test("rejects invalid token IDs in allowlists with a clear parse error", () => {
    expect(() =>
      parseErc721GateConfig({
        standard: "erc721",
        mode: "token_id_allowlist",
        chain_namespace: "eip155:1",
        contract_address: "0x2222222222222222222222222222222222222222",
        token_ids: ["not-a-token-id"],
      }),
    ).toThrow("Invalid token ID: not-a-token-id");
  });

  test("short-circuits contract_any after the first matching page", async () => {
    let fetchCalls = 0;
    const result = await evaluateErc721GateForWalletAttachments({
      env: buildEnv(),
      walletAttachments: [buildWalletAttachment()],
      rawGateConfig: {
        standard: "erc721",
        mode: "contract_any",
        chain_namespace: "eip155:1",
        contract_address: "0x2222222222222222222222222222222222222222",
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            ownedNfts: [
              {
                tokenId: "1",
                name: "Example NFT",
                raw: { metadata: {} },
              },
            ],
            pageKey: "should-not-be-used",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(result.status).toBe("passed");
    expect(result.matched_token_id).toBe("1");
    expect(fetchCalls).toBe(1);
  });

  test("returns unavailable when paginated ownership lookup exceeds the hard page cap", async () => {
    let fetchCalls = 0;
    const result = await evaluateErc721GateForWalletAttachments({
      env: buildEnv(),
      walletAttachments: [buildWalletAttachment()],
      rawGateConfig: {
        standard: "erc721",
        mode: "metadata_match",
        chain_namespace: "eip155:1",
        contract_address: "0x2222222222222222222222222222222222222222",
        text_terms: ["charizard"],
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            ownedNfts: [],
            pageKey: fetchCalls < 20 ? `page-${fetchCalls}` : undefined,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("exceeded 10 pages");
    expect(fetchCalls).toBe(10);
  });
});
