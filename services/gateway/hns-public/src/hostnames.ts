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

export function normalizeHnsHostname(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\.+$/u, "") ?? "";
  if (!normalized || normalized.length > 253 || normalized.includes(":")) {
    return null;
  }

  const labels = normalized.split(".");
  if (labels.some((label) => (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
  ))) {
    return null;
  }

  return normalized;
}

export function extractPublicProfileHost(
  hostname: string,
  rootSuffix: string,
): { handleLabel: string; hostSuffix: string } | null {
  const normalizedHostname = normalizeHnsHostname(hostname);
  const normalizedSuffix = normalizeHnsHostname(rootSuffix);

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
  const normalizedHostname = normalizeHnsHostname(hostname);
  if (!normalizedHostname || normalizedHostname === "localhost") {
    return null;
  }

  for (const suffix of reservedSuffixes) {
    const normalizedSuffix = normalizeHnsHostname(suffix);
    if (!normalizedSuffix) {
      continue;
    }
    if (normalizedHostname === normalizedSuffix || normalizedHostname.endsWith(`.${normalizedSuffix}`)) {
      return null;
    }
  }

  const labels = normalizedHostname.split(".");
  const rootLabel = labels[labels.length - 1];
  if (!rootLabel) {
    return null;
  }

  return {
    rootLabel,
    subdomain: labels.length > 1 ? labels.slice(0, -1).join(".") : null,
  };
}
