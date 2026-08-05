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
Bun.env.HNS_CHAIN_RPC_URL = "";
Bun.env.HNS_CHAIN_RPC_TIMEOUT_MS = "25";
Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "";
Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "";

const { handleRequest } = await import("./server");

describe("hns verifier server", () => {
  const originalOwnerManagedResolvers = Bun.env.HNS_OWNER_MANAGED_RESOLVERS;
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
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(String(input));
      const method = init?.body ? (JSON.parse(String(init.body)) as { method?: string }).method : null;
      return method === "getnameresource"
        ? Response.json({ result: resourceRecordsFromHex(rawHex) })
        : Response.json({ error: { message: "unexpected method" } });
    }) as typeof fetch;
    return requested;
  }

  function resourceRecordsFromHex(rawHex: string) {
    const buffer = Buffer.from(rawHex, "hex");
    const records: Array<Record<string, unknown>> = [];
    let offset = buffer[0] === 0 ? 1 : 0;
    const readName = () => {
      const labels: string[] = [];
      while (offset < buffer.length) {
        const length = buffer[offset++] ?? 0;
        if (length === 0) return `${labels.join(".")}.`;
        labels.push(buffer.subarray(offset, offset + length).toString("ascii"));
        offset += length;
      }
      throw new Error("invalid fixture name");
    };
    while (offset < buffer.length) {
      const type = buffer[offset++];
      if (type === 1) records.push({ type: "NS", ns: readName() });
      else if (type === 6) {
        const txt: string[] = [];
        const count = buffer[offset++] ?? 0;
        for (let index = 0; index < count; index += 1) {
          const length = buffer[offset++] ?? 0;
          txt.push(buffer.subarray(offset, offset + length).toString("utf8"));
          offset += length;
        }
        records.push({ type: "TXT", txt });
      } else throw new Error(`unsupported fixture record ${type}`);
    }
    return { records };
  }

  function mockRootAndChainFetch({
    rawHex,
    anchorHeight,
    expiryHeight,
    chainError = false,
    rootExists = true,
    rootResourceError = false,
    tipAgeSeconds = 60,
    medianTipAgeSeconds = tipAgeSeconds,
    nameState = "CLOSED",
    registered = rootExists,
    expired = false,
    renewals = 1,
    verificationProgress = 1,
  }: {
    rawHex: string;
    anchorHeight: number;
    expiryHeight: number;
    chainError?: boolean;
    rootExists?: boolean;
    rootResourceError?: boolean;
    tipAgeSeconds?: number;
    medianTipAgeSeconds?: number;
    nameState?: string;
    registered?: boolean;
    expired?: boolean;
    renewals?: number;
    verificationProgress?: number;
  }) {
    const requests: Array<{ url: string; authorization: string | null; method: string | null }> = [];
    const observedAtSeconds = Math.floor(Date.now() / 1000);
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
              info: rootExists ? {
                state: nameState,
                registered,
                expired,
                renewals,
                stats: {
                  renewalPeriodEnd: expiryHeight,
                  blocksUntilExpire: expiryHeight - anchorHeight,
                },
              } : null,
            },
          });
        }
        if (method === "getnameresource") {
          return rootResourceError
            ? Response.json({ error: { message: "unavailable" } })
            : Response.json({ result: resourceRecordsFromHex(rawHex) });
        }
        if (method === "getblockchaininfo") {
          return Response.json({
            result: {
              chain: "main",
              blocks: anchorHeight,
              headers: anchorHeight,
              bestblockhash: "ab".repeat(32),
              mediantime: observedAtSeconds - medianTipAgeSeconds,
              verificationprogress: verificationProgress,
            },
          });
        }
        if (method === "getblockheader") {
          return Response.json({
            result: {
              hash: "ab".repeat(32),
              height: anchorHeight,
              time: observedAtSeconds - tipAgeSeconds,
              mediantime: observedAtSeconds - medianTipAgeSeconds,
              confirmations: 1,
            },
          });
        }
      }

      return Response.json({ error: { message: "unexpected URL" } });
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
    expect(body.authoritative_secure_new_zones).toBe(false);
    expect(body.authoritative_tlsa_associations).toEqual([]);
    expect(body.authoritative_tlsa_ttl).toBe(300);
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

  test("returns parent NS, glue, and DS from a fresh local HSD anchor", async () => {
    resetOwnerManagedProofs();
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_CHAIN_NETWORK = "main";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "100";
    const nowSeconds = Math.floor(Date.now() / 1000);
    const anchorHash = "ab".repeat(32);

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.body
        ? (JSON.parse(String(init.body)) as { method?: string }).method
        : null;
      if (method === "getnameresource") {
        return Response.json({
          result: {
            records: [
              { type: "NS", ns: "ns1.pirate." },
              { type: "NS", ns: "ns2.pirate." },
              { type: "GLUE4", ns: "ns1.pirate.", address: "192.0.2.10" },
              { type: "GLUE6", ns: "ns2.pirate.", address: "2001:db8::20" },
              {
                type: "DS",
                keyTag: 12345,
                algorithm: 13,
                digestType: 2,
                digest: "AABBCCDD",
              },
            ],
          },
        });
      }
      if (method === "getnameinfo") {
        return Response.json({
          result: {
            info: {
              state: "CLOSED",
              registered: true,
              expired: false,
              stats: { renewalPeriodEnd: 1_500, blocksUntilExpire: 500 },
            },
          },
        });
      }
      if (method === "getblockchaininfo") {
        return Response.json({
          result: {
            chain: "main",
            blocks: 1_000,
            headers: 1_000,
            bestblockhash: anchorHash,
            mediantime: nowSeconds - 60,
            verificationprogress: 1,
          },
        });
      }
      if (method === "getblockheader") {
        return Response.json({
          result: {
            hash: anchorHash,
            height: 1_000,
            time: nowSeconds - 30,
            mediantime: nowSeconds - 60,
            confirmations: 1,
          },
        });
      }
      return Response.json({ error: { message: "unexpected method" } });
    }) as typeof fetch;

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/observe-root-parent?root_label=pirate",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      root_label: "pirate",
      zone_name: "pirate.",
      provider: "hsd_json_rpc",
      chain_anchor: {
        network: "main",
        height: 1_000,
        block_hash: anchorHash,
        median_time: nowSeconds - 60,
      },
      parent: {
        nameservers: ["ns1.pirate.", "ns2.pirate."],
        ds_records: [{
          key_tag: 12345,
          algorithm: 13,
          digest_type: 2,
          digest: "aabbccdd",
        }],
        glue4: [{ nameserver: "ns1.pirate.", address: "192.0.2.10" }],
        glue6: [{ nameserver: "ns2.pirate.", address: "2001:db8::20" }],
      },
    });
    expect(Number.isNaN(Date.parse(body.observed_at))).toBe(false);
  });

  test("fails parent observation closed on malformed DS evidence", async () => {
    resetOwnerManagedProofs();
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "100";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.body
        ? (JSON.parse(String(init.body)) as { method?: string }).method
        : null;
      if (method === "getnameresource") {
        return Response.json({
          result: {
            records: [{
              type: "DS",
              keyTag: 12345,
              algorithm: 13,
              digestType: 2,
              digest: "not-hex",
            }],
          },
        });
      }
      return Response.json({ error: { message: "unavailable" } });
    }) as typeof fetch;

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/observe-root-parent?root_label=pirate",
    ));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "HNS chain RPC returned an invalid root resource",
    });
  });

  test("rejects root labels outside the hsd covenant grammar", async () => {
    for (const rootLabel of ["_leading", "trailing_", "-leading", "trailing-", "a".repeat(64), "localhost"]) {
      const response = await handleRequest(new Request(
        `http://127.0.0.1:4048/inspect-public?root_label=${encodeURIComponent(rootLabel)}`,
      ));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "root_label must be a single Handshake TLD label",
      });
    }
  });

  test("rejects malformed punycode allowed by the raw consensus grammar", async () => {
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--0",
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "root_label must be a single Handshake TLD label",
    });
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
    expect(body.root_exists).toBe(null);
    expect(body.operation_class).toBe(null);
    expect(body.control_class).toBe(null);
    expect(body.pirate_dns_authority_verified).toBe(false);

    resetOwnerManagedProofs();
  });

  test("does not mistake an owner-side apex NS answer for on-chain delegation", async () => {
    resetOwnerManagedProofs();
    Bun.env.HNS_OWNER_MANAGED_RESOLVERS = "192.0.2.53";
    mockLiveResourceFetch({
      rawHex: "000601056f74686572",
    });
    Resolver.prototype.resolveTxt = async () => [["pirate-verification=nvs_test"]];
    Resolver.prototype.resolveNs = async () => ["ns1.pirate", "ns2.pirate"];

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
    expect(Array.isArray(body.owner_dns_nameservers)).toBe(true);
    expect(body.pirate_dns_authority_verified).toBe(false);
    expect(body.routing_enabled).toBe(false);

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
    expect(requested).toEqual(["https://chain.test"]);

    resetOwnerManagedProofs();
  });

  test("derives expiry horizon for a renewed CLOSED root from an anchored chain tip", async () => {
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
    expect(body.expiry_root_exists).toBe(true);
    expect(body.expiry_height).toBe(12_500);
    expect(body.expiry_anchor_height).toBe(10_000);
    expect(body.expiry_anchor_block_hash).toBe("ab".repeat(32));
    expect(body.expiry_chain_network).toBe("main");
    expect(body.expiry_blocks_remaining).toBe(2_500);
    expect(body.expiry_horizon_blocks).toBe(1_000);
    expect(body.expiry_observation_provider).toBe("hsd_json_rpc");
    expect(requests.filter((request) => request.url === "https://chain.test").map((request) => request.method).sort())
      .toEqual(["getblockchaininfo", "getblockheader", "getnameinfo", "getnameresource"]);
    expect(requests.find((request) => request.method === "getnameinfo")?.authorization)
      .toBe(`Basic ${Buffer.from("x:rpc-secret").toString("base64")}`);

    resetOwnerManagedProofs();
  });

  test("does not treat HSD's historical expired bit as current lease expiry", async () => {
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "0001036e73310670697261746500",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      nameState: "CLOSED",
      registered: true,
      expired: true,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/observe-root-parent?root_label=pirate",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expiry_root_exists).toBeUndefined();
    expect(body.chain_anchor).toMatchObject({
      network: "main",
      height: 10_000,
    });

    resetOwnerManagedProofs();
  });

  test("uses anchored name state when the observer cannot return a root resource", async () => {
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      rootResourceError: true,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva",
    ));

    const body = await response.json();
    expect(body.root_exists).toBe(true);
    expect(body.zone_exists).toBe(false);
    expect(body.expiry_root_exists).toBe(true);
    expect(body.expiry_horizon_sufficient).toBe(true);

    resetOwnerManagedProofs();
  });

  test("reports an absent chain root as definitively insufficient", async () => {
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      rootExists: false,
      rootResourceError: true,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva",
    ));

    const body = await response.json();
    expect(body.root_exists).toBe(false);
    expect(body.expiry_root_exists).toBe(false);
    expect(body.expiry_horizon_sufficient).toBe(false);
    expect(body.expiry_anchor_height).toBe(10_000);
    expect(body.expiry_observation_provider).toBe("hsd_json_rpc");

    resetOwnerManagedProofs();
  });

  test("reports a known insufficient horizon instead of equating root existence with safety", async () => {
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
    expect(body.root_exists).toBe(null);
    expect(body.expiry_horizon_sufficient).toBe(null);
    expect(body.expiry_height).toBe(null);
    expect(body.expiry_horizon_blocks).toBe(1_000);
    expect(body.expiry_observation_provider).toBe("hsd_json_rpc");

    resetOwnerManagedProofs();
  });

  test("fails expiry closed when the chain observer tip is stale", async () => {
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

  test("uses best-block time instead of lagging median time for tip freshness", async () => {
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "0001036e73310670697261746500",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      tipAgeSeconds: 60,
      medianTipAgeSeconds: 7_200,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva",
    ));
    const body = await response.json();
    expect(body.expiry_root_exists).toBe(true);
    expect(body.expiry_horizon_sufficient).toBe(true);
    expect(body.expiry_anchor_median_time).toBeLessThan(Math.floor(Date.now() / 1000) - 3_600);

    resetOwnerManagedProofs();
  });

  test("rejects an early-IBD chain even when hsd reports blocks equal to headers", async () => {
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";
    mockRootAndChainFetch({
      rawHex: "0001036e73310670697261746500",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      verificationProgress: 0.5,
    });

    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva",
    ));
    const body = await response.json();
    expect(body.expiry_root_exists).toBe(null);
    expect(body.expiry_horizon_sufficient).toBe(null);
    expect(body.expiry_observation_provider).toBe("hsd_json_rpc");

    resetOwnerManagedProofs();
  });

  test("distinguishes unsafe unregistered states from indeterminate non-CLOSED states", async () => {
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    Bun.env.HNS_EXPIRY_HORIZON_BLOCKS = "1000";
    Bun.env.HNS_CHAIN_MAX_TIP_AGE_SECONDS = "3600";

    for (const nameState of ["OPENING", "BIDDING", "REVEAL", "CLOSED"]) {
      mockRootAndChainFetch({
        rawHex: "",
        anchorHeight: 10_000,
        expiryHeight: 12_500,
        nameState,
        registered: false,
        rootResourceError: true,
      });
      const response = await handleRequest(new Request(
        "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva",
      ));
      const body = await response.json();
      expect(body.expiry_root_exists).toBe(false);
      expect(body.expiry_horizon_sufficient).toBe(false);
    }

    mockRootAndChainFetch({
      rawHex: "",
      anchorHeight: 10_000,
      expiryHeight: 12_500,
      nameState: "REVOKED",
      registered: true,
      rootResourceError: true,
    });
    const revokedResponse = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva",
    ));
    expect((await revokedResponse.json()).expiry_root_exists).toBe(false);

    for (const nameState of ["LOCKED", "UNRECOGNIZED"]) {
      mockRootAndChainFetch({
        rawHex: "",
        anchorHeight: 10_000,
        expiryHeight: 12_500,
        nameState,
        registered: false,
        rootResourceError: true,
      });
      const response = await handleRequest(new Request(
        "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva",
      ));
      const body = await response.json();
      expect(body.expiry_root_exists).toBe(null);
      expect(body.expiry_horizon_sufficient).toBe(null);
    }

    resetOwnerManagedProofs();
  });

  test("public TXT verification can verify owner-managed HNS root resource TXT", async () => {
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
    Bun.env.HNS_CHAIN_RPC_URL = "https://chain.test";
    Bun.env.HNS_CHAIN_RPC_API_KEY = "rpc-secret";
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;

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
