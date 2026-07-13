import { describe, expect, test } from "bun:test";
import { Resolver } from "node:dns/promises";

// Empty-zone mock of the PowerDNS HTTP API: every zone lookup 404s, which
// exercises the same "zone_not_provisioned" paths the SQLite fixture used to.
const pdnsMock = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return Response.json({ error: "Not Found" }, { status: 404 });
  },
});

Bun.env.PDNS_API_URL = `http://127.0.0.1:${pdnsMock.port}`;
Bun.env.PDNS_API_KEY = "test-key";
Bun.env.HNS_OWNER_MANAGED_RESOLVER_TIMEOUT_MS = "25";
Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "";
Bun.env.HNS_ROOT_RESOURCE_TIMEOUT_MS = "25";
Bun.env.HNS_CHAIN_RPC_URL = "";
Bun.env.HNS_CHAIN_RPC_TIMEOUT_MS = "25";
Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "";
Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "";

const { handleRequest } = await import("./server");

describe("hns verifier server", () => {
  const originalOwnerManagedResolvers = Bun.env.HNS_OWNER_MANAGED_RESOLVERS;
  const originalRootResourceUrlTemplate = Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE;
  const originalChainRpcUrl = Bun.env.HNS_CHAIN_RPC_URL;
  const originalChainRpcApiKey = Bun.env.HNS_CHAIN_RPC_API_KEY;
  const originalExpiryHorizonBlocks = Bun.env.HNS_EXPIRY_HORIZON_BLOCKS;
  const originalChainMaxTipAgeSeconds = Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS;
  const originalFetch = globalThis.fetch;
  const originalResolveNs = Resolver.prototype.resolveNs;
  const originalResolveTxt = Resolver.prototype.resolveTxt;

  function resetOwnerManagedProofs() {
    if (originalOwnerManagedResolvers == null) {
      delete Bun.env.HNS_OWNER_MANAGED_RESOLVERS;
    } else {
      Bun.env.HNS_OWNER_MANAGED_RESOLVERS = originalOwnerManagedResolvers;
    }
    if (originalRootResourceUrlTemplate == null) {
      delete Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE;
    } else {
      Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = originalRootResourceUrlTemplate;
    }
    if (originalChainRpcUrl == null) {
      delete Bun.env.HNS_CHAIN_RPC_URL;
    } else {
      Bun.env.HNS_CHAIN_RPC_URL = originalChainRpcUrl;
    }
    if (originalChainRpcApiKey == null) {
      delete Bun.env.HNS_CHAIN_RPC_API_KEY;
    } else {
      Bun.env.HNS_CHAIN_RPC_API_KEY = originalChainRpcApiKey;
    }
    if (originalExpiryHorizonBlocks == null) {
      delete Bun.env.HNS_EXPIRY_HORIZON_BLOCKS;
    } else {
      Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = originalExpiryHorizonBlocks;
    }
    if (originalChainMaxTipAgeSeconds == null) {
      delete Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS;
    } else {
      Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = originalChainMaxTipAgeSeconds;
    }
    globalThis.fetch = originalFetch;
    Resolver.prototype.resolveNs = originalResolveNs;
    Resolver.prototype.resolveTxt = originalResolveTxt;
  }

  function mockLiveResourceFetch({ rawHex }: { rawHex: string }) {
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return Response.json([
        "test",
        1,
        {
          html: `<div class="card-title"><strong class="highlight-green">Live</strong></div><div class="card decoded-raw"><div class="tab-raw">${rawHex}</div></div>`,
        },
      ]);
    }) as typeof fetch;
    return requested;
  }

  function mockRootAndChainFetch({
    rawHex,
    anchorHeight,
    expiryHeight,
    chainError = false,
    tipAgeSeconds = 60,
  }: {
    rawHex: string;
    anchorHeight: number;
    expiryHeight: number;
    chainError?: boolean;
    tipAgeSeconds?: number;
  }) {
    const requests: Array<{ url: string; authorization: string | null; method: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const method = init?.body ? (JSON.parse(String(init.body)) as { method?: string }).method ?? null : null;
      requests.push({ url, authorization: headers.get("authorization"), method });

      if (url === "https://chain.test") {
        if (chainError) {
          return Response.json({ error: { message: "unavailable" } });
        }
        if (method === "getnameinfo") {
          return Response.json({
            result: {
              info: {
                state: "CLOSED",
                stats: {
                  renewalPeriodEnd: expiryHeight,
                  blocksUntilExpire: expiryHeight - anchorHeight,
                },
              },
            },
          });
        }
        if (method === "getblockchaininfo") {
          return Response.json({
            result: {
              chain: "main",
              blocks: anchorHeight,
              headers: anchorHeight,
              bestblockhash: "ab".repeat(32),
              mediantime: Math.floor(Date.now() / 1000) - tipAgeSeconds,
            },
          });
        }
      }

      return Response.json([
        "test",
        1,
        {
          html: `<div class="card-title"><strong class="highlight-green">Live</strong></div><div class="card decoded-raw"><div class="tab-raw">${rawHex}</div></div>`,
        },
      ]);
    }) as typeof fetch;
    return requests;
  }

  test("exports a health handler", async () => {
    resetOwnerManagedProofs();
    const response = await handleRequest(new Request("http://127.0.0.1:4048/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.observation_provider).toBe("powerdns_api");
  });

  test("supports API-facing public inspect endpoint for punycode HNS roots", async () => {
    resetOwnerManagedProofs();
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root_label).toBe("xn--pokmon-dva");
    expect(body.zone_name).toBe("xn--pokmon-dva.");
    expect(body.challenge_name).toBe("_pirate.xn--pokmon-dva.");
    expect(body.zone_exists).toBe(false);
    expect(body.failure_reason).toBe("zone_not_provisioned");
  });

  test("supports underscores in HNS root labels", async () => {
    resetOwnerManagedProofs();
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=tame_impala&challenge_host=_pirate.tame_impala",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root_label).toBe("tame_impala");
    expect(body.zone_name).toBe("tame_impala.");
    expect(body.challenge_name).toBe("_pirate.tame_impala.");
    expect(body.zone_exists).toBe(false);
    expect(body.failure_reason).toBe("zone_not_provisioned");
  });

  test("normalizes Unicode HNS roots to the same public inspect result", async () => {
    resetOwnerManagedProofs();
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=pok%C3%A9mon&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root_label).toBe("xn--pokmon-dva");
    expect(body.zone_name).toBe("xn--pokmon-dva.");
  });

  test("fails closed when no owner-published observation path is configured", async () => {
    resetOwnerManagedProofs();
    const response = await handleRequest(new Request("http://127.0.0.1:4048/verify-txt-public", {
      method: "POST",
      body: JSON.stringify({
        root_label: "xn--pokmon-dva",
        challenge_host: "_pirate.xn--pokmon-dva",
        challenge_txt_value: "pirate-verification=nvs_test",
      }),
    }));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.verified).toBe(false);
    expect(body.failure_reason).toBe("ownership_observation_unavailable");
    expect(body.ownership_source).toBe(null);
    expect(body.root_control_verified).toBe(false);
  });

  test("verifies owner-managed ownership via the owner's authoritative DNS", async () => {
    resetOwnerManagedProofs();
    Bun.env.HNS_OWNER_MANAGED_RESOLVERS = "192.0.2.53";
    Resolver.prototype.resolveTxt = async function (name: string) {
      expect(name).toBe("_pirate.xn--pokmon-dva.");
      return [["pirate-verification=nvs_test"]];
    } as typeof Resolver.prototype.resolveTxt;
    Resolver.prototype.resolveNs = async () => ["ns9.owner.example"];

    const response = await handleRequest(new Request("http://127.0.0.1:4048/verify-txt-public", {
      method: "POST",
      body: JSON.stringify({
        root_label: "xn--pokmon-dva",
        challenge_host: "_pirate.xn--pokmon-dva",
        challenge_txt_value: "pirate-verification=nvs_test",
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verified).toBe(true);
    expect(body.ownership_source).toBe("owner_authoritative_dns_txt");
    expect(body.observation_provider).toBe("owner_authoritative_dns");
    expect(body.operation_class).toBe("owner_managed_namespace");
    expect(body.pirate_dns_authority_verified).toBe(false);

    resetOwnerManagedProofs();
  });

  test("authority-health reports unprovisioned zones without claiming ownership", async () => {
    resetOwnerManagedProofs();
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/authority-health?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.zone_provisioned).toBe(false);
    expect(body.challenge_present).toBe(false);
    expect(body.challenge_served).toBe(null);
    expect(body.observation_provider).toBe("powerdns_api");
    expect("verified" in body).toBe(false);
    expect("root_control_verified" in body).toBe(false);
  });

  test("public inspect can read owner-managed HNS root resources", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    const requested = mockLiveResourceFetch({
      rawHex: "0001036e7331067069726174650006011c7069726174652d766572696669636174696f6e3d6e76735f74657374",
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root_label).toBe("xn--pokmon-dva");
    expect(body.zone_exists).toBe(true);
    expect(body.challenge_present).toBe(true);
    expect(body.nameservers).toEqual(["ns1.pirate."]);
    expect(body.observation_provider).toBe("hns_parent_chain");
    expect(body.pirate_dns_authority_verified).toBe(true);
    expect(body.operation_class).toBe("owner_managed_namespace");
    expect(body.challenge_name).toBe("xn--pokmon-dva.");
    expect(body.expiry_horizon_sufficient).toBe(null);
    expect(body.expiry_height).toBe(null);
    expect(body.expiry_observation_provider).toBe(null);
    expect(requested).toEqual(["https://example.test/name/xn--pokmon-dva/resources?fetch=main"]);

    resetOwnerManagedProofs();
  });

  test("derives expiry horizon from hsd name state and an anchored chain tip", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    const requests = mockRootAndChainFetch({
      rawHex: "0001036e7331067069726174650006011c7069726174652d766572696669636174696f6e3d6e76735f74657374",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expiry_horizon_sufficient).toBe(true);
    expect(body.expiry_height).toBe(12_500);
    expect(body.expiry_anchor_height).toBe(10_000);
    expect(body.expiry_anchor_block_hash).toBe("ab".repeat(32));
    expect(body.expiry_chain_network).toBe("main");
    expect(body.expiry_blocks_remaining).toBe(2_500);
    expect(body.expiry_horizon_blocks).toBe(1_000);
    expect(body.expiry_observation_provider).toBe("hsd_json_rpc");
    expect(requests.filter((request) => request.url === "https://chain.test").map((request) => request.method).sort())
      .toEqual(["getblockchaininfo", "getnameinfo"]);
    expect(requests.find((request) => request.method === "getnameinfo")?.authorization)
      .toBe(`Basic ${Buffer.from("x:rpc-secret").toString("base64")}`);

    resetOwnerManagedProofs();
  });

  test("reports a known insufficient horizon instead of equating root existence with safety", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "0001036e7331067069726174650006011c7069726174652d766572696669636174696f6e3d6e76735f74657374",
      anchorHeight: 10_000,
      expiryHeight: 10_500,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    const body = await response.json();
    expect(body.root_exists).toBe(true);
    expect(body.expiry_horizon_sufficient).toBe(false);
    expect(body.expiry_blocks_remaining).toBe(500);

    resetOwnerManagedProofs();
  });

  test("fails expiry closed when the configured chain observer cannot provide evidence", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "0001036e7331067069726174650006011c7069726174652d766572696669636174696f6e3d6e76735f74657374",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      chainError: true,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    const body = await response.json();
    expect(body.root_exists).toBe(true);
    expect(body.expiry_horizon_sufficient).toBe(null);
    expect(body.expiry_height).toBe(null);
    expect(body.expiry_horizon_blocks).toBe(1_000);
    expect(body.expiry_observation_provider).toBe("hsd_json_rpc");

    resetOwnerManagedProofs();
  });

  test("fails expiry closed when the chain observer tip is stale", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "0001036e7331067069726174650006011c7069726174652d766572696669636174696f6e3d6e76735f74657374",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      tipAgeSeconds: 7_200,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    const body = await response.json();
    expect(body.root_exists).toBe(true);
    expect(body.expiry_horizon_sufficient).toBe(null);
    expect(body.expiry_observation_provider).toBe("hsd_json_rpc");

    resetOwnerManagedProofs();
  });

  test("public TXT verification can verify owner-managed HNS root resource TXT", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "0001036e7331067069726174650006011c7069726174652d766572696669636174696f6e3d6e76735f74657374",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
    });

    const response = await handleRequest(new Request("http://127.0.0.1:4048/verify-txt-public", {
      method: "POST",
      body: JSON.stringify({
        root_label: "xn--pokmon-dva",
        challenge_host: "_pirate.xn--pokmon-dva",
        challenge_txt_value: "pirate-verification=nvs_test",
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verified).toBe(true);
    expect(body.observation_provider).toBe("hns_parent_chain");
    expect(body.observed_values).toEqual(["pirate-verification=nvs_test"]);
    expect(body.root_control_verified).toBe(true);
    expect(body.expiry_horizon_sufficient).toBe(true);
    expect(body.expiry_height).toBe(12_500);
    expect(body.expiry_blocks_remaining).toBe(2_500);
    expect(body.challenge_name).toBe("xn--pokmon-dva.");

    resetOwnerManagedProofs();
  });

  test("owner-managed root resource lookups time out inside the verifier budget", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;

    const startedAt = Date.now();
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.observation_provider).toBe("hns_parent_chain");
    expect(body.failure_reason).toBe("root_resource_unavailable");
    expect(body.zone_exists).toBe(false);

    resetOwnerManagedProofs();
  });
});
