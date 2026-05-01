import { describe, expect, test } from "bun:test";
import { extractCommunityRootHost, extractPublicProfileHost, handleRequest } from "./server";

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

describe("extractCommunityRootHost", () => {
  test("extracts a bare HNS community root", () => {
    expect(extractCommunityRootHost("dankmeme")).toBe("dankmeme");
  });

  test("rejects reserved, dotted, and invalid roots", () => {
    expect(extractCommunityRootHost("api")).toBeNull();
    expect(extractCommunityRootHost("blackbeard.pirate")).toBeNull();
    expect(extractCommunityRootHost("-bad")).toBeNull();
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

  test("proxies bare HNS community roots to Pirate community pages", async () => {
    let requestedUrl = "";
    const response = await handleRequest(
      new Request("http://dankmeme/?tab=top", {
        headers: { accept: "text/html" },
      }),
      env,
      async (input) => {
        requestedUrl = typeof input === "string" ? input : input.url;
        return new Response("<html><title>dankmeme</title></html>", {
          headers: {
            "content-security-policy": "default-src 'self'",
            "content-encoding": "zstd",
            "content-length": "999",
            "content-type": "text/html; charset=utf-8",
            "x-frame-options": "DENY",
          },
        });
      },
    );

    expect(response.status).toBe(200);
    expect(requestedUrl).toBe("https://pirate.sc/c/dankmeme?tab=top");
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.text()).toContain("dankmeme");
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
});
