const BUN_SQL_UNSUPPORTED_POSTGRES_PARAMS = new Set([
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslcrl",
  "sslcrldir",
]);

export function sanitizePostgresUrlForBunSql(value: string): string {
  const trimmed = value.trim();
  if (!/^postgres(?:ql)?:\/\//i.test(trimmed)) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return value;
  }

  for (const key of BUN_SQL_UNSUPPORTED_POSTGRES_PARAMS) {
    url.searchParams.delete(key);
  }

  return url.toString();
}
