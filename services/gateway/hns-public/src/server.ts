import type { PublicAgentResolution, PublicProfileResolution } from "@pirate/api-contracts";

type PublicNamespaceResolution = {
  root_label: string;
  namespace_verification: string | null;
  community: {
    id: string;
    display_name: string | null;
    route_slug: string;
  };
};

export type HnsPublicGatewayEnv = {
  HNS_PUBLIC_GATEWAY_ROOT_SUFFIX?: string;
  HNS_PUBLIC_GATEWAY_AGENT_SUFFIX?: string;
  HNS_PUBLIC_GATEWAY_EXTERNAL_SCHEME?: string;
  HNS_PUBLIC_API_ORIGIN?: string;
  HNS_PUBLIC_APP_ORIGIN?: string;
  HNS_PUBLIC_FORWARDER_AUTH_TOKEN?: string;
};

const RESERVED_HOSTS = new Set([
  "www",
  "api",
  "api-staging",
  "spaces",
  "app",
  "admin",
  "assets",
  "static",
  "cdn",
  "dev",
  "staging",
  "profile",
]);

export function buildCommunityPath(communityId: string, routeSlug: string | null): string {
  return `/c/${encodeURIComponent(routeSlug || communityId)}`;
}

function getPublicIdentityHandleLabel(input: {
  global_handle: { label: string };
  primary_public_handle?: { label: string } | null;
}): string {
  return input.primary_public_handle?.label ?? input.global_handle.label;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function extractPublicProfileHost(
  hostname: string,
  rootSuffix: string,
): { handleLabel: string; hostSuffix: string } | null {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.+$/u, "");
  const normalizedSuffix = rootSuffix.trim().toLowerCase().replace(/\.+$/u, "");

  if (!normalizedHostname || !normalizedSuffix) {
    return null;
  }

  if (!normalizedHostname.endsWith(`.${normalizedSuffix}`)) {
    return null;
  }

  const subdomain = normalizedHostname.slice(0, -(normalizedSuffix.length + 1));
  if (!subdomain || subdomain.includes(".") || RESERVED_HOSTS.has(subdomain)) {
    return null;
  }

  return { handleLabel: subdomain, hostSuffix: normalizedSuffix };
}

export function extractImportedNamespaceHost(
  hostname: string,
  reservedSuffixes: string[],
): { rootLabel: string; subdomain: string | null } | null {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.+$/u, "");
  if (!normalizedHostname || normalizedHostname === "localhost" || normalizedHostname.includes(":")) {
    return null;
  }

  for (const suffix of reservedSuffixes) {
    const normalizedSuffix = suffix.trim().toLowerCase().replace(/\.+$/u, "");
    if (!normalizedSuffix) {
      continue;
    }
    if (normalizedHostname === normalizedSuffix || normalizedHostname.endsWith(`.${normalizedSuffix}`)) {
      return null;
    }
  }

  const labels = normalizedHostname.split(".").filter(Boolean);
  const rootLabel = labels[labels.length - 1];
  if (!rootLabel || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(rootLabel)) {
    return null;
  }

  return {
    rootLabel,
    subdomain: labels.length > 1 ? labels.slice(0, -1).join(".") : null,
  };
}

