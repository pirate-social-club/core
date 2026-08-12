#!/usr/bin/env bun

import { sanitizePostgresUrlForBunSql } from "../lib/postgres-url";

type Options = {
  databaseUrlEnv: string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/control-plane/audit-provider-identity-evidence.ts [--database-url-env NAME]

Runs an aggregate, read-only audit of provider-backed identity attestations and
their nullifier links. The report never includes user, attestation, session, or
nullifier identifiers.

Environment:
  CONTROL_PLANE_DATABASE_URL       Default database URL env var.

Options:
  --database-url-env NAME          Env var containing the PostgreSQL URL.
  -h, --help                      Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  let databaseUrlEnv = "CONTROL_PLANE_DATABASE_URL";
  for (let index = 0; index < argv.length;) {
    const flag = argv[index];
    if (flag === "--database-url-env") {
      databaseUrlEnv = String(argv[index + 1] ?? "").trim();
      index += 2;
    } else if (flag === "-h" || flag === "--help") {
      usage(0);
    } else {
      console.error(`unknown argument: ${flag}`);
      usage();
    }
  }
  if (!databaseUrlEnv) usage();
  return { databaseUrlEnv };
}

function requireDatabaseUrl(envName: string): string {
  const value = String(process.env[envName] ?? "").trim();
  if (!value) throw new Error(`missing database url env var: ${envName}`);
  if (!/^postgres(?:ql)?:\/\//u.test(value)) {
    throw new Error(`${envName} must be a PostgreSQL URL`);
  }
  return value;
}

const options = parseArgs(process.argv.slice(2));
const db = new Bun.SQL(sanitizePostgresUrlForBunSql(requireDatabaseUrl(options.databaseUrlEnv)));

