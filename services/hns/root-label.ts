const HNS_ROOT_LABEL_BLACKLIST = new Set([
  "example",
  "invalid",
  "local",
  "localhost",
  "test",
]);

const HNS_ROOT_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/u;

/** Matches hsd's covenant grammar for canonical ASCII root labels. */
export function isCanonicalHnsRootLabel(value: string): boolean {
  return HNS_ROOT_LABEL_PATTERN.test(value) && !HNS_ROOT_LABEL_BLACKLIST.has(value);
}

/**
 * Pirate's product-level root-label policy. Handshake consensus treats `xn--`
 * as ordinary ASCII, while Pirate canonicalizes user-facing IDNs. Require an
 * already-encoded `xn--` label to be canonical IDNA ASCII so every ingress
 * agrees on the same root.
 */
export function isCanonicalPirateHnsRootLabel(value: string): boolean {
  if (!isCanonicalHnsRootLabel(value)) {
    return false;
  }

  if (!value.startsWith("xn--")) {
    return true;
  }

  try {
    return new URL(`http://${value}.invalid`).hostname === `${value}.invalid`;
  } catch {
    return false;
  }
}