function formatJoinedLabel(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildMetaDescription({
  bio,
  communityCount,
  displayHandle,
}: {
  bio: string;
  communityCount: number;
  displayHandle: string;
}): string {
  const trimmedBio = bio.trim();
  if (trimmedBio) {
    return trimmedBio;
  }

  if (communityCount > 0) {
    return `${displayHandle} has created ${communityCount} ${communityCount === 1 ? "community" : "communities"} on Pirate.`;
  }

  return `${displayHandle} on Pirate.`;
}

function renderPage({
  appOrigin,
  canonicalHandle,
  canonicalUrl,
  communities,
  displayHandle,
  host,
  profile,
}: {
  appOrigin: string;
  canonicalHandle: string;
  canonicalUrl: string;
  communities: PublicProfileResolution["created_communities"];
  displayHandle: string;
  host: string;
  profile: PublicProfileResolution["profile"];
}): string {
  const displayName = profile.display_name?.trim() || displayHandle;
  const bio = profile.bio?.trim() || "";
  const avatar = profile.avatar_ref?.trim() || "";
  const cover = profile.cover_ref?.trim() || "";
  const joined = formatJoinedLabel(profile.created_at);
  const tagline = displayHandle === canonicalHandle ? displayHandle : canonicalHandle;
  const initials = escapeHtml(displayName.slice(0, 2).toUpperCase() || "P");
  const safeDisplayName = escapeHtml(displayName);
  const safeHandle = escapeHtml(displayHandle);
  const safeTagline = escapeHtml(tagline);
  const safeBio = escapeHtml(bio);
  const safeHost = escapeHtml(host);
  const safeOpenInPirateHref = `${appOrigin}/u/${encodeURIComponent(canonicalHandle)}`;
  const metaDescription = buildMetaDescription({
    bio,
    communityCount: communities.length,
    displayHandle,
  });
  const ogImage = cover || avatar;
  const twitterCard = cover ? "summary_large_image" : "summary";
  const createdCommunitiesMarkup = communities.length
    ? communities.map((community) => (
      `<a class="community-link" href="${appOrigin}${buildCommunityPath(community.community_id, community.route_slug)}">${escapeHtml(community.display_name)}</a>`
    )).join("")
    : "";
  const bannerStyle = cover
    ? `background-image:url('${cover.replaceAll("'", "%27")}');background-size:cover;background-position:center;`
    : "background:linear-gradient(135deg,#302019 0%,#191818 100%);";
  const avatarMarkup = avatar
    ? `<img class="avatar-image" src="${escapeHtml(avatar)}" alt="${safeDisplayName}" />`
    : `<div class="avatar-fallback">${initials}</div>`;

  return `<!doctype html>
<html lang="en" class="dark" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#171717" />
    <meta name="description" content="${escapeHtml(metaDescription)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:title" content="${safeDisplayName} • Pirate" />
    <meta property="og:description" content="${escapeHtml(metaDescription)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:site_name" content="Pirate" />
    ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : ""}
    <meta name="twitter:card" content="${twitterCard}" />
    <meta name="twitter:title" content="${safeDisplayName} • Pirate" />
    <meta name="twitter:description" content="${escapeHtml(metaDescription)}" />
    ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}" />` : ""}
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <title>${safeDisplayName} • Pirate</title>
    <style>
      :root { color-scheme: dark; --bg:#0e0f11; --card:#17191c; --line:rgba(255,255,255,0.08); --text:#f4f4f5; --muted:#b3b6bd; --accent:#ff7a18; --shadow:0 24px 80px rgba(0,0,0,0.32); --radius:28px; }
      * { box-sizing: border-box; }
      body { margin:0; min-height:100vh; background: radial-gradient(circle at top left, rgba(255,122,24,0.16), transparent 28%), radial-gradient(circle at top right, rgba(255,255,255,0.04), transparent 20%), var(--bg); color:var(--text); font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      a { color:inherit; text-decoration:none; }
      .shell { width:min(1080px,calc(100vw - 24px)); margin:0 auto; padding:20px 0 48px; }
      .masthead { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:18px; color:var(--muted); font-size:16px; }
      .brand { font-weight:700; letter-spacing:0.02em; }
      .hero { overflow:hidden; border:1px solid var(--line); border-radius:calc(var(--radius) + 4px); background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)); box-shadow:var(--shadow); }
      .banner { height:220px; }
      .identity { display:grid; gap:24px; padding:0 24px 28px; margin-top:-48px; }
      .identity-row { display:flex; flex-direction:column; gap:18px; }
      .avatar { width:112px; height:112px; border-radius:999px; border:4px solid var(--card); background:linear-gradient(135deg, #25282d 0%, #1a1c20 100%); box-shadow:0 18px 50px rgba(0,0,0,0.4); overflow:hidden; display:grid; place-items:center; }
      .avatar-image,.avatar-fallback { width:100%; height:100%; }
      .avatar-image { object-fit:cover; }
      .avatar-fallback { display:grid; place-items:center; font-size:34px; font-weight:700; }
      .profile-copy h1 { margin:0; font-size:clamp(34px, 4vw, 52px); line-height:1; letter-spacing:-0.04em; }
      .handle { margin-top:8px; color:var(--muted); font-size:18px; }
      .bio { margin:16px 0 0; max-width:720px; color:var(--muted); font-size:18px; line-height:1.6; }
      .meta { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; }
      .meta-item { border:1px solid var(--line); background:rgba(255,255,255,0.03); border-radius:999px; padding:10px 14px; color:var(--muted); font-size:16px; }
      .meta-item strong { color:var(--text); margin-right:8px; }
      .cta-row { display:flex; flex-wrap:wrap; gap:12px; margin-top:22px; }
      .cta { display:inline-flex; align-items:center; justify-content:center; min-height:48px; padding:0 18px; border-radius:999px; border:1px solid transparent; font-size:16px; font-weight:600; }
      .cta-primary { background:var(--accent); color:#180e04; }
      .cta-secondary { border-color:var(--line); background:rgba(255,255,255,0.03); color:var(--text); }
      .content { display:grid; grid-template-columns:minmax(0, 1.5fr) minmax(280px, 0.8fr); gap:18px; margin-top:20px; }
      .panel { border:1px solid var(--line); border-radius:var(--radius); background:var(--card); padding:22px; }
      .panel h2 { margin:0 0 12px; font-size:22px; letter-spacing:-0.03em; }
      .empty { color:var(--muted); font-size:17px; line-height:1.6; }
      .community-list { display:flex; flex-wrap:wrap; gap:12px; }
      .community-link { display:inline-flex; align-items:center; min-height:44px; padding:0 16px; border-radius:999px; border:1px solid var(--line); background:rgba(255,255,255,0.03); color:var(--text); font-size:16px; font-weight:600; }
      .host-note { color:var(--muted); font-size:15px; }
      @media (min-width: 840px) { .identity-row { flex-direction:row; align-items:end; } }
      @media (max-width: 839px) { .content { grid-template-columns:1fr; } .shell { width:min(100vw - 16px, 1080px); padding-top:12px; } .banner { height:168px; } .identity { padding:0 16px 20px; } .panel { padding:18px; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="masthead">
        <div class="brand">Pirate</div>
        <div class="host-note">${safeHost}</div>
      </div>
      <section class="hero">
        <div class="banner" style="${bannerStyle}"></div>
        <div class="identity">
          <div class="identity-row">
            <div class="avatar">${avatarMarkup}</div>
            <div class="profile-copy">
              <h1>${safeDisplayName}</h1>
              <div class="handle">${safeTagline}</div>
              ${bio ? `<p class="bio">${safeBio}</p>` : ""}
              <div class="meta">
                <div class="meta-item"><strong>${safeHandle}</strong>Public handle</div>
                <div class="meta-item"><strong>${escapeHtml(joined)}</strong>Joined</div>
              </div>
              <div class="cta-row">
                <a class="cta cta-primary" href="${safeOpenInPirateHref}">Open in Pirate</a>
                <a class="cta cta-secondary" href="${safeOpenInPirateHref}#posts">View app profile</a>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section class="content">
        <div class="panel">
          <h2>Communities</h2>
          ${communities.length ? `<div class="community-list">${createdCommunitiesMarkup}</div>` : `<div class="empty">No created communities yet.</div>`}
        </div>
        <div class="panel">
          <h2>About</h2>
          <div class="empty">${bio ? safeBio : "No public bio yet."}</div>
        </div>
      </section>
    </div>
  </body>
</html>`;
}

function renderAgentPage({
  appOrigin,
  canonicalUrl,
  host,
  resolution,
}: {
  appOrigin: string;
  canonicalUrl: string;
  host: string;
  resolution: PublicAgentResolution;
}): Response {
  const handle = resolution.agent.handle.label_display;
  const displayName = resolution.agent.display_name?.trim() || handle;
  const ownerHandle = getPublicIdentityHandleLabel(resolution.owner);
  const safeDisplayName = escapeHtml(displayName);
  const safeHandle = escapeHtml(handle);
  const safeOwnerHandle = escapeHtml(ownerHandle);
  const safeHost = escapeHtml(host);
  const safeCanonicalUrl = escapeHtml(canonicalUrl);
  const safeOpenHref = `${appOrigin}/a/${encodeURIComponent(handle)}`;

  return new Response(
    `<!doctype html>
<html lang="en" class="dark" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#171717" />
    <meta name="description" content="${safeHandle} is a Pirate agent owned by ${safeOwnerHandle}." />
    <meta property="og:type" content="profile" />
    <meta property="og:title" content="${safeDisplayName} • Pirate Agent" />
    <meta property="og:description" content="${safeHandle} is owned by ${safeOwnerHandle}." />
    <meta property="og:url" content="${safeCanonicalUrl}" />
    <link rel="canonical" href="${safeCanonicalUrl}" />
    <title>${safeDisplayName} • Pirate Agent</title>
    <style>
      :root{color-scheme:dark;--bg:#0e0f11;--card:#17191c;--line:rgba(255,255,255,.08);--text:#f4f4f5;--muted:#b3b6bd;--accent:#ff7a18;--radius:28px}
      *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0%,rgba(255,122,24,.18),transparent 30%),var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,sans-serif}
      .shell{width:min(880px,calc(100vw - 24px));margin:0 auto;padding:24px 0 56px}.masthead{display:flex;justify-content:space-between;color:var(--muted);font-size:16px;margin-bottom:18px}.brand{font-weight:700}
      .card{border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.32)}
      h1{font-size:clamp(38px,6vw,72px);line-height:.95;letter-spacing:-.06em;margin:0 0 12px}.handle{font-size:22px;color:var(--muted);margin-bottom:24px}.meta{display:flex;flex-wrap:wrap;gap:12px}.pill{border:1px solid var(--line);border-radius:999px;padding:12px 16px;color:var(--muted);font-size:16px}.pill strong{color:var(--text);margin-right:8px}
      .cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;margin-top:26px;padding:0 18px;border-radius:999px;background:var(--accent);color:#180e04;font-weight:700;text-decoration:none}
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="masthead"><div class="brand">Pirate</div><div>${safeHost}</div></div>
      <main class="card">
        <h1>${safeDisplayName}</h1>
        <div class="handle">${safeHandle}</div>
        <div class="meta">
          <div class="pill"><strong>${safeOwnerHandle}</strong>Owner</div>
          <div class="pill"><strong>${escapeHtml(resolution.agent.ownership_provider ?? "agent")}</strong>Provider</div>
        </div>
        <a class="cta" href="${escapeHtml(safeOpenHref)}">Open in Pirate</a>
      </main>
    </div>
  </body>
</html>`,
    {
      headers: {
        "cache-control": "public, max-age=60",
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

function renderErrorPage(title: string, description: string, status = 500): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0f11;color:#f4f4f5;font-family:ui-sans-serif,system-ui,sans-serif;padding:24px}main{max-width:720px;text-align:center;border:1px solid rgba(255,255,255,.08);background:#17191c;border-radius:28px;padding:32px}h1{margin:0 0 12px;font-size:34px;letter-spacing:-.04em}p{margin:0;color:#b3b6bd;font-size:18px;line-height:1.6}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></main></body></html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status,
    },
  );
}

function createCanonicalUrl(requestUrl: URL, scheme: string): string {
  const nextUrl = new URL(requestUrl.toString());
  nextUrl.protocol = `${scheme}:`;
  return nextUrl.toString();
}

async function proxyImportedNamespaceRequest(input: {
  request: Request;
  url: URL;
  apiOrigin: string;
  appOrigin: string;
  env: HnsPublicGatewayEnv;
  namespaceHost: { rootLabel: string; subdomain: string | null };
  fetchImpl: typeof fetch;
}): Promise<Response | null> {
  const namespaceResponse = await input.fetchImpl(
    `${input.apiOrigin}/public-namespaces/${encodeURIComponent(input.namespaceHost.rootLabel)}`,
    {
      headers: { accept: "application/json" },
      redirect: "manual",
    },
  );

  if (namespaceResponse.status === 404) {
    return null;
  }

  if (!namespaceResponse.ok) {
    return renderErrorPage(
      "Imported namespace",
      "This imported HNS namespace could not be loaded right now.",
      502,
    );
  }

  const resolution = await namespaceResponse.json() as PublicNamespaceResolution;
  const appUrl = new URL(input.request.url);
  const appOriginUrl = new URL(input.appOrigin);
  appUrl.protocol = appOriginUrl.protocol;
  appUrl.host = appOriginUrl.host;

  const headers = new Headers(input.request.headers);
  headers.delete("host");
  headers.set("accept-encoding", "identity");
  headers.set("accept", input.request.headers.get("accept") ?? "text/html");
  headers.set("x-pirate-hns-host", input.url.hostname);
  headers.set("x-pirate-hns-root", resolution.root_label);
  headers.set("x-pirate-hns-community-id", resolution.community.id);
  headers.set("x-pirate-hns-community-route", resolution.community.route_slug);
  const forwarderToken = input.env.HNS_PUBLIC_FORWARDER_AUTH_TOKEN?.trim();
  if (forwarderToken) {
    headers.set("x-pirate-hns-forwarder-token", forwarderToken);
  }
  if (input.namespaceHost.subdomain) {
    headers.set("x-pirate-hns-subdomain", input.namespaceHost.subdomain);
  }

  return input.fetchImpl(appUrl.toString(), {
    headers,
    method: input.request.method,
    redirect: "manual",
  });
}

export async function handleRequest(
  request: Request,
  env: HnsPublicGatewayEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return Response.json({ ok: true });
  }

  const rootSuffix = env.HNS_PUBLIC_GATEWAY_ROOT_SUFFIX?.trim() || "pirate";
  const agentSuffix = env.HNS_PUBLIC_GATEWAY_AGENT_SUFFIX?.trim() || "clawitzer";
  const externalScheme = env.HNS_PUBLIC_GATEWAY_EXTERNAL_SCHEME?.trim() || "https";

  let target = extractPublicProfileHost(url.hostname, rootSuffix);
  let isAgent = false;

  if (!target) {
    target = extractPublicProfileHost(url.hostname, agentSuffix);
    isAgent = true;
  }

  const apiOrigin = env.HNS_PUBLIC_API_ORIGIN?.trim() || "https://api.pirate.sc";
  const appOrigin = env.HNS_PUBLIC_APP_ORIGIN?.trim() || "https://pirate.sc";

  if (!target) {
    const namespaceHost = extractImportedNamespaceHost(url.hostname, [rootSuffix, agentSuffix]);
    if (namespaceHost) {
      const proxied = await proxyImportedNamespaceRequest({
        request,
        url,
        apiOrigin,
        appOrigin,
        env,
        namespaceHost,
        fetchImpl,
      });
      if (proxied) {
        return proxied;
      }
    }

    return renderErrorPage(
      "Public profile",
      `The host ${url.hostname} does not map to a public Pirate profile.`,
      404,
    );
  }

  const apiPath = isAgent ? "public-agents" : "public-profiles";
  const response = await fetchImpl(
    `${apiOrigin}/${apiPath}/${encodeURIComponent(target.handleLabel)}`,
    {
      headers: { accept: "application/json" },
      redirect: "manual",
    },
  );

  if (response.status === 404) {
    return renderErrorPage(
      "Profile not found",
      `We could not find a public Pirate profile for ${url.hostname}.`,
      404,
    );
  }

  if (!response.ok) {
    return renderErrorPage(
      "Public profile",
      "This public profile could not be loaded right now.",
      502,
    );
  }

  if (isAgent) {
    const resolution = await response.json() as PublicAgentResolution;

    if (!resolution.is_canonical) {
      const nextUrl = new URL(request.url);
      nextUrl.hostname = `${resolution.resolved_handle_label.replace(/\.clawitzer$/i, "")}.${target.hostSuffix}`;
      nextUrl.protocol = `${externalScheme}:`;
      return Response.redirect(nextUrl.toString(), 302);
    }

    return renderAgentPage({
      appOrigin,
      canonicalUrl: createCanonicalUrl(url, externalScheme),
      host: url.hostname,
      resolution,
    });
  }

  const resolution = await response.json() as PublicProfileResolution;

  if (!resolution.is_canonical) {
    const nextUrl = new URL(request.url);
    nextUrl.hostname = `${resolution.resolved_handle_label.replace(/\.pirate$/i, "")}.${target.hostSuffix}`;
    nextUrl.protocol = `${externalScheme}:`;
    return Response.redirect(nextUrl.toString(), 302);
  }

  const html = renderPage({
    appOrigin,
    canonicalHandle: resolution.profile.global_handle.label,
    canonicalUrl: createCanonicalUrl(url, externalScheme),
    communities: resolution.created_communities,
    displayHandle: resolution.profile.primary_public_handle?.label ?? resolution.profile.global_handle.label,
    host: url.hostname,
    profile: resolution.profile,
  });

  return new Response(html, {
    headers: {
      "cache-control": "public, max-age=60",
      "content-type": "text/html; charset=utf-8",
    },
  });
}

if (import.meta.main) {
  const host = Bun.env.HNS_PUBLIC_GATEWAY_HOST?.trim() || "127.0.0.1";
  const port = Number(Bun.env.HNS_PUBLIC_GATEWAY_PORT || "4049");

  Bun.serve({
    hostname: host,
    port,
    fetch(request) {
      return handleRequest(request, Bun.env);
    },
  });

  console.log(`[hns-public-gateway] listening on http://${host}:${port}`);
}
