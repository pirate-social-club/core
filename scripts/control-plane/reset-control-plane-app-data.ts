#!/usr/bin/env bun

type Options = {
  confirmReset: string;
  databaseUrlEnv: string;
  execute: boolean;
};

type TableCount = {
  tableName: string;
  rowCount: number;
};

const PRESERVED_TABLES = new Set(["schema_migrations"]);
const REQUIRED_CONFIRMATION = "prod-app-data";

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/control-plane/reset-control-plane-app-data.ts --database-url-env ENV_NAME [--execute --confirm-reset prod-app-data]

Truncates all public control-plane app tables while preserving schema_migrations.
By default this command is a dry run.

Options:
  --database-url-env ENV_NAME       Environment variable containing the database URL.
  --execute                         Actually run TRUNCATE. Omit for dry-run.
  --confirm-reset prod-app-data     Required with --execute.
  -h, --help                        Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    confirmReset: "",
    databaseUrlEnv: "",
    execute: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    switch (arg) {
      case "--database-url-env":
        options.databaseUrlEnv = argv[index + 1] ?? "";
        index += 2;
        break;
      case "--execute":
        options.execute = true;
        index += 1;
        break;
      case "--confirm-reset":
        options.confirmReset = argv[index + 1] ?? "";
        index += 2;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.databaseUrlEnv) {
    usage();
  }

  if (options.execute && options.confirmReset !== REQUIRED_CONFIRMATION) {
    console.error(`--execute requires --confirm-reset ${REQUIRED_CONFIRMATION}`);
    process.exit(1);
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

function countValue(value: number | string | null | undefined): number {
  return Number(value ?? 0);
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

function printCounts(title: string, counts: TableCount[]) {
  console.log(title);
  for (const count of counts) {
    console.log(`- ${count.tableName}: ${count.rowCount}`);
  }
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
  const appTableNames = tableNames.filter((tableName) => !PRESERVED_TABLES.has(tableName));
  const beforeCounts = await countTables(db, tableNames);

  console.log("control-plane app-data reset");
  console.log(`mode: ${options.execute ? "execute" : "dry-run"}`);
  console.log(`database: ${databaseRows[0]?.name ?? ""}`);
  console.log(`user: ${databaseRows[0]?.user ?? ""}`);
  console.log(`host: ${url.hostname || "unknown"}`);
  console.log(`preserved_tables: ${Array.from(PRESERVED_TABLES).join(", ")}`);
  console.log(`target_tables: ${appTableNames.length}`);
  console.log("");
  printCounts("before", beforeCounts);

  if (!options.execute) {
    console.log("");
    console.log("dry-run complete; no data changed");
    process.exit(0);
  }

  if (appTableNames.length > 0) {
    const targetSql = appTableNames
      .map((tableName) => `public.${quoteIdentifier(tableName)}`)
      .join(", ");
    await db.unsafe(`TRUNCATE TABLE ${targetSql} RESTART IDENTITY CASCADE`);
  }

  const afterCounts = await countTables(db, tableNames);
  console.log("");
  printCounts("after", afterCounts);
  console.log("");
  console.log("reset complete");
} finally {
  await db.end();
}
