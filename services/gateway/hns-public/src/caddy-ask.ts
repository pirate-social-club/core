import { Database } from "bun:sqlite";
import {
  extractImportedNamespaceHost,
  extractPublicProfileHost,
  normalizeHnsHostname,
} from "./hostnames";

export type CaddyAskEnv = {
  HNS_PUBLIC_GATEWAY_ROOT_SUFFIX?: string;
  HNS_PUBLIC_GATEWAY_AGENT_SUFFIX?: string;
  HNS_PUBLIC_API_ORIGIN?: string;
  HNS_PUBLIC_CADDY_ASK_PORT?: string;
  HNS_PUBLIC_CADDY_ASK_DB_PATH?: string;
  HNS_PUBLIC_CADDY_MAX_HOSTS_PER_NAMESPACE?: string;
};

const API_TIMEOUT_MS = 1_500;
export const DEFAULT_CADDY_MAX_HOSTS_PER_NAMESPACE = 64;

export class CaddyNamespaceIssuanceStore {
  readonly #database: Database;
  readonly #maxHostsPerNamespace: number;

  constructor(path: string, maxHostsPerNamespace = DEFAULT_CADDY_MAX_HOSTS_PER_NAMESPACE) {
    if (!Number.isSafeInteger(maxHostsPerNamespace) || maxHostsPerNamespace < 1) {
      throw new Error("Caddy namespace hostname limit must be a positive integer");
    }

    this.#database = new Database(path, { create: true, strict: true });
    this.#maxHostsPerNamespace = maxHostsPerNamespace;
    this.#database.run("PRAGMA journal_mode = WAL");
    this.#database.run("PRAGMA busy_timeout = 5000");
    this.#database.run(`
      CREATE TABLE IF NOT EXISTS caddy_namespace_issuance_hosts (
        hostname TEXT NOT NULL,
        root_label TEXT NOT NULL,
        namespace_verification TEXT NOT NULL,
        authorized_at TEXT NOT NULL,
        PRIMARY KEY (root_label, namespace_verification, hostname)
      )
    `);
    this.#database.run(`
      CREATE INDEX IF NOT EXISTS caddy_namespace_issuance_root_epoch_idx
      ON caddy_namespace_issuance_hosts (root_label, namespace_verification)
    `);
  }

  authorize(input: {
    hostname: string;
    rootLabel: string;
    namespaceVerification: string;
  }): boolean {
    const authorizeTransaction = this.#database.transaction(() => {
      const existing = this.#database.query(
        `SELECT 1 AS present
         FROM caddy_namespace_issuance_hosts
         WHERE hostname = ?
           AND root_label = ?
           AND namespace_verification = ?
         LIMIT 1`,
      ).get(input.hostname, input.rootLabel, input.namespaceVerification);
      if (existing) {
        return true;
      }

      const row = this.#database.query(
        `SELECT COUNT(*) AS count
         FROM caddy_namespace_issuance_hosts
         WHERE root_label = ? AND namespace_verification = ?`,
      ).get(input.rootLabel, input.namespaceVerification) as { count: number } | null;
      if ((row?.count ?? 0) >= this.#maxHostsPerNamespace) {
        return false;
      }

      this.#database.run(
        `INSERT INTO caddy_namespace_issuance_hosts (
           hostname, root_label, namespace_verification, authorized_at
         ) VALUES (?, ?, ?, ?)`,
        [input.hostname, input.rootLabel, input.namespaceVerification, new Date().toISOString()],
      );
      return true;
    });

    return authorizeTransaction();
  }

  close(): void {
    this.#database.close();
  }
}

async function publicResolutionExists(
  url: string,
  fetchImpl: typeof fetch,
): Promise<"allowed" | "denied" | "unavailable"> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);

    if (response.ok) {
      return "allowed";
    }
    if (response.status === 404) {
      return "denied";
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

async function fetchNamespaceVerification(
  url: string,
  expectedRootLabel: string,
  fetchImpl: typeof fetch,
): Promise<
  | { status: "allowed"; namespaceVerification: string }
  | { status: "denied" | "unavailable" }
> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "denied" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "unavailable" };
    }

    const body = await response.json() as {
      root_label?: unknown;
      namespace_verification?: unknown;
    };
    if (
      body.root_label !== expectedRootLabel
      || typeof body.namespace_verification !== "string"
      || !body.namespace_verification.trim()
    ) {
      return { status: "unavailable" };
    }
    return {
      status: "allowed",
      namespaceVerification: body.namespace_verification,
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Caddy's on-demand TLS permission service. This handler is served on its own
 * hard-coded loopback listener and is never routed through the public Caddy
 * catchall. A 2xx is returned only when the hostname has a real Pirate route;
 * API errors and timeouts fail closed so an outage cannot expand issuance.
 */
export async function handleCaddyAskRequest(
  request: Request,
  env: CaddyAskEnv,
  fetchImpl: typeof fetch = fetch,
  namespaceIssuanceStore?: CaddyNamespaceIssuanceStore,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405 });
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/ask") {
    return new Response(null, { status: 404 });
  }

  const domain = normalizeHnsHostname(requestUrl.searchParams.get("domain"));
  if (!domain) {
    return new Response(null, { status: 403 });
  }

  const rootSuffix = normalizeHnsHostname(env.HNS_PUBLIC_GATEWAY_ROOT_SUFFIX ?? "pirate")
    ?? "pirate";
  const agentSuffix = normalizeHnsHostname(env.HNS_PUBLIC_GATEWAY_AGENT_SUFFIX ?? "clawitzer")
    ?? "clawitzer";
  const apiOrigin = env.HNS_PUBLIC_API_ORIGIN?.trim() || "https://api.pirate.sc";

  if (domain === rootSuffix || domain === `app.${rootSuffix}` || domain === `api.${rootSuffix}`) {
    return new Response(null, { status: 204 });
  }

  const profileHost = extractPublicProfileHost(domain, rootSuffix);
  if (profileHost) {
    const result = await publicResolutionExists(
      `${apiOrigin}/public-profiles/${encodeURIComponent(profileHost.handleLabel)}`,
      fetchImpl,
    );
    return new Response(null, { status: result === "allowed" ? 204 : result === "denied" ? 403 : 503 });
  }

  const agentHost = extractPublicProfileHost(domain, agentSuffix);
  if (agentHost) {
    const result = await publicResolutionExists(
      `${apiOrigin}/public-agents/${encodeURIComponent(agentHost.handleLabel)}`,
      fetchImpl,
    );
    return new Response(null, { status: result === "allowed" ? 204 : result === "denied" ? 403 : 503 });
  }

  const namespaceHost = extractImportedNamespaceHost(domain, [rootSuffix, agentSuffix]);
  if (!namespaceHost) {
    return new Response(null, { status: 403 });
  }

  const result = await fetchNamespaceVerification(
    `${apiOrigin}/public-namespaces/${encodeURIComponent(namespaceHost.rootLabel)}`,
    namespaceHost.rootLabel,
    fetchImpl,
  );
  if (result.status !== "allowed") {
    return new Response(null, { status: result.status === "denied" ? 403 : 503 });
  }
  if (!namespaceIssuanceStore) {
    return new Response(null, { status: 503 });
  }

  try {
    const authorized = namespaceIssuanceStore.authorize({
      hostname: domain,
      rootLabel: namespaceHost.rootLabel,
      namespaceVerification: result.namespaceVerification,
    });
    return new Response(null, { status: authorized ? 204 : 429 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
