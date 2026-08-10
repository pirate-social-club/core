import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaddyNamespaceIssuanceStore, handleCaddyAskRequest } from "./caddy-ask";
import {
  extractImportedNamespaceHost,
  extractPublicProfileHost,
  handleRequest,
} from "./server";

describe("extractPublicProfileHost", () => {
  test("extracts a simple pirate hostname", () => {
    expect(extractPublicProfileHost("blackbeard.pirate", "pirate")).toEqual({
      handleLabel: "blackbeard",
      hostSuffix: "pirate",
    });
  });

  test("rejects reserved hosts", () => {
    expect(extractPublicProfileHost("api.pirate", "pirate")).toBeNull();
  });

  test("rejects nested subdomains", () => {
    expect(extractPublicProfileHost("one.two.pirate", "pirate")).toBeNull();
  });

  test("extracts a clawitzer hostname", () => {
    expect(extractPublicProfileHost("night-signal.clawitzer", "clawitzer")).toEqual({
      handleLabel: "night-signal",
      hostSuffix: "clawitzer",
    });
  });
});

describe("extractImportedNamespaceHost", () => {
  test("extracts bare imported HNS roots", () => {
    expect(extractImportedNamespaceHost("xn--pokmon-dva", ["pirate", "clawitzer"])).toEqual({
      rootLabel: "xn--pokmon-dva",
      subdomain: null,
    });
  });

  test("extracts imported root subdomains", () => {
    expect(extractImportedNamespaceHost("v.xn--pokmon-dva", ["pirate", "clawitzer"])).toEqual({
      rootLabel: "xn--pokmon-dva",
      subdomain: "v",
    });
  });

  test("accepts consensus-valid underscores only in the HNS root label", () => {
    expect(extractImportedNamespaceHost("tame_impala", ["pirate", "clawitzer"])).toEqual({
      rootLabel: "tame_impala",
      subdomain: null,
    });
    expect(extractImportedNamespaceHost("app.tame_impala", ["pirate", "clawitzer"])).toEqual({
      rootLabel: "tame_impala",
      subdomain: "app",
    });
    expect(extractImportedNamespaceHost("bad_subdomain.tame_impala", ["pirate", "clawitzer"])).toBeNull();
  });

  test("rejects root labels excluded by Handshake consensus", () => {
    for (const hostname of ["_leading", "trailing_", "-leading", "trailing-", "localhost", "a".repeat(64)]) {
      expect(extractImportedNamespaceHost(hostname, ["pirate", "clawitzer"])).toBeNull();
    }
  });

  test("rejects malformed punycode at the product boundary", () => {
    expect(extractImportedNamespaceHost("app.xn--0", ["pirate", "clawitzer"])).toBeNull();
  });

  test("does not treat first-party suffix hosts as imported roots", () => {
    expect(extractImportedNamespaceHost("app.pirate", ["pirate", "clawitzer"])).toBeNull();
    expect(extractImportedNamespaceHost("night-signal.clawitzer", ["pirate", "clawitzer"])).toBeNull();
  });
});

