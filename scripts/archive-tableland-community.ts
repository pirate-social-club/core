#!/usr/bin/env bun

import { Database } from "@tableland/sdk";
import { JsonRpcProvider, Wallet } from "ethers";

type Options = {
  communityId: string | null;
  status: string;
  tables: string[];
  dryRun: boolean;
};

type TableRow = {
  community_id: string;
  status: string | null;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/archive-tableland-community.ts --community-id ID --table NAME [--table NAME ...] [--status archived] [--dry-run]

Updates the published Tableland rows for a community to the requested status.

Environment:
  BASE_SEPOLIA_RPC_URL        Required.
  TABLELAND_TEST_PRIVATE_KEY  Required.

Options:
  --community-id ID           Community id to update.
  --table NAME                Tableland table to update. Repeat for multiple tables.
  --status VALUE              New status value. Default: archived.
  --dry-run                   Report matching rows without mutating Tableland.
  -h, --help                  Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    communityId: null,
    status: "archived",
    tables: [],
    dryRun: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    switch (arg) {
      case "--community-id":
        options.communityId = String(argv[index + 1] ?? "").trim() || null;
        index += 2;
        break;
      case "--table":
        options.tables.push(String(argv[index + 1] ?? "").trim());
        index += 2;
        break;
      case "--status":
        options.status = String(argv[index + 1] ?? "").trim() || options.status;
        index += 2;
        break;
      case "--dry-run":
        options.dryRun = true;
        index += 1;
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

  if (!options.communityId || options.tables.length === 0) {
    usage();
  }

  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function validateIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return normalized;
}

const options = parseArgs(process.argv.slice(2));
const rpcUrl = requireEnv("BASE_SEPOLIA_RPC_URL");
const privateKey = requireEnv("TABLELAND_TEST_PRIVATE_KEY");

const signer = new Wallet(privateKey, new JsonRpcProvider(rpcUrl));
const db = new Database({
  signer,
  autoWait: true,
});

let updatedTableCount = 0;

for (const tableName of options.tables) {
  const safeTableName = validateIdentifier(tableName, "table name");
  const matchingRows = await db.prepare<TableRow>(`
    SELECT community_id, status
    FROM ${safeTableName}
    WHERE community_id = ?
  `).bind(options.communityId).all();

  if (matchingRows.results.length === 0) {
    console.log(`skip table without matching rows: ${safeTableName}`);
    continue;
  }

  const statuses = [...new Set(matchingRows.results.map((row) => String(row.status ?? "null")))];
  console.log(
    `${options.dryRun ? "would_archive" : "archive"} table: ${safeTableName} rows=${matchingRows.results.length} current_statuses=${statuses.join(",")}`,
  );

  if (!options.dryRun) {
    await db.prepare(`
      UPDATE ${safeTableName}
      SET status = ?
      WHERE community_id = ?
    `).bind(options.status, options.communityId).run();
  }

  updatedTableCount += 1;
}

console.log("");
console.log("tableland community archive complete");
console.log(`community_id: ${options.communityId}`);
console.log(`tables_requested: ${options.tables.length}`);
console.log(`tables_${options.dryRun ? "planned" : "updated"}: ${updatedTableCount}`);
console.log(`status: ${options.status}`);
console.log(`mode: ${options.dryRun ? "dry-run" : "apply"}`);
