import { normalizeHnsHostname } from "./hostnames";

const CLOUDFLARE_STATIC_ORIGIN_SUFFIXES = [".workers.dev", ".pages.dev"];

export const EMPTY_STATIC_SITE_ROUTES: ReadonlyMap<string, string> = new Map();

/**
 * Parse the operator-owned static-site map. Every target is deliberately
 * constrained to a Cloudflare static origin so an HNS hostname cannot become
 * an arbitrary server-side proxy.
 */
export function parseStaticSiteRoutes(value: string | undefined): ReadonlyMap<string, string> {
  if (!value?.trim()) {
    return new Map();
  }

  const trimmed = value.trim();
  const input = trimmed.startsWith("{")
    ? JSON.parse(trimmed) as unknown
    : Object.fromEntries(trimmed.split(",").map((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) {
        throw new Error("HNS_PUBLIC_STATIC_SITE_ROUTES entries must use host=https://origin");
      }
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }));

  if (!input || Array.isArray(input) || typeof input !== "object") {
    throw new Error("HNS_PUBLIC_STATIC_SITE_ROUTES must be a route map");
  }

  const routes = new Map<string, string>();
  for (const [rawHost, rawOrigin] of Object.entries(input)) {
    const host = normalizeHnsHostname(rawHost);
    if (!host) {
      throw new Error(`invalid static-site hostname: ${rawHost}`);
    }
    if (typeof rawOrigin !== "string") {
      throw new Error(`static-site origin for ${host} must be a string`);
    }

    const origin = new URL(rawOrigin);
    if (
      origin.protocol !== "https:"
      || origin.username
      || origin.password
      || origin.port
      || origin.pathname !== "/"
      || origin.search
      || origin.hash
      || !CLOUDFLARE_STATIC_ORIGIN_SUFFIXES.some((suffix) => origin.hostname.endsWith(suffix))
    ) {
      throw new Error(`static-site origin for ${host} must be an HTTPS workers.dev or pages.dev origin`);
    }
    routes.set(host, origin.origin);
  }
  return routes;
}

export function loadStaticSiteRoutes(
  value: string | undefined,
  reportError: (message: string, error: unknown) => void = console.error,
): ReadonlyMap<string, string> {
  try {
    return parseStaticSiteRoutes(value);
  } catch (error) {
    reportError("[hns-public-gateway] ignoring invalid HNS_PUBLIC_STATIC_SITE_ROUTES", error);
    return EMPTY_STATIC_SITE_ROUTES;
  }
}

export function staticSiteOriginForHost(
  routes: ReadonlyMap<string, string>,
  hostname: string,
): string | null {
  const normalizedHost = normalizeHnsHostname(hostname);
  if (!normalizedHost) return null;
  return routes.get(normalizedHost) ?? null;
}