describe("handleCaddyAskRequest", () => {
  const env = {
    HNS_PUBLIC_GATEWAY_ROOT_SUFFIX: "pirate",
    HNS_PUBLIC_GATEWAY_AGENT_SUFFIX: "clawitzer",
    HNS_PUBLIC_API_ORIGIN: "https://api.pirate.sc",
  };

  test("allows only explicit first-party service hosts without an API lookup", async () => {
    for (const domain of ["pirate", "app.pirate", "api.pirate"]) {
      const response = await handleCaddyAskRequest(
        new Request(`http://127.0.0.1:4050/ask?domain=${domain}`),
        env,
        async () => {
          throw new Error("explicit service hosts must not need the API");
        },
      );
      expect(response.status).toBe(204);
    }

    const denied = await handleCaddyAskRequest(
      new Request("http://127.0.0.1:4050/ask?domain=admin.pirate"),
      env,
      async () => {
        throw new Error("reserved hosts must not reach the API");
      },
    );
    expect(denied.status).toBe(403);
  });

  test("allows an existing public profile and denies a missing profile", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response(null, { status: String(url).includes("missing") ? 404 : 200 });
    };

    const allowed = await handleCaddyAskRequest(
      new Request("http://127.0.0.1:4050/ask?domain=blackbeard.pirate"),
      env,
      fetchImpl,
    );
    const denied = await handleCaddyAskRequest(
      new Request("http://127.0.0.1:4050/ask?domain=missing.pirate"),
      env,
      fetchImpl,
    );

    expect(allowed.status).toBe(204);
    expect(denied.status).toBe(403);
    expect(calls).toEqual([
      "https://api.pirate.sc/public-profiles/blackbeard",
      "https://api.pirate.sc/public-profiles/missing",
    ]);
  });

  test("allows an existing public agent", async () => {
    const calls: string[] = [];
    const response = await handleCaddyAskRequest(
      new Request("http://127.0.0.1:4050/ask?domain=night-signal.clawitzer"),
      env,
      async (url) => {
        calls.push(String(url));
        return new Response(null, { status: 200 });
      },
    );

    expect(response.status).toBe(204);
    expect(calls).toEqual(["https://api.pirate.sc/public-agents/night-signal"]);
  });

  test("allows apex and subdomain issuance only for API-confirmed routed namespaces", async () => {
    const store = new CaddyNamespaceIssuanceStore(":memory:", 2);
    try {
      for (const domain of ["xn--pokmon-dva", "v.xn--pokmon-dva"]) {
        const calls: string[] = [];
        const response = await handleCaddyAskRequest(
          new Request(`http://127.0.0.1:4050/ask?domain=${domain}`),
          env,
          async (url) => {
            calls.push(String(url));
            return Response.json({
              root_label: "xn--pokmon-dva",
              namespace_verification: "nv_epoch_1",
            });
          },
          store,
        );

        expect(response.status).toBe(204);
        expect(calls).toEqual(["https://api.pirate.sc/public-namespaces/xn--pokmon-dva"]);
      }

      const quotaExceeded = await handleCaddyAskRequest(
        new Request("http://127.0.0.1:4050/ask?domain=third.xn--pokmon-dva"),
        env,
        async () => Response.json({
          root_label: "xn--pokmon-dva",
          namespace_verification: "nv_epoch_1",
        }),
        store,
      );
      expect(quotaExceeded.status).toBe(429);

      // An already-recorded hostname remains renewable after the quota fills.
      const renewal = await handleCaddyAskRequest(
        new Request("http://127.0.0.1:4050/ask?domain=v.xn--pokmon-dva"),
        env,
        async () => Response.json({
          root_label: "xn--pokmon-dva",
          namespace_verification: "nv_epoch_1",
        }),
        store,
      );
      expect(renewal.status).toBe(204);

      const denied = await handleCaddyAskRequest(
        new Request("http://127.0.0.1:4050/ask?domain=v.unverified-root"),
        env,
        async () => new Response(null, { status: 404 }),
        store,
      );
      expect(denied.status).toBe(403);
    } finally {
      store.close();
    }
  });

  test("allows certificate issuance for a verified underscore HNS root", async () => {
    const store = new CaddyNamespaceIssuanceStore(":memory:");
    const calls: string[] = [];
    try {
      const response = await handleCaddyAskRequest(
        new Request("http://127.0.0.1:4050/ask?domain=app.tame_impala"),
        env,
        async (url) => {
          calls.push(String(url));
          return Response.json({
            root_label: "tame_impala",
            namespace_verification: "nv_underscore",
          });
        },
        store,
      );

      expect(response.status).toBe(204);
      expect(calls).toEqual(["https://api.pirate.sc/public-namespaces/tame_impala"]);
    } finally {
      store.close();
    }
  });

  test("starts a fresh bounded hostname quota for a new ownership verification epoch", async () => {
    const store = new CaddyNamespaceIssuanceStore(":memory:", 1);
    let namespaceVerification = "nv_epoch_1";
    const ask = (domain: string) => handleCaddyAskRequest(
      new Request(`http://127.0.0.1:4050/ask?domain=${domain}`),
      env,
      async () => Response.json({
        root_label: "community-root",
        namespace_verification: namespaceVerification,
      }),
      store,
    );

    try {
      expect((await ask("a.community-root")).status).toBe(204);
      expect((await ask("b.community-root")).status).toBe(429);
      namespaceVerification = "nv_epoch_2";
      expect((await ask("b.community-root")).status).toBe(204);
      expect((await ask("a.community-root")).status).toBe(429);
    } finally {
      store.close();
    }
  });

  test("persists namespace hostname grants across gateway restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "pirate-caddy-ask-"));
    const databasePath = join(directory, "issuance.sqlite");
    const input = {
      hostname: "v.community-root",
      rootLabel: "community-root",
      namespaceVerification: "nv_epoch_1",
    };

    try {
      const first = new CaddyNamespaceIssuanceStore(databasePath, 1);
      try {
        expect(first.authorize(input)).toBe(true);
      } finally {
        first.close();
      }

      const reopened = new CaddyNamespaceIssuanceStore(databasePath, 1);
      try {
        expect(reopened.authorize(input)).toBe(true);
        expect(reopened.authorize({ ...input, hostname: "other.community-root" })).toBe(false);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("fails closed on API errors and malformed ask requests", async () => {
    const store = new CaddyNamespaceIssuanceStore(":memory:");
    try {
      const unavailable = await handleCaddyAskRequest(
        new Request("http://127.0.0.1:4050/ask?domain=community-root"),
        env,
        async () => new Response(null, { status: 500 }),
        store,
      );
      expect(unavailable.status).toBe(503);
    } finally {
      store.close();
    }

    const missingStore = await handleCaddyAskRequest(
      new Request("http://127.0.0.1:4050/ask?domain=community-root"),
      env,
      async () => Response.json({
        root_label: "community-root",
        namespace_verification: "nv_epoch_1",
      }),
    );
    expect(missingStore.status).toBe(503);

    for (const request of [
      new Request("http://127.0.0.1:4050/ask"),
      new Request("http://127.0.0.1:4050/ask?domain=bad%20host"),
      new Request("http://127.0.0.1:4050/not-ask?domain=pirate"),
      new Request("http://127.0.0.1:4050/ask?domain=pirate", { method: "POST" }),
    ]) {
      const response = await handleCaddyAskRequest(request, env, async () => {
        throw new Error("malformed asks must not reach the API");
      });
      expect([403, 404, 405]).toContain(response.status);
    }
  });
});

describe("handleRequest", () => {
  const env = {
    HNS_PUBLIC_GATEWAY_ROOT_SUFFIX: "pirate",
    HNS_PUBLIC_GATEWAY_EXTERNAL_SCHEME: "https",
    HNS_PUBLIC_API_ORIGIN: "https://api.pirate.sc",
    HNS_PUBLIC_APP_ORIGIN: "https://pirate.sc",
  };

  test("serves health", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1/health"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("does not exempt health from the plain-HTTP read-only policy", async () => {
    const response = await handleRequest(
      new Request("http://app.pirate/health", { method: "POST" }),
      env,
      async () => {
        throw new Error("plain-HTTP writes must never reach an origin");
      },
    );
    expect(response.status).toBe(405);
  });

  test("redirects renamed handles to canonical host", async () => {
    const response = await handleRequest(
      new Request("http://oldname.pirate/"),
      env,
      async () =>
        Response.json({
          is_canonical: false,
          requested_handle_label: "oldname.pirate",
          resolved_handle_label: "newname.pirate",
          profile: {
            user_id: "usr_1",
            display_name: null,
            bio: null,
            avatar_ref: null,
            cover_ref: null,
            created_at: "2026-01-01T00:00:00.000Z",
            global_handle: { label: "newname.pirate" },
          },
          created_communities: [],
        }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://newname.pirate/");
  });

  test("renders profile html with community slug links", async () => {
    const response = await handleRequest(
      new Request("http://blackbeard.pirate/"),
      env,
      async () =>
        Response.json({
          is_canonical: true,
          requested_handle_label: "blackbeard.pirate",
          resolved_handle_label: "blackbeard.pirate",
          profile: {
            user_id: "usr_1",
            display_name: "Blackbeard",
            bio: "Captain of the open seas.",
            avatar_ref: "https://cdn.pirate/avatar.png",
            cover_ref: "https://cdn.pirate/cover.png",
            created_at: "2026-01-01T00:00:00.000Z",
            global_handle: { label: "blackbeard.pirate" },
            primary_public_handle: { label: "captain.eth" },
          },
          created_communities: [
            {
              community_id: "cmt_1",
              display_name: "Crew",
              route_slug: "crew",
              created_at: "2026-01-02T00:00:00.000Z",
            },
          ],
        }),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Blackbeard");
    expect(html).toContain("captain.eth");
    expect(html).toContain("https://pirate.sc/c/crew");
    expect(html).toContain('property="og:title" content="Blackbeard • Pirate"');
  });

  test("redirects renamed agent handles to canonical host", async () => {
    const agentEnv = { ...env, HNS_PUBLIC_GATEWAY_AGENT_SUFFIX: "clawitzer" };
    const response = await handleRequest(
      new Request("http://oldname.clawitzer/"),
      agentEnv,
      async () =>
        Response.json({
          is_canonical: false,
          requested_handle_label: "oldname.clawitzer",
          resolved_handle_label: "newname.clawitzer",
          agent: {
            agent_id: "agt_1",
            display_name: "New Name",
            handle: { label_display: "newname.clawitzer" },
            ownership_provider: "clawkey",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          owner: {
            user_id: "usr_1",
            display_name: "Owner",
            global_handle: { label: "owner.pirate" },
            primary_public_handle: null,
          },
        }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://newname.clawitzer/");
  });

  test("renders agent html for clawitzer host", async () => {
    const agentEnv = { ...env, HNS_PUBLIC_GATEWAY_AGENT_SUFFIX: "clawitzer" };
    const response = await handleRequest(
      new Request("http://night-signal.clawitzer/"),
      agentEnv,
      async () =>
        Response.json({
          is_canonical: true,
          requested_handle_label: "night-signal.clawitzer",
          resolved_handle_label: "night-signal.clawitzer",
          agent: {
            agent_id: "agt_1",
            display_name: "Night Signal",
            handle: { label_display: "night-signal.clawitzer" },
            ownership_provider: "clawkey",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          owner: {
            user_id: "usr_1",
            display_name: "Owner",
            global_handle: { label: "owner.pirate" },
            primary_public_handle: { label: "owner.eth" },
          },
        }),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Night Signal");
    expect(html).toContain("night-signal.clawitzer");
    expect(html).toContain("owner.eth");
    expect(html).not.toContain("owner.pirate");
    expect(html).toContain("https://pirate.sc/a/night-signal.clawitzer");
    expect(html).toContain('property="og:title" content="Night Signal • Pirate Agent"');
  });

  test("proxies api.pirate writes over HTTPS, preserving path, method, and body", async () => {
    const calls: Array<{ url: string; method: string; body: string; headers: Headers }> = [];
    const response = await handleRequest(
      new Request("https://api.pirate/communities/crew/posts?sort=top", {
        method: "POST",
        body: JSON.stringify({ title: "ahoy" }),
        headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      }),
      { ...env, HNS_PUBLIC_FORWARDER_AUTH_TOKEN: "shared-secret" },
      async (url, init) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: init?.body ? await new Response(init.body as BodyInit).text() : "",
          headers: new Headers(init?.headers),
        });
        return Response.json({ ok: true });
      },
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.pirate.sc/communities/crew/posts?sort=top");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toBe(JSON.stringify({ title: "ahoy" }));
    expect(calls[0].headers.get("x-pirate-hns-host")).toBe("api.pirate");
    expect(calls[0].headers.has("host")).toBe(false);
  });

  test("rejects writes over plain HTTP without reaching any origin", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await handleRequest(
        new Request("http://api.pirate/communities/crew/posts", {
          method,
          ...(method === "DELETE" ? {} : { body: "{}" }),
        }),
        env,
        async () => {
          throw new Error("plain-HTTP writes must never reach an origin");
        },
      );
      expect(response.status).toBe(405);
    }
  });

  test("treats a missing x-forwarded-proto as insecure (fails closed)", async () => {
    const response = await handleRequest(
      new Request("https://api.pirate/posts", { method: "POST", body: "{}" }),
      env,
      async () => {
        throw new Error("must not reach an origin without a proxy-owned https marker");
      },
    );
    expect(response.status).toBe(405);
  });

  test("strips credentials from plain-HTTP reads", async () => {
    const calls: Headers[] = [];
    const response = await handleRequest(
      new Request("http://app.pirate/c/crew", {
        headers: {
          authorization: "Bearer secret-token",
          cookie: "session=abc",
          "proxy-authorization": "Basic zzz",
        },
      }),
      env,
      async (_url, init) => {
        calls.push(new Headers(init?.headers));
        return new Response("app page");
      },
    );

    expect(response.status).toBe(200);
    expect(calls[0].has("authorization")).toBe(false);
    expect(calls[0].has("cookie")).toBe(false);
    expect(calls[0].has("proxy-authorization")).toBe(false);
  });

  test("forwards credentials over HTTPS", async () => {
    const calls: Headers[] = [];
    await handleRequest(
      new Request("https://app.pirate/c/crew", {
        headers: { authorization: "Bearer secret-token", "x-forwarded-proto": "https" },
      }),
      env,
      async (_url, init) => {
        calls.push(new Headers(init?.headers));
        return new Response("app page");
      },
    );

    expect(calls[0].get("authorization")).toBe("Bearer secret-token");
  });

  test("strips client-supplied x-pirate-hns-* headers before setting derived values", async () => {
    const calls: Headers[] = [];
    await handleRequest(
      new Request("https://app.pirate/", {
        headers: {
          "x-forwarded-proto": "https",
          // A public client trying to launder routing context through the
          // gateway's legitimate token + trusted IP.
          "x-pirate-hns-community-id": "com_victim",
          "x-pirate-hns-community-route": "victim",
          "x-pirate-hns-host": "evil.pirate",
          "x-pirate-hns-root": "evil",
          "x-pirate-hns-trusted-forwarder": "1",
          "x-pirate-hns-forwarder-token": "guessed-secret",
        },
      }),
      { ...env, HNS_PUBLIC_FORWARDER_AUTH_TOKEN: "real-secret" },
      async (_url, init) => {
        calls.push(new Headers(init?.headers));
        return new Response("app page");
      },
    );

    // Server-derived host wins; no attacker-supplied routing context survives.
    expect(calls[0].get("x-pirate-hns-host")).toBe("app.pirate");
    expect(calls[0].get("x-pirate-hns-forwarder-token")).toBe("real-secret");
    expect(calls[0].has("x-pirate-hns-community-id")).toBe(false);
    expect(calls[0].has("x-pirate-hns-community-route")).toBe(false);
    expect(calls[0].has("x-pirate-hns-root")).toBe(false);
    expect(calls[0].has("x-pirate-hns-trusted-forwarder")).toBe(false);
  });

  test("imported-root proxying overwrites spoofed community headers with resolved values", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    await handleRequest(
      new Request("https://xn--pokmon-dva/", {
        headers: {
          "x-forwarded-proto": "https",
          "x-pirate-hns-community-id": "com_attacker",
          "x-pirate-hns-community-route": "attacker",
          "x-pirate-hns-subdomain": "spoofed",
        },
      }),
      env,
      async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        if (String(url).endsWith("/public-namespaces/xn--pokmon-dva")) {
          return Response.json({
            root_label: "xn--pokmon-dva",
            namespace_verification: "nv_test",
            community: { id: "com_real", display_name: "Real", route_slug: "real-route" },
          });
        }
        return new Response("community page");
      },
    );

    expect(calls[1].headers.get("x-pirate-hns-community-id")).toBe("com_real");
    expect(calls[1].headers.get("x-pirate-hns-community-route")).toBe("real-route");
    // No subdomain in this host, so the spoofed subdomain header must be gone.
    expect(calls[1].headers.has("x-pirate-hns-subdomain")).toBe(false);
  });

  test("proxies app.pirate to the app origin with forwarded host and token", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const response = await handleRequest(
      new Request("https://app.pirate/c/crew?sort=top"),
      { ...env, HNS_PUBLIC_FORWARDER_AUTH_TOKEN: "shared-secret" },
      async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        return new Response("app page");
      },
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://pirate.sc/c/crew?sort=top");
    expect(calls[0].headers.get("x-pirate-hns-host")).toBe("app.pirate");
    expect(calls[0].headers.get("x-pirate-hns-forwarder-token")).toBe("shared-secret");
  });

  test("redirects the bare root apex to the app origin", async () => {
    const response = await handleRequest(
      new Request("http://pirate/c/crew?sort=top"),
      env,
      async () => { throw new Error("apex redirect must not proxy"); },
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://app.pirate/c/crew?sort=top");
  });

  test("returns 404 for reserved hosts that have no explicit route", async () => {
    const response = await handleRequest(new Request("https://admin.pirate/"), env, async () => {
      throw new Error("reserved hosts must not reach any origin");
    });
    expect(response.status).toBe(404);
  });

  test("resolves arbitrary community roots over both http and https", async () => {
    for (const scheme of ["http", "https"] as const) {
      const calls: string[] = [];
      const response = await handleRequest(
        new Request(`${scheme}://arbitrary-root/posts/42`),
        env,
        async (url) => {
          calls.push(String(url));
          if (String(url).endsWith("/public-namespaces/arbitrary-root")) {
            return Response.json({
              root_label: "arbitrary-root",
              namespace_verification: "nv_test",
              community: { id: "com_1", display_name: "Arbitrary", route_slug: "arbitrary-root" },
            });
          }
          return new Response("community page");
        },
      );

      expect(response.status).toBe(200);
      expect(calls).toEqual([
        "https://api.pirate.sc/public-namespaces/arbitrary-root",
        "https://pirate.sc/posts/42",
      ]);
    }
  });

  test("routes a verified underscore HNS root through the dynamic gateway", async () => {
    const calls: string[] = [];
    const response = await handleRequest(
      new Request("https://app.tame_impala/posts/42"),
      env,
      async (url) => {
        calls.push(String(url));
        if (String(url).endsWith("/public-namespaces/tame_impala")) {
          return Response.json({
            root_label: "tame_impala",
            namespace_verification: "nv_underscore",
            community: { id: "com_underscore", display_name: "Tame Impala", route_slug: "tame-impala" },
          });
        }
        return new Response("community app");
      },
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "https://api.pirate.sc/public-namespaces/tame_impala",
      "https://pirate.sc/posts/42",
    ]);
  });

  test("proxies verified imported HNS roots without rewriting the path", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const response = await handleRequest(
      new Request("http://xn--pokmon-dva/"),
      env,
      async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        if (String(url) === "https://api.pirate.sc/public-namespaces/xn--pokmon-dva") {
          return Response.json({
            root_label: "xn--pokmon-dva",
            namespace_verification: "nv_namespace_public_test",
            wallet_interactive: true,
            community: {
              id: "com_cmt_public_namespace_test",
              display_name: "Imported Root",
              route_slug: "xn--pokmon-dva",
            },
          });
        }
        return new Response("community page", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("community page");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.pirate.sc/public-namespaces/xn--pokmon-dva",
      "https://pirate.sc/",
    ]);
    expect(calls[1].headers.get("x-pirate-hns-host")).toBe("xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-root")).toBe("xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-community-id")).toBe("com_cmt_public_namespace_test");
    expect(calls[1].headers.get("x-pirate-hns-community-route")).toBe("xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-wallet-interactive")).toBe("1");
    expect(calls[1].headers.has("x-pirate-hns-forwarder-token")).toBe(false);
    expect(calls[1].headers.has("host")).toBe(false);
    expect(calls[1].headers.get("accept-encoding")).toBe("identity");
  });

  test("signs imported HNS proxy requests when a forwarder token is configured", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const response = await handleRequest(
      new Request("http://xn--pokmon-dva/"),
      { ...env, HNS_PUBLIC_FORWARDER_AUTH_TOKEN: "shared-secret" },
      async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        if (String(url) === "https://api.pirate.sc/public-namespaces/xn--pokmon-dva") {
          return Response.json({
            root_label: "xn--pokmon-dva",
            namespace_verification: "nv_namespace_public_test",
            community: {
              id: "com_cmt_public_namespace_test",
              display_name: "Imported Root",
              route_slug: "xn--pokmon-dva",
            },
          });
        }
        return new Response("community page");
      },
    );

    expect(response.status).toBe(200);
    expect(calls[1].headers.get("x-pirate-hns-forwarder-token")).toBe("shared-secret");
  });

  test("proxies verified imported HNS subdomains with the subdomain header", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const response = await handleRequest(
      new Request("http://v.xn--pokmon-dva/"),
      env,
      async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        if (String(url) === "https://api.pirate.sc/public-namespaces/xn--pokmon-dva") {
          return Response.json({
            root_label: "xn--pokmon-dva",
            namespace_verification: "nv_namespace_public_test",
            community: {
              id: "com_cmt_public_namespace_test",
              display_name: "Imported Root",
              route_slug: "xn--pokmon-dva",
            },
          });
        }
        return new Response("community page");
      },
    );

    expect(response.status).toBe(200);
    expect(calls[1].url).toBe("https://pirate.sc/");
    expect(calls[1].headers.get("x-pirate-hns-host")).toBe("v.xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-community-id")).toBe("com_cmt_public_namespace_test");
    expect(calls[1].headers.get("x-pirate-hns-subdomain")).toBe("v");
  });
});