try {
  const report = await db.begin(async (tx) => {
    await tx`SET TRANSACTION READ ONLY`;

    const activeAttestations = await tx`
    SELECT provider,
           capability_key,
           COUNT(*)::integer AS active_attestations,
           COUNT(DISTINCT user_id)::integer AS users
    FROM user_attestations
    WHERE status = 'accepted'
      AND verified_at IS NOT NULL
      AND verified_at <= CURRENT_TIMESTAMP
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      AND capability_key IS NOT NULL
    GROUP BY provider, capability_key
    ORDER BY provider, capability_key
  `;

    const duplicateActiveAttestations = await tx`
    WITH active AS (
      SELECT user_id, provider, capability_key, value_json
      FROM user_attestations
      WHERE status = 'accepted'
        AND verified_at IS NOT NULL
        AND verified_at <= CURRENT_TIMESTAMP
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND capability_key IS NOT NULL
    ), grouped AS (
      SELECT user_id,
             provider,
             capability_key,
             COUNT(*)::integer AS row_count,
             COUNT(DISTINCT value_json::text)::integer AS distinct_value_count
      FROM active
      GROUP BY user_id, provider, capability_key
      HAVING COUNT(*) > 1
    )
    SELECT provider,
           capability_key,
           COUNT(*)::integer AS duplicate_groups,
           SUM(row_count)::integer AS duplicate_rows,
           COUNT(*) FILTER (WHERE distinct_value_count > 1)::integer AS conflicting_groups
    FROM grouped
    GROUP BY provider, capability_key
    ORDER BY provider, capability_key
  `;

    const crossProviderValues = await tx`
    WITH active AS (
      SELECT user_id, provider, capability_key, value_json
      FROM user_attestations
      WHERE status = 'accepted'
        AND verified_at IS NOT NULL
        AND verified_at <= CURRENT_TIMESTAMP
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND capability_key IN ('minimum_age', 'nationality', 'gender')
        AND provider IN ('self', 'zkpassport')
    ), grouped AS (
      SELECT user_id,
             capability_key,
             COUNT(DISTINCT provider)::integer AS provider_count,
             COUNT(DISTINCT value_json::text)::integer AS distinct_value_count
      FROM active
      GROUP BY user_id, capability_key
      HAVING COUNT(DISTINCT provider) > 1
    )
    SELECT capability_key,
           COUNT(*)::integer AS multi_provider_users,
           COUNT(*) FILTER (WHERE distinct_value_count > 1)::integer AS conflicting_value_users
    FROM grouped
    GROUP BY capability_key
    ORDER BY capability_key
  `;

    const documentNullifierLinks = await tx`
    WITH active AS (
      SELECT *
      FROM user_attestations
      WHERE status = 'accepted'
        AND verified_at IS NOT NULL
        AND verified_at <= CURRENT_TIMESTAMP
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND provider IN ('self', 'zkpassport')
        AND capability_key IN ('minimum_age', 'nationality', 'gender')
    )
    SELECT a.provider,
           a.capability_key,
           COUNT(*)::integer AS active_attestations,
           COUNT(*) FILTER (WHERE a.source_identity_nullifier_id IS NULL)::integer AS unbound,
           COUNT(*) FILTER (
             WHERE a.source_identity_nullifier_id IS NOT NULL
               AND n.identity_nullifier_id IS NULL
           )::integer AS dangling,
           COUNT(*) FILTER (
             WHERE n.identity_nullifier_id IS NOT NULL
               AND n.status <> 'active'
           )::integer AS inactive_nullifier,
           COUNT(*) FILTER (
             WHERE n.identity_nullifier_id IS NOT NULL
               AND (n.user_id <> a.user_id OR n.provider <> a.provider)
           )::integer AS ownership_or_provider_mismatch
    FROM active a
    LEFT JOIN identity_nullifiers n
      ON n.identity_nullifier_id = a.source_identity_nullifier_id
    GROUP BY a.provider, a.capability_key
    ORDER BY a.provider, a.capability_key
  `;

    const uniqueHumanNullifierLinks = await tx`
    WITH active AS (
      SELECT *
      FROM user_attestations
      WHERE status = 'accepted'
        AND verified_at IS NOT NULL
        AND verified_at <= CURRENT_TIMESTAMP
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND capability_key = 'unique_human'
        AND provider IN ('self', 'very', 'zkpassport')
    )
    SELECT a.provider,
           COUNT(*)::integer AS active_attestations,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1
             FROM identity_nullifiers n
             WHERE n.source_user_attestation_id = a.user_attestation_id
           ))::integer AS missing_nullifier,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1
             FROM identity_nullifiers n
             WHERE n.source_user_attestation_id = a.user_attestation_id
               AND n.status <> 'active'
           ))::integer AS inactive_nullifier,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1
             FROM identity_nullifiers n
             WHERE n.source_user_attestation_id = a.user_attestation_id
               AND (n.user_id <> a.user_id OR n.provider <> a.provider)
           ))::integer AS ownership_or_provider_mismatch
    FROM active a
    GROUP BY a.provider
    ORDER BY a.provider
  `;

    const sessionDuplicates = await tx`
    WITH grouped AS (
      SELECT source_verification_session_id,
             provider,
             capability_key,
             COUNT(*)::integer AS row_count
      FROM user_attestations
      WHERE source_verification_session_id IS NOT NULL
        AND capability_key IS NOT NULL
      GROUP BY source_verification_session_id, provider, capability_key
      HAVING COUNT(*) > 1
    )
    SELECT provider,
           capability_key,
           COUNT(*)::integer AS duplicate_session_groups,
           SUM(row_count)::integer AS duplicate_rows
    FROM grouped
    GROUP BY provider, capability_key
    ORDER BY provider, capability_key
  `;

    const lifecycleAnomalies = await tx`
    SELECT status,
           COUNT(*) FILTER (WHERE status = 'accepted' AND verified_at IS NULL)::integer AS accepted_without_verified_at,
           COUNT(*) FILTER (WHERE status = 'accepted' AND expires_at <= CURRENT_TIMESTAMP)::integer AS accepted_past_expiry,
           COUNT(*) FILTER (WHERE status = 'revoked' AND revoked_at IS NULL)::integer AS revoked_without_revoked_at
    FROM user_attestations
    GROUP BY status
    ORDER BY status
  `;

    return {
      generated_at: new Date().toISOString(),
      scope: "control_plane_read_only_aggregate",
      active_attestations: activeAttestations,
      duplicate_active_attestations: duplicateActiveAttestations,
      cross_provider_document_values: crossProviderValues,
      document_nullifier_links: documentNullifierLinks,
      unique_human_nullifier_links: uniqueHumanNullifierLinks,
      duplicate_session_attestations: sessionDuplicates,
      lifecycle_anomalies: lifecycleAnomalies,
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.end();
}
