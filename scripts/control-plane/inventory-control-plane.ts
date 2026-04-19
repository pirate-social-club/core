#!/usr/bin/env bun

type Options = {
  databaseUrlEnv: string;
  format: "text" | "json";
  sampleLimit: number;
};

type TableCount = {
  tableName: string;
  rowCount: number;
};

type FixtureSignal = {
  name: string;
  count: number;
  samples: string[];
};

type CommunityBindingRow = {
  community_id: string;
  display_name: string;
  status: string;
  provisioning_state: string;
  route_slug: string | null;
  binding_status: string | null;
  database_url: string | null;
  organization_slug: string | null;
  group_name: string | null;
  database_name: string | null;
  encryption_key_version: number | null;
};

type GroupedCountRow = {
  key: string;
  count: number | string;
};

type InventoryReport = {
  database: {
    name: string;
    user: string;
    host: string | null;
  };
  tableCounts: TableCount[];
  fixtureSignals: FixtureSignal[];
  bindings: {
    total: number;
    fileBacked: number;
    tursoBacked: number;
    other: number;
    fileBackedSamples: string[];
    tursoSamples: string[];
  };
  communities: {
    total: number;
    statusCounts: Array<{ key: string; count: number }>;
    provisioningCounts: Array<{ key: string; count: number }>;
    registryCounts: Array<{ key: string; count: number }> | null;
    rows: CommunityBindingRow[];
  };
  assessment: {
    likelyFixtureContamination: boolean;
    likelyRealCommunityData: boolean;
    mixedFixtureAndOperationalState: boolean;
    recommendation: string;
  };
};

