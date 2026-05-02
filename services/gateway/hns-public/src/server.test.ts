import { describe, expect, test } from "bun:test";
import { extractImportedNamespaceHost, extractPublicProfileHost, handleRequest } from "./server";

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

  test("does not treat first-party suffix hosts as imported roots", () => {
    expect(extractImportedNamespaceHost("app.pirate", ["pirate", "clawitzer"])).toBeNull();
    expect(extractImportedNamespaceHost("night-signal.clawitzer", ["pirate", "clawitzer"])).toBeNull();
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

  test("proxies verified imported HNS roots to their community route", async () => {
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
      "https://pirate.sc/c/xn--pokmon-dva",
    ]);
    expect(calls[1].headers.get("x-pirate-hns-host")).toBe("xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-root")).toBe("xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-community-route")).toBe("xn--pokmon-dva");
    expect(calls[1].headers.has("host")).toBe(false);
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
    expect(calls[1].url).toBe("https://pirate.sc/c/xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-host")).toBe("v.xn--pokmon-dva");
    expect(calls[1].headers.get("x-pirate-hns-subdomain")).toBe("v");
  });
});
