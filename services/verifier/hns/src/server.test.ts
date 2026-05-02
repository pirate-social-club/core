import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Resolver } from "node:dns/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

Bun.env.PDNS_SQLITE_DATABASE = createPowerDnsTestDatabase();
Bun.env.HNS_OWNER_MANAGED_RESOLVER_TIMEOUT_MS = "25";
Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "";
Bun.env.HNS_ROOT_RESOURCE_TIMEOUT_MS = "25";

const { handleRequest } = await import("./server");

function createPowerDnsTestDatabase(): string {
  const path = join(mkdtempSync(join(tmpdir(), "pirate-hns-verifier-")), "pdns.sqlite3");
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec(`
      CREATE TABLE domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL
      );

      CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        ttl INTEGER,
        prio INTEGER,
        disabled INTEGER NOT NULL DEFAULT 0,
        ordername TEXT,
        auth INTEGER NOT NULL DEFAULT 1
      );
    `);
  } finally {
    db.close();
  }
  return path;
}

describe("hns verifier server", () => {
  const originalOwnerManagedResolvers = Bun.env.HNS_OWNER_MANAGED_RESOLVERS;
  const originalRootResourceUrlTemplate = Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE;
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

  test("exports a health handler", async () => {
    resetOwnerManagedProofs();
    const response = await handleRequest(new Request("http://127.0.0.1:4048/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.observation_provider).toBe("powerdns_sqlite");
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

  test("supports API-facing public TXT verification endpoint", async () => {
    resetOwnerManagedProofs();
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
    expect(body.verified).toBe(false);
    expect(body.failure_reason).toBe("zone_not_provisioned");
    expect(body.root_exists).toBe(false);
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
    expect(requested).toEqual(["https://example.test/name/xn--pokmon-dva/resources?fetch=main"]);

    resetOwnerManagedProofs();
  });

  test("public TXT verification can verify owner-managed HNS root resource TXT", async () => {
    Bun.env.HNS_ROOT_RESOURCE_URL_TEMPLATE = "https://example.test/name/{root}/resources?fetch=main";
    mockLiveResourceFetch({
      rawHex: "0001036e7331067069726174650006011c7069726174652d766572696669636174696f6e3d6e76735f74657374",
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
