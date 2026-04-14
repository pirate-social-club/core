#!/usr/bin/env bun

type Options = {
  sourceDatabaseUrlEnv: string;
  targetDatabaseUrlEnv: string;
  communityIds: string[];
  format: "text" | "json";
};

type CountRow = {
  table_name: string;
  row_count: number | string;
};

type CommunityRow = {
  community_id: string;
  display_name: string;
  creator_user_id: string;
  namespace_verification_id: string | null;
  status: string;
  provisioning_state: string;
  registry_publication_state: string;
};

type UserSignalRow = {
  user_id: string;
  provider_subject: string | null;
  label_display: string | null;
};

type ImportPlan = {
  source: string;
  target: string;
  communityIds: string[];
  communities: CommunityRow[];
  creatorUserIds: string[];
  namespaceVerificationIds: string[];
  counts: Array<{ tableName: string; rowCount: number }>;
  nonProdProviderSubjects: string[];
  recommendedAction: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/plan-control-plane-import.ts --community-id ID [--community-id ID ...]
    [--source-database-url-env ENV_NAME]
    [--target-database-url-env ENV_NAME]
    [--format text|json]

Read-only planner for importing an explicit allow-list of control-plane rows from
one Postgres database into another. This does not write to either database.

Options:
  --community-id ID               Community ID to include. Repeatable.
  --source-database-url-env ENV   Source database URL env var. Default: SOURCE_CONTROL_PLANE_DATABASE_URL
  --target-database-url-env ENV   Target database URL env var. Default: TARGET_CONTROL_PLANE_DATABASE_URL
  --format text|json              Output format. Default: text
  -h, --help                      Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    sourceDatabaseUrlEnv: "SOURCE_CONTROL_PLANE_DATABASE_URL",
    targetDatabaseUrlEnv: "TARGET_CONTROL_PLANE_DATABASE_URL",
    communityIds: [],
    format: "text",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--community-id":
        if (!value) {
          usage();
        }
        options.communityIds.push(value);
        index += 2;
        break;
      case "--source-database-url-env":
        options.sourceDatabaseUrlEnv = value ?? options.sourceDatabaseUrlEnv;
        index += 2;
        break;
      case "--target-database-url-env":
        options.targetDatabaseUrlEnv = value ?? options.targetDatabaseUrlEnv;
        index += 2;
        break;
      case "--format":
        if (value !== "text" && value !== "json") {
          usage();
        }
        options.format = value;
        index += 2;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (options.communityIds.length === 0) {
    usage();
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

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function countValue(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function communityIdListLiteral(communityIds: string[]): string {
  return communityIds.map(quoteLiteral).join(", ");
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

async function currentDatabaseName(db: Bun.SQL): Promise<string> {
  const rows = await db<{ name: string }[]>`SELECT current_database() AS name`;
  return rows[0]?.name ?? "";
}

async function planImport(sourceDb: Bun.SQL, targetDb: Bun.SQL, communityIds: string[]): Promise<ImportPlan> {
  const list = communityIdListLiteral(communityIds);

  const communities = await sourceDb.unsafe<CommunityRow[]>(`
    SELECT
      community_id,
      display_name,
      creator_user_id,
      namespace_verification_id,
      status,
      provisioning_state,
      registry_publication_state
    FROM communities
    WHERE community_id IN (${list})
    ORDER BY community_id
  `);

  const creatorUserIds = [...new Set(communities.map((row) => row.creator_user_id))];
  const namespaceVerificationIds = [
    ...new Set(communities.map((row) => row.namespace_verification_id).filter((value): value is string => Boolean(value))),
  ];

  const userList = creatorUserIds.length > 0 ? creatorUserIds.map(quoteLiteral).join(", ") : "NULL";
  const verificationList =
    namespaceVerificationIds.length > 0 ? namespaceVerificationIds.map(quoteLiteral).join(", ") : "NULL";

  const countQueries: Array<[string, string]> = [
    ["users", `SELECT COUNT(*)::bigint AS row_count FROM users WHERE user_id IN (${userList})`],
    ["auth_provider_links", `SELECT COUNT(*)::bigint AS row_count FROM auth_provider_links WHERE user_id IN (${userList})`],
    ["verification_sessions", `SELECT COUNT(*)::bigint AS row_count FROM verification_sessions WHERE user_id IN (${userList})`],
    ["user_attestations", `SELECT COUNT(*)::bigint AS row_count FROM user_attestations WHERE user_id IN (${userList})`],
    ["global_handles", `SELECT COUNT(*)::bigint AS row_count FROM global_handles WHERE user_id IN (${userList})`],
    ["profiles", `SELECT COUNT(*)::bigint AS row_count FROM profiles WHERE user_id IN (${userList})`],
    ["wallet_attachments", `SELECT COUNT(*)::bigint AS row_count FROM wallet_attachments WHERE user_id IN (${userList})`],
    ["reddit_verification_sessions", `SELECT COUNT(*)::bigint AS row_count FROM reddit_verification_sessions WHERE user_id IN (${userList})`],
    ["external_reputation_snapshots", `SELECT COUNT(*)::bigint AS row_count FROM external_reputation_snapshots WHERE user_id IN (${userList})`],
    ["namespace_verification_sessions", `SELECT COUNT(*)::bigint AS row_count FROM namespace_verification_sessions WHERE user_id IN (${userList})`],
    ["namespace_verifications", `SELECT COUNT(*)::bigint AS row_count FROM namespace_verifications WHERE namespace_verification_id IN (${verificationList})`],
    ["namespace_verification_assertions", `SELECT COUNT(*)::bigint AS row_count FROM namespace_verification_assertions WHERE namespace_verification_id IN (${verificationList})`],
    ["namespace_verification_capabilities", `SELECT COUNT(*)::bigint AS row_count FROM namespace_verification_capabilities WHERE namespace_verification_id IN (${verificationList})`],
    ["namespace_verification_evidence_bundles", `SELECT COUNT(*)::bigint AS row_count FROM namespace_verification_evidence_bundles WHERE namespace_verification_id IN (${verificationList})`],
    ["namespace_verification_revalidation_events", `SELECT COUNT(*)::bigint AS row_count FROM namespace_verification_revalidation_events WHERE namespace_verification_id IN (${verificationList})`],
    ["communities", `SELECT COUNT(*)::bigint AS row_count FROM communities WHERE community_id IN (${list})`],
    ["community_database_bindings", `SELECT COUNT(*)::bigint AS row_count FROM community_database_bindings WHERE community_id IN (${list})`],
    ["community_db_credentials", `SELECT COUNT(*)::bigint AS row_count FROM community_db_credentials WHERE community_database_binding_id IN (SELECT community_database_binding_id FROM community_database_bindings WHERE community_id IN (${list}))`],
    ["community_membership_projections", `SELECT COUNT(*)::bigint AS row_count FROM community_membership_projections WHERE community_id IN (${list})`],
    ["community_post_projections", `SELECT COUNT(*)::bigint AS row_count FROM community_post_projections WHERE community_id IN (${list})`],
    ["community_pricing_policies", `SELECT COUNT(*)::bigint AS row_count FROM community_pricing_policies WHERE community_id IN (${list})`],
    ["community_money_policies", `SELECT COUNT(*)::bigint AS row_count FROM community_money_policies WHERE community_id IN (${list})`],
    ["community_registry_attempts", `SELECT COUNT(*)::bigint AS row_count FROM community_registry_attempts WHERE community_id IN (${list})`],
    ["community_registry_table_refs", `SELECT COUNT(*)::bigint AS row_count FROM community_registry_table_refs WHERE community_id IN (${list})`],
    ["audit_log", `SELECT COUNT(*)::bigint AS row_count FROM audit_log WHERE community_id IN (${list})`],
    ["jobs", `SELECT COUNT(*)::bigint AS row_count FROM jobs WHERE community_id IN (${list})`],
  ];

  if (await tableExists(sourceDb, "community_registry_mutation_attempts")) {
    countQueries.push([
      "community_registry_mutation_attempts",
      `SELECT COUNT(*)::bigint AS row_count FROM community_registry_mutation_attempts WHERE community_id IN (${list})`,
    ]);
  }

  if (await tableExists(sourceDb, "community_gate_rules")) {
    countQueries.push([
      "community_gate_rules",
      `SELECT COUNT(*)::bigint AS row_count FROM community_gate_rules WHERE community_id IN (${list})`,
    ]);
  }

  if (await tableExists(sourceDb, "community_membership_requests")) {
    countQueries.push([
      "community_membership_requests",
      `SELECT COUNT(*)::bigint AS row_count FROM community_membership_requests WHERE community_id IN (${list})`,
    ]);
  }

  const counts: Array<{ tableName: string; rowCount: number }> = [];
  for (const [tableName, query] of countQueries) {
    const rows = await sourceDb.unsafe<{ row_count: number | string }[]>(query);
    counts.push({
      tableName,
      rowCount: countValue(rows[0]?.row_count),
    });
  }

  const userSignals = await sourceDb.unsafe<UserSignalRow[]>(`
    SELECT
      u.user_id,
      apl.provider_subject,
      gh.label_display
    FROM users AS u
    LEFT JOIN auth_provider_links AS apl
      ON apl.user_id = u.user_id
     AND apl.status = 'active'
    LEFT JOIN global_handles AS gh
      ON gh.user_id = u.user_id
     AND gh.status = 'active'
    WHERE u.user_id IN (${userList})
    ORDER BY u.user_id
  `);

  const nonProdProviderSubjects = userSignals
    .map((row) => row.provider_subject ?? "")
    .filter((subject) => subject.startsWith("pirate-dev-upstream|") || subject.startsWith("pirate-staging-upstream|"));

  const recommendedAction = nonProdProviderSubjects.length > 0
    ? "do not import automatically; source rows still carry dev/staging upstream identities"
    : "eligible for explicit keep-list import";

  return {
    source: await currentDatabaseName(sourceDb),
    target: await currentDatabaseName(targetDb),
    communityIds,
    communities,
    creatorUserIds,
    namespaceVerificationIds,
    counts,
    nonProdProviderSubjects,
    recommendedAction,
  };
}

function printText(plan: ImportPlan) {
  console.log("control-plane import plan");
  console.log(`source_database: ${plan.source}`);
  console.log(`target_database: ${plan.target}`);
  console.log(`community_ids: ${plan.communityIds.join(", ")}`);
  console.log("");
  console.log("communities");
  for (const row of plan.communities) {
    console.log(
      `- ${row.community_id}: ${row.display_name} [${row.status}/${row.provisioning_state}/${row.registry_publication_state}]`,
    );
  }
  console.log("");
  console.log("counts");
  for (const count of plan.counts) {
    console.log(`- ${count.tableName}: ${count.rowCount}`);
  }
  console.log("");
  console.log(`creator_user_ids: ${plan.creatorUserIds.join(", ") || "(none)"}`);
  console.log(`namespace_verification_ids: ${plan.namespaceVerificationIds.join(", ") || "(none)"}`);
  console.log(`nonprod_provider_subjects: ${plan.nonProdProviderSubjects.length}`);
  for (const subject of plan.nonProdProviderSubjects) {
    console.log(`- ${subject}`);
  }
  console.log(`recommended_action: ${plan.recommendedAction}`);
}

const options = parseArgs(process.argv.slice(2));
const sourceDatabaseUrl = requireEnv(options.sourceDatabaseUrlEnv);
const targetDatabaseUrl = requireEnv(options.targetDatabaseUrlEnv);

const sourceDb = new Bun.SQL(sourceDatabaseUrl);
const targetDb = new Bun.SQL(targetDatabaseUrl);

try {
  const plan = await planImport(sourceDb, targetDb, options.communityIds);

  if (options.format === "json") {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printText(plan);
  }
} finally {
  await sourceDb.end();
  await targetDb.end();
}
