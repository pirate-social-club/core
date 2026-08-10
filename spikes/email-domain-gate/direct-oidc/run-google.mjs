import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  GOOGLE_DISCOVERY_URL,
  OidcSpikeError,
  createAuthorizationAttempt,
  equalSecretValues,
  normalizeDomain,
  validateDiscovery,
  validateGoogleIdToken,
} from "./google-oidc.mjs";

const bindHost = "127.0.0.1";
const networkTimeoutMs = 15_000;
const port = parsePort(process.env.GOOGLE_OIDC_PORT ?? "8787");
const redirectUri = `http://${bindHost}:${port}/callback`;
const config = {
  clientId: requireEnvironment("GOOGLE_OIDC_CLIENT_ID"),
  clientSecret: requireEnvironment("GOOGLE_OIDC_CLIENT_SECRET"),
  expectedDomain: normalizeDomain(
    requireEnvironment("GOOGLE_OIDC_EXPECTED_DOMAIN"),
  ),
};
const hmacSecret = randomBytes(32);
const sessions = new Map();
let discoveryCache = null;
let jwksCache = null;

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    const url = new URL(request.url, `http://${bindHost}:${port}`);
    if (request.method === "GET" && url.pathname === "/") {
      return renderHome(request, response);
    }
    if (request.method === "GET" && url.pathname === "/start") {
      return startAuthorization(request, response, url);
    }
    if (request.method === "GET" && url.pathname === "/callback") {
      return completeAuthorization(request, response, url);
    }
    return renderError(response, 404, "not_found");
  } catch (error) {
    const code =
      error instanceof OidcSpikeError ? error.code : "unexpected_spike_error";
    return renderError(response, 400, code);
  }
});

server.listen(port, bindHost, () => {
  process.stdout.write(
    `Google OIDC spike listening at http://${bindHost}:${port}\n` +
      `Expected redirect URI: ${redirectUri}\n` +
      "No tokens or claim values are logged or written to disk.\n",
  );
});

async function renderHome(request, response) {
  const session = getOrCreateSession(request, response);
  const lastResult = session.lastResult;
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(
    page(
      "Google OIDC claim test",
      `<h1>Google OIDC claim test</h1>
       <p>Use only disposable test accounts. Results stay in this process.</p>
       <p><a href="/start?case=organization">Test organizational account</a></p>
       <p><a href="/start?case=consumer">Test consumer control</a></p>
       ${lastResult ? `<h2>Last result</h2><pre>${escapeHtml(JSON.stringify(lastResult, null, 2))}</pre>` : ""}`,
    ),
  );
}

async function startAuthorization(request, response, url) {
  const accountCase = url.searchParams.get("case");
  const session = getOrCreateSession(request, response);
  const discovery = await getDiscovery();
  const attempt = createAuthorizationAttempt({
    authorizationEndpoint: discovery.authorization_endpoint,
    clientId: config.clientId,
    redirectUri,
    accountCase,
  });
  session.pending = {
    ...attempt,
    createdAt: Date.now(),
  };
  response.writeHead(302, { Location: attempt.authorizationUrl });
  response.end();
}

