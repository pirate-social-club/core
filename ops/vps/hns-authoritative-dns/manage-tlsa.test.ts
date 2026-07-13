import { afterAll, describe, expect, test } from "bun:test";

import { readVerifierTlsaConfiguration } from "./manage-tlsa";

const ASSOCIATION = `3 1 1 ${"a".repeat(64)}`;
let responseStatus = 200;
let responseBody: unknown = {
  ok: true,
  pdns_api_url: "http://127.0.0.1:8081",
  authoritative_tlsa_associations: [ASSOCIATION],
  authoritative_tlsa_ttl: 300,
  requires_bearer_auth: true,
};
let authorization: string | null = null;

const verifier = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    authorization = request.headers.get("authorization");
    return Response.json(responseBody, { status: responseStatus });
  },
});

afterAll(() => verifier.stop(true));

describe("TLSA operator verifier configuration", () => {
  test("authenticates and reads the running verifier association set and TTL", async () => {
    responseStatus = 200;
    responseBody = {
      ok: true,
      pdns_api_url: "http://127.0.0.1:8081",
      authoritative_tlsa_associations: [ASSOCIATION],
      authoritative_tlsa_ttl: 300,
      requires_bearer_auth: true,
    };

    const result = await readVerifierTlsaConfiguration({
      url: `http://127.0.0.1:${verifier.port}/`,
      token: "operator-token",
      expectedPdnsApiUrl: "http://127.0.0.1:8081/",
    });

    expect(authorization).toBe("Bearer operator-token");
    expect(result).toEqual({
      associations: [`3 1 1 ${"A".repeat(64)}`],
      ttlSeconds: 300,
    });
  });

  test("fails closed when the runtime endpoint is unavailable or incomplete", async () => {
    responseStatus = 503;
    await expect(readVerifierTlsaConfiguration({
      url: `http://127.0.0.1:${verifier.port}`,
      token: "operator-token",
      expectedPdnsApiUrl: "http://127.0.0.1:8081",
    })).rejects.toThrow("status 503");

    responseStatus = 200;
    responseBody = {
      ok: true,
      pdns_api_url: "http://127.0.0.1:8081",
      authoritative_tlsa_ttl: 300,
      requires_bearer_auth: true,
    };
    await expect(readVerifierTlsaConfiguration({
      url: `http://127.0.0.1:${verifier.port}`,
      token: "operator-token",
      expectedPdnsApiUrl: "http://127.0.0.1:8081",
    })).rejects.toThrow("does not expose its active TLSA associations");

    responseBody = {
      ok: true,
      pdns_api_url: "http://127.0.0.1:8081",
      authoritative_tlsa_associations: [ASSOCIATION],
      authoritative_tlsa_ttl: 300,
      requires_bearer_auth: false,
    };
    await expect(readVerifierTlsaConfiguration({
      url: `http://127.0.0.1:${verifier.port}`,
      token: "operator-token",
      expectedPdnsApiUrl: "http://127.0.0.1:8081",
    })).rejects.toThrow("not enforcing bearer authentication");

    responseBody = {
      ok: true,
      pdns_api_url: "http://127.0.0.1:9999",
      authoritative_tlsa_associations: [ASSOCIATION],
      authoritative_tlsa_ttl: 300,
      requires_bearer_auth: true,
    };
    await expect(readVerifierTlsaConfiguration({
      url: `http://127.0.0.1:${verifier.port}`,
      token: "operator-token",
      expectedPdnsApiUrl: "http://127.0.0.1:8081",
    })).rejects.toThrow("target different PowerDNS APIs");
  });
});