function usage(): never {
  console.error(`Usage:
  bun scripts/control-plane/inventory-control-plane.ts [--database-url-env ENV_NAME] [--format text|json] [--sample-limit N]

Read-only control-plane inventory and fixture contamination classifier.

Environment:
  CONTROL_PLANE_DATABASE_URL   Default source for the control-plane runtime URL.

Options:
  --database-url-env ENV_NAME  Environment variable containing the database URL. Default: CONTROL_PLANE_DATABASE_URL
  --format FORMAT              Output format: text or json. Default: text
  --sample-limit N             Max sample rows per section. Default: 10
  -h, --help                   Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    format: "text",
    sampleLimit: 10,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--database-url-env":
        options.databaseUrlEnv = value ?? options.databaseUrlEnv;
        index += 2;
        break;
      case "--format":
        if (value !== "text" && value !== "json") {
          console.error(`invalid format: ${value}`);
          usage();
        }
        options.format = value;
        index += 2;
        break;
      case "--sample-limit": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          console.error(`invalid sample limit: ${value}`);
          usage();
        }
        options.sampleLimit = parsed;
        index += 2;
        break;
      }
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`missing database url env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function countValue(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

async function tableExists(db: Bun.SQL, tableName: string): Promise<boolean> {
  const rows = await db<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function columnExists(db: Bun.SQL, tableName: string, columnName: string): Promise<boolean> {
  const rows = await db<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function listPublicTables(db: Bun.SQL): Promise<string[]> {
  const rows = await db<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `;
  return rows.map((row) => row.table_name);
}

async function countTables(db: Bun.SQL, tableNames: string[]): Promise<TableCount[]> {
  const counts: TableCount[] = [];
  for (const tableName of tableNames) {
    const rows = await db.unsafe<{ count: number | string }[]>(
      `SELECT COUNT(*)::bigint AS count FROM public.${quoteIdentifier(tableName)}`,
    );
    counts.push({
      tableName,
      rowCount: countValue(rows[0]?.count),
    });
  }
  return counts.sort((left, right) => right.rowCount - left.rowCount || left.tableName.localeCompare(right.tableName));
}

async function collectFixtureSignals(db: Bun.SQL, sampleLimit: number): Promise<FixtureSignal[]> {
  const signals: FixtureSignal[] = [];

  if (await tableExists(db, "users")) {
    const rows = await db<{ user_id: string }[]>`
      SELECT user_id
      FROM users
      WHERE user_id LIKE 'usr_demo_%'
         OR user_id LIKE 'usr_fixture_%'
      ORDER BY user_id ASC
      LIMIT ${sampleLimit}
    `;
    const countRows = await db<{ count: number | string }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM users
      WHERE user_id LIKE 'usr_demo_%'
         OR user_id LIKE 'usr_fixture_%'
    `;
    signals.push({
      name: "demo_or_fixture_users",
      count: countValue(countRows[0]?.count),
      samples: rows.map((row) => row.user_id),
    });
  }

  if (await tableExists(db, "auth_provider_links")) {
    const rows = await db<{ provider_subject: string }[]>`
      SELECT provider_subject
      FROM auth_provider_links
      WHERE provider_subject LIKE 'pirate-dev-upstream|%'
      ORDER BY provider_subject ASC
      LIMIT ${sampleLimit}
    `;
    const countRows = await db<{ count: number | string }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM auth_provider_links
      WHERE provider_subject LIKE 'pirate-dev-upstream|%'
    `;
    signals.push({
      name: "pirate_dev_upstream_provider_links",
      count: countValue(countRows[0]?.count),
      samples: rows.map((row) => row.provider_subject),
    });
  }

  if (await tableExists(db, "user_attestations")) {
    const rows = await db<{ user_attestation_id: string }[]>`
      SELECT user_attestation_id
      FROM user_attestations
      WHERE CAST(value_json AS TEXT) LIKE '%"fixture": true%'
         OR CAST(value_json AS TEXT) LIKE '%"fixture":true%'
      ORDER BY user_attestation_id ASC
      LIMIT ${sampleLimit}
    `;
    const countRows = await db<{ count: number | string }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM user_attestations
      WHERE CAST(value_json AS TEXT) LIKE '%"fixture": true%'
         OR CAST(value_json AS TEXT) LIKE '%"fixture":true%'
    `;
    signals.push({
      name: "fixture_user_attestations",
      count: countValue(countRows[0]?.count),
      samples: rows.map((row) => row.user_attestation_id),
    });
  }

  if (await tableExists(db, "namespace_verification_evidence_bundles")) {
    const rows = await db<{ evidence_bundle_id: string }[]>`
      SELECT evidence_bundle_id
      FROM namespace_verification_evidence_bundles
      WHERE CAST(COALESCE(raw_response_json, 'null') AS TEXT) LIKE '%"fixture": true%'
         OR CAST(COALESCE(raw_response_json, 'null') AS TEXT) LIKE '%"fixture":true%'
         OR CAST(COALESCE(resolver_path_json, 'null') AS TEXT) LIKE '%fixture%'
      ORDER BY evidence_bundle_id ASC
      LIMIT ${sampleLimit}
    `;
    const countRows = await db<{ count: number | string }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM namespace_verification_evidence_bundles
      WHERE CAST(COALESCE(raw_response_json, 'null') AS TEXT) LIKE '%"fixture": true%'
         OR CAST(COALESCE(raw_response_json, 'null') AS TEXT) LIKE '%"fixture":true%'
         OR CAST(COALESCE(resolver_path_json, 'null') AS TEXT) LIKE '%fixture%'
    `;
    signals.push({
      name: "fixture_namespace_evidence",
      count: countValue(countRows[0]?.count),
      samples: rows.map((row) => row.evidence_bundle_id),
    });
  }

  if (await tableExists(db, "jobs")) {
    const rows = await db<{ job_id: string }[]>`
      SELECT job_id
      FROM jobs
      WHERE job_type = 'reddit_snapshot_import'
        AND (
          CAST(COALESCE(payload_json, 'null') AS TEXT) LIKE '%fixture_seed%'
          OR CAST(COALESCE(payload_json, 'null') AS TEXT) LIKE '%technohippie%'
        )
      ORDER BY job_id ASC
      LIMIT ${sampleLimit}
    `;
    const countRows = await db<{ count: number | string }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM jobs
      WHERE job_type = 'reddit_snapshot_import'
        AND (
          CAST(COALESCE(payload_json, 'null') AS TEXT) LIKE '%fixture_seed%'
          OR CAST(COALESCE(payload_json, 'null') AS TEXT) LIKE '%technohippie%'
        )
    `;
    signals.push({
      name: "fixture_reddit_import_jobs",
      count: countValue(countRows[0]?.count),
      samples: rows.map((row) => row.job_id),
    });
  }

  if (await tableExists(db, "external_reputation_snapshots")) {
    const rows = await db<{ external_reputation_snapshot_id: string }[]>`
      SELECT external_reputation_snapshot_id
      FROM external_reputation_snapshots
      WHERE CAST(snapshot_payload_json AS TEXT) LIKE '%local stub fixture%'
      ORDER BY external_reputation_snapshot_id ASC
      LIMIT ${sampleLimit}
    `;
    const countRows = await db<{ count: number | string }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM external_reputation_snapshots
      WHERE CAST(snapshot_payload_json AS TEXT) LIKE '%local stub fixture%'
    `;
    signals.push({
      name: "fixture_external_reputation_snapshots",
      count: countValue(countRows[0]?.count),
      samples: rows.map((row) => row.external_reputation_snapshot_id),
    });
  }

  return signals;
}

async function collectGroupedCounts(
  db: Bun.SQL,
  tableName: string,
  columnName: string,
): Promise<Array<{ key: string; count: number }>> {
  const rows = await db.unsafe<GroupedCountRow[]>(
    `SELECT COALESCE(CAST(${quoteIdentifier(columnName)} AS TEXT), 'null') AS key, COUNT(*)::bigint AS count
     FROM public.${quoteIdentifier(tableName)}
     GROUP BY 1
     ORDER BY COUNT(*) DESC, 1 ASC`,
  );
  return rows.map((row) => ({
    key: row.key,
    count: countValue(row.count),
  }));
}

async function collectBindings(
  db: Bun.SQL,
  sampleLimit: number,
): Promise<InventoryReport["bindings"]> {
  if (!await tableExists(db, "community_database_bindings")) {
    return {
      total: 0,
      fileBacked: 0,
      tursoBacked: 0,
      other: 0,
      fileBackedSamples: [],
      tursoSamples: [],
    };
  }

  const countRows = await db<{
    total: number | string;
    file_backed: number | string;
    turso_backed: number | string;
    other: number | string;
  }[]>`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE database_url LIKE 'file:%')::bigint AS file_backed,
      COUNT(*) FILTER (WHERE database_url LIKE 'libsql://%')::bigint AS turso_backed,
      COUNT(*) FILTER (WHERE database_url NOT LIKE 'file:%' AND database_url NOT LIKE 'libsql://%')::bigint AS other
    FROM community_database_bindings
  `;

  const fileRows = await db<{
    community_id: string;
    group_name: string;
    database_name: string;
    database_url: string;
  }[]>`
    SELECT community_id, group_name, database_name, database_url
    FROM community_database_bindings
    WHERE database_url LIKE 'file:%'
    ORDER BY community_id ASC
    LIMIT ${sampleLimit}
  `;

  const tursoRows = await db<{
    community_id: string;
    group_name: string;
    database_name: string;
  }[]>`
    SELECT community_id, group_name, database_name
    FROM community_database_bindings
    WHERE database_url LIKE 'libsql://%'
    ORDER BY community_id ASC
    LIMIT ${sampleLimit}
  `;

  return {
    total: countValue(countRows[0]?.total),
    fileBacked: countValue(countRows[0]?.file_backed),
    tursoBacked: countValue(countRows[0]?.turso_backed),
    other: countValue(countRows[0]?.other),
    fileBackedSamples: fileRows.map((row) => `${row.community_id}:${row.group_name}/${row.database_name}:${row.database_url}`),
    tursoSamples: tursoRows.map((row) => `${row.community_id}:${row.group_name}/${row.database_name}`),
  };
}

async function collectCommunities(
  db: Bun.SQL,
  sampleLimit: number,
): Promise<InventoryReport["communities"]> {
  if (!await tableExists(db, "communities")) {
    return {
      total: 0,
      statusCounts: [],
      provisioningCounts: [],
      registryCounts: null,
      rows: [],
    };
  }

  const totalRows = await db<{ count: number | string }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM communities
  `;

  const hasRegistryPublicationState = await columnExists(db, "communities", "registry_publication_state");
  const registryCounts = hasRegistryPublicationState
    ? await collectGroupedCounts(db, "communities", "registry_publication_state")
    : null;

  const rowsSql = `
    SELECT
      c.community_id,
      c.display_name,
      c.status,
      c.provisioning_state,
      c.route_slug,
      b.status AS binding_status,
      b.database_url,
      b.organization_slug,
      b.group_name,
      b.database_name,
      cred.encryption_key_version
    FROM communities AS c
    LEFT JOIN community_database_bindings AS b
      ON b.community_database_binding_id = c.primary_database_binding_id
    LEFT JOIN community_db_credentials AS cred
      ON cred.community_database_binding_id = b.community_database_binding_id
     AND cred.status = 'active'
    ORDER BY c.created_at ASC, c.community_id ASC
    LIMIT ${sampleLimit}
  `;

  const rows = await db.unsafe<CommunityBindingRow[]>(rowsSql);

  return {
    total: countValue(totalRows[0]?.count),
    statusCounts: await collectGroupedCounts(db, "communities", "status"),
    provisioningCounts: await collectGroupedCounts(db, "communities", "provisioning_state"),
    registryCounts,
    rows,
  };
}

function buildAssessment(input: {
  fixtureSignals: FixtureSignal[];
  bindings: InventoryReport["bindings"];
  communities: InventoryReport["communities"];
}): InventoryReport["assessment"] {
  const fixtureCount = input.fixtureSignals.reduce((total, signal) => total + signal.count, 0);
  const likelyFixtureContamination = fixtureCount > 0 || input.bindings.fileBacked > 0;
  const likelyRealCommunityData = input.bindings.tursoBacked > 0;
  const mixedFixtureAndOperationalState = likelyFixtureContamination && likelyRealCommunityData;

  let recommendation = "no strong fixture or operational signal detected";
  if (mixedFixtureAndOperationalState) {
    recommendation =
      "do not wipe in place; build a fresh Neon target, classify/import only canonical rows, then cut over";
  } else if (likelyFixtureContamination && !likelyRealCommunityData) {
    recommendation =
      "fixture contamination appears dominant; a fresh rebuild is likely safer than cleanup in place";
  } else if (!likelyFixtureContamination && likelyRealCommunityData) {
    recommendation =
      "operational data appears present without obvious fixture contamination; preserve and migrate carefully";
  }

  if (input.communities.total === 0 && input.bindings.total === 0 && fixtureCount === 0) {
    recommendation = "database looks mostly empty; a clean rebuild should be straightforward";
  }

  return {
    likelyFixtureContamination,
    likelyRealCommunityData,
    mixedFixtureAndOperationalState,
    recommendation,
  };
}

function printText(report: InventoryReport) {
  console.log("control-plane inventory");
  console.log(`database: ${report.database.name}`);
  console.log(`user: ${report.database.user}`);
  if (report.database.host) {
    console.log(`host: ${report.database.host}`);
  }

  console.log("");
  console.log("table counts");
  for (const tableCount of report.tableCounts) {
    console.log(`- ${tableCount.tableName}: ${tableCount.rowCount}`);
  }

  console.log("");
  console.log("fixture signals");
  for (const signal of report.fixtureSignals) {
    console.log(`- ${signal.name}: ${signal.count}`);
    for (const sample of signal.samples) {
      console.log(`  sample: ${sample}`);
    }
  }

  console.log("");
  console.log("bindings");
  console.log(`- total: ${report.bindings.total}`);
  console.log(`- file_backed: ${report.bindings.fileBacked}`);
  console.log(`- turso_backed: ${report.bindings.tursoBacked}`);
  console.log(`- other: ${report.bindings.other}`);
  for (const sample of report.bindings.fileBackedSamples) {
    console.log(`  file_sample: ${sample}`);
  }
  for (const sample of report.bindings.tursoSamples) {
    console.log(`  turso_sample: ${sample}`);
  }

  console.log("");
  console.log("communities");
  console.log(`- total: ${report.communities.total}`);
  for (const entry of report.communities.statusCounts) {
    console.log(`  status.${entry.key}: ${entry.count}`);
  }
  for (const entry of report.communities.provisioningCounts) {
    console.log(`  provisioning.${entry.key}: ${entry.count}`);
  }
  if (report.communities.registryCounts) {
    for (const entry of report.communities.registryCounts) {
      console.log(`  registry.${entry.key}: ${entry.count}`);
    }
  }
  for (const row of report.communities.rows) {
    console.log(
      `  community: ${row.community_id} status=${row.status} provisioning=${row.provisioning_state} binding=${row.binding_status ?? "null"} url=${row.database_url ?? "null"} key_ver=${row.encryption_key_version ?? "null"}`,
    );
  }

  console.log("");
  console.log("assessment");
  console.log(`- likely_fixture_contamination: ${report.assessment.likelyFixtureContamination ? "yes" : "no"}`);
  console.log(`- likely_real_community_data: ${report.assessment.likelyRealCommunityData ? "yes" : "no"}`);
  console.log(`- mixed_fixture_and_operational_state: ${report.assessment.mixedFixtureAndOperationalState ? "yes" : "no"}`);
  console.log(`- recommendation: ${report.assessment.recommendation}`);
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = requireEnv(options.databaseUrlEnv);
const url = new URL(databaseUrl);
const db = new Bun.SQL(databaseUrl);

try {
  const databaseRows = await db<{ name: string; user: string }[]>`
    SELECT current_database() AS name, current_user AS user
  `;
  const tableNames = await listPublicTables(db);
  const tableCounts = await countTables(db, tableNames);
  const fixtureSignals = await collectFixtureSignals(db, options.sampleLimit);
  const bindings = await collectBindings(db, options.sampleLimit);
  const communities = await collectCommunities(db, options.sampleLimit);

  const report: InventoryReport = {
    database: {
      name: databaseRows[0]?.name ?? "",
      user: databaseRows[0]?.user ?? "",
      host: url.hostname || null,
    },
    tableCounts,
    fixtureSignals,
    bindings,
    communities,
    assessment: buildAssessment({
      fixtureSignals,
      bindings,
      communities,
    }),
  };

  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
} finally {
  await db.end();
}
