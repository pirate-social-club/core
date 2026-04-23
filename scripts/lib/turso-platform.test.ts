import { describe, expect, test } from "bun:test";
import { TursoPlatformClient, TursoPlatformError } from "./turso-platform";

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

describe("turso platform client", () => {
  test("validates api tokens", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          method: String(init?.method ?? "GET"),
        });
        return response({ exp: 999 });
      },
    });

    await expect(client.validateApiToken()).resolves.toEqual({ exp: 999 });
    expect(requests).toEqual([
      {
        url: "https://api.turso.tech/v1/auth/validate",
        method: "GET",
      },
    ]);
  });

  test("creates groups with the documented endpoint shape", async () => {
    let capturedBody: string | null = null;
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async (_url, init) => {
        capturedBody = String(init?.body ?? null);
        return response({
          group: {
            name: "region-iad",
            uuid: "grp_01",
            locations: ["aws-us-east-1"],
            primary: "us-east-1",
            delete_protection: false,
          },
        });
      },
    });

    await expect(
      client.createGroup({
        organizationSlug: "demo-org",
        groupName: "region-iad",
        location: "iad",
      }),
    ).resolves.toMatchObject({
      name: "region-iad",
      uuid: "grp_01",
      locations: ["aws-us-east-1"],
      primary: "us-east-1",
      deleteProtection: false,
    });
    expect(capturedBody).toBe(JSON.stringify({ name: "region-iad", location: "iad" }));
  });

  test("normalizes database hostnames into libsql urls", async () => {
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async () =>
        response({
          database: {
            Name: "main",
            DbId: "db_01",
            Hostname: "region-iad-demo-org.turso.io",
            group: "region-iad",
            primaryRegion: "iad",
            regions: ["iad"],
            delete_protection: false,
          },
        }),
    });

    await expect(
      client.createDatabase({
        organizationSlug: "demo-org",
        databaseName: "main",
        groupName: "region-iad",
      }),
    ).resolves.toMatchObject({
      name: "main",
      dbId: "db_01",
      hostname: "region-iad-demo-org.turso.io",
      libsqlUrl: "libsql://region-iad-demo-org.turso.io",
      deleteProtection: false,
    });
  });

  test("patches group delete protection through the configuration endpoint", async () => {
    let capturedUrl = "";
    let capturedBody: string | null = null;
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async (url, init) => {
        capturedUrl = String(url);
        capturedBody = String(init?.body ?? null);
        return response({ delete_protection: true });
      },
    });

    await expect(
      client.updateGroupConfiguration({
        organizationSlug: "demo-org",
        groupName: "region-iad",
        deleteProtection: true,
      }),
    ).resolves.toMatchObject({
      deleteProtection: true,
    });
    expect(capturedUrl).toBe(
      "https://api.turso.tech/v1/organizations/demo-org/groups/region-iad/configuration",
    );
    expect(capturedBody).toBe(JSON.stringify({ delete_protection: true }));
  });

  test("patches database delete protection through the configuration endpoint", async () => {
    let capturedUrl = "";
    let capturedBody: string | null = null;
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async (url, init) => {
        capturedUrl = String(url);
        capturedBody = String(init?.body ?? null);
        return response({ delete_protection: true });
      },
    });

    await expect(
      client.updateDatabaseConfiguration({
        organizationSlug: "demo-org",
        databaseName: "main",
        deleteProtection: true,
      }),
    ).resolves.toMatchObject({
      deleteProtection: true,
    });
    expect(capturedUrl).toBe(
      "https://api.turso.tech/v1/organizations/demo-org/databases/main/configuration",
    );
    expect(capturedBody).toBe(JSON.stringify({ delete_protection: true }));
  });

  test("passes expiration and authorization when minting db tokens", async () => {
    const urls: string[] = [];
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async (url) => {
        urls.push(String(url));
        return response({ jwt: "db-token" });
      },
    });

    await expect(
      client.createDatabaseAuthToken({
        organizationSlug: "demo-org",
        databaseName: "main",
        expiration: "2w",
        authorization: "full-access",
      }),
    ).resolves.toEqual({ jwt: "db-token" });
    expect(urls[0]).toBe(
      "https://api.turso.tech/v1/organizations/demo-org/databases/main/auth/tokens?expiration=2w&authorization=full-access",
    );
  });

  test("deletes databases with the documented endpoint shape", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          method: String(init?.method ?? "GET"),
        });
        return response(null, { status: 204 });
      },
    });

    await expect(
      client.deleteDatabase({
        organizationSlug: "demo-org",
        databaseName: "main",
      }),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        url: "https://api.turso.tech/v1/organizations/demo-org/databases/main",
        method: "DELETE",
      },
    ]);
  });

  test("deletes groups with the documented endpoint shape", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          method: String(init?.method ?? "GET"),
        });
        return response(null, { status: 204 });
      },
    });

    await expect(
      client.deleteGroup({
        organizationSlug: "demo-org",
        groupName: "region-iad",
      }),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        url: "https://api.turso.tech/v1/organizations/demo-org/groups/region-iad",
        method: "DELETE",
      },
    ]);
  });

  test("handles transfer responses with or without a group envelope", async () => {
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async () =>
        response({
          name: "region-iad",
          uuid: "grp_01",
          locations: ["aws-us-east-1"],
          primary: "us-east-1",
          delete_protection: false,
        }),
    });

    await expect(
      client.transferGroup({
        organizationSlug: "demo-org",
        groupName: "region-iad",
        targetOrganizationSlug: "new-org",
      }),
    ).resolves.toMatchObject({
      name: "region-iad",
      uuid: "grp_01",
    });
  });

  test("surfaces structured api failures", async () => {
    const client = new TursoPlatformClient({
      apiToken: "token",
      fetch: async () =>
        response(
          {
            error: "group not found",
          },
          {
            status: 404,
          },
        ),
    });

    await expect(
      client.invalidateGroupAuthTokens({
        organizationSlug: "demo-org",
        groupName: "missing",
      }),
    ).rejects.toEqual(
      expect.objectContaining<TursoPlatformError>({
        message: "group not found",
        status: 404,
        method: "POST",
        path: "/v1/organizations/demo-org/groups/missing/auth/rotate",
      }),
    );
  });
});
