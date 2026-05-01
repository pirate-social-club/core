import { describe, expect, test } from "bun:test";
import { handleRequest } from "./server";

describe("hns verifier server", () => {
  test("exports a health handler", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:4048/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.observation_provider).toBe("web3dns_json_doh");
  });

  test("inspects public nameserver delegation through configured JSON resolvers", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      expect(url.searchParams.get("type")).toBe("NS");
      return Response.json({
        Status: 0,
        Responder: "test-resolver",
        Answer: [
          { name: "example.", type: 2, typename: "NS", TTL: 300, data: "ns1.pirate." },
        ],
      });
    };

    try {
      const response = await handleRequest(new Request("http://127.0.0.1:4048/inspect-public?root_label=example"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.observation_provider).toBe("web3dns_json_doh");
      expect(body.pirate_dns_authority_verified).toBe(true);
      expect(body.failure_reason).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails closed when public resolver lookup fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("upstream failure", { status: 503 });

    try {
      const response = await handleRequest(new Request("http://127.0.0.1:4048/inspect-public?root_label=example"));
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toContain("HTTP 503");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("verifies public TXT only when public NS and current nonce both resolve", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const type = url.searchParams.get("type");
      if (type === "NS") {
        return Response.json({
          Status: 0,
          Responder: "test-resolver",
          Answer: [
            { name: "example.", type: 2, typename: "NS", TTL: 300, data: "ns1.pirate." },
          ],
        });
      }
      if (type === "TXT") {
        return Response.json({
          Status: 0,
          Responder: "test-resolver",
          Answer: [
            { name: "_pirate.example.", type: 16, typename: "TXT", TTL: 300, data: "\"pirate-verification=nvs_test\"" },
          ],
        });
      }
      return new Response("unexpected query", { status: 400 });
    };

    try {
      const response = await handleRequest(new Request("http://127.0.0.1:4048/verify-txt-public", {
        method: "POST",
        body: JSON.stringify({
          root_label: "example",
          challenge_txt_value: "pirate-verification=nvs_test",
        }),
      }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.observation_provider).toBe("web3dns_json_doh");
      expect(body.verified).toBe(true);
      expect(body.root_control_verified).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