async function completeAuthorization(request, response, url) {
  const session = getSession(request);
  const pending = session?.pending;
  if (!session || !pending) {
    throw new OidcSpikeError("missing_authorization_session");
  }
  delete session.pending;
  if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
    throw new OidcSpikeError("expired_authorization_session");
  }
  if (url.searchParams.has("error")) {
    throw new OidcSpikeError("authorization_declined_or_failed");
  }
  if (
    !safeQueryValue(url, "state", pending.state) ||
    !url.searchParams.get("code")
  ) {
    throw new OidcSpikeError("invalid_authorization_callback");
  }

  const discovery = await getDiscovery();
  const tokenResponse = await exchangeCode({
    endpoint: discovery.token_endpoint,
    code: url.searchParams.get("code"),
    codeVerifier: pending.codeVerifier,
  });
  try {
    const jwks = await getJwks(discovery.jwks_uri);
    const { evidence, subjectHmac } = validateGoogleIdToken({
      idToken: tokenResponse.id_token,
      jwks,
      clientId: config.clientId,
      nonce: pending.nonce,
      expectedDomain: config.expectedDomain,
      hmacSecret,
    });
    const previousSubjectHmac = session.subjectHmacByCase?.[pending.accountCase];
    const sameSubjectAsPreviousLogin = previousSubjectHmac
      ? equalSecretValues(previousSubjectHmac, subjectHmac)
      : null;
    session.subjectHmacByCase ??= {};
    session.subjectHmacByCase[pending.accountCase] = subjectHmac;
    session.lastResult = {
      account_case: pending.accountCase,
      ...evidence,
      granted_scope_names: parseGrantedScopeNames(tokenResponse.scope),
      same_subject_as_previous_login: sameSubjectAsPreviousLogin,
      userinfo_called: false,
      refresh_token_received: typeof tokenResponse.refresh_token === "string",
      access_token_revoked: await revokeAccessToken(
        discovery.revocation_endpoint,
        tokenResponse.access_token,
      ),
    };
  } finally {
    clearSensitiveTokenResponse(tokenResponse);
  }

  response.writeHead(303, { Location: "/" });
  response.end();
}

async function getDiscovery() {
  if (discoveryCache) return discoveryCache;
  const response = await fetch(GOOGLE_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(networkTimeoutMs),
  });
  if (!response.ok) {
    throw new OidcSpikeError("google_discovery_unavailable");
  }
  discoveryCache = validateDiscovery(await response.json());
  return discoveryCache;
}

async function getJwks(jwksUri) {
  if (jwksCache) return jwksCache;
  const response = await fetch(jwksUri, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(networkTimeoutMs),
  });
  if (!response.ok) {
    throw new OidcSpikeError("google_jwks_unavailable");
  }
  jwksCache = await response.json();
  return jwksCache;
}

async function exchangeCode({ endpoint, code, codeVerifier }) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(networkTimeoutMs),
  });
  const result = await response.json();
  if (
    !response.ok ||
    typeof result.id_token !== "string" ||
    typeof result.access_token !== "string"
  ) {
    clearSensitiveTokenResponse(result);
    throw new OidcSpikeError("authorization_code_exchange_failed");
  }
  return result;
}

async function revokeAccessToken(endpoint, token) {
  if (typeof token !== "string") return false;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      redirect: "error",
      signal: AbortSignal.timeout(networkTimeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function clearSensitiveTokenResponse(result) {
  if (!result || typeof result !== "object") return;
  for (const field of ["access_token", "id_token", "refresh_token"]) {
    if (field in result) result[field] = null;
  }
}

function getOrCreateSession(request, response) {
  const existing = getSession(request);
  if (existing) return existing;
  const id = randomBytes(32).toString("base64url");
  const session = {};
  sessions.set(id, session);
  response.setHeader(
    "Set-Cookie",
    `oidc_spike_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
  );
  return session;
}

function getSession(request) {
  const cookie = request.headers.cookie ?? "";
  const match = cookie.match(/(?:^|; )oidc_spike_session=([^;]+)/);
  return match ? sessions.get(match[1]) : null;
}

function safeQueryValue(url, name, expected) {
  const actual = url.searchParams.get(name);
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function parseGrantedScopeNames(scope) {
  return typeof scope === "string"
    ? [...new Set(scope.split(/\s+/).filter(Boolean))].sort()
    : [];
}

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function renderError(response, status, code) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(
    page(
      "OIDC spike error",
      `<h1>OIDC spike error</h1><p>${escapeHtml(code)}</p><p><a href="/">Return</a></p>`,
    ),
  );
}

function page(title, content) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body>${content}</body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new OidcSpikeError(`missing_${name.toLowerCase()}`);
  return value;
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new OidcSpikeError("invalid_google_oidc_port");
  }
  return parsed;
}

function shutdown() {
  sessions.clear();
  discoveryCache = null;
  jwksCache = null;
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
