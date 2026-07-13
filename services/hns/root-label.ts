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
