#!/usr/bin/env bun

import { sanitizePostgresUrlForBunSql } from "../lib/postgres-url";
import {
  constraintAdmitsGenericStoryAssetKinds,
  GENERIC_STORY_ASSET_KINDS,
} from "../lib/control-plane-generic-story-asset-kinds";

type Options = {
  databaseUrlEnv: string;
};

type ConstraintRow = {
  constraint_name: string;
  constraint_definition: string;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/control-plane/verify-generic-story-asset-kinds.ts --database-url-env ENV_NAME

Read-only production check for the Story projection asset-kind constraint.
The query confirms that the live control plane admits both generic kinds before
the generic Story registration writer is enabled.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  let databaseUrlEnv = "";
  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    switch (arg) {
      case "--database-url-env":
        databaseUrlEnv = String(argv[index + 1] ?? "").trim();
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
  if (!databaseUrlEnv) usage();
  return { databaseUrlEnv };
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = String(process.env[options.databaseUrlEnv] ?? "").trim();
if (!databaseUrl) {
  console.error(`missing database url env var: ${options.databaseUrlEnv}`);
  process.exit(1);
}

const db = new Bun.SQL(sanitizePostgresUrlForBunSql(databaseUrl));
let rows: ConstraintRow[];
try {
  rows = await db<ConstraintRow[]>`
    SELECT
      conname AS constraint_name,
      pg_get_constraintdef(oid) AS constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'public.story_registered_asset_projections'::regclass
      AND conname = 'story_registered_asset_projections_asset_kind_check'
  `;
} finally {
  await db.end();
}

const row = rows[0];
if (!row || !constraintAdmitsGenericStoryAssetKinds(row.constraint_definition)) {
  console.error("production control plane does not admit the complete Story asset-kind registry");
  if (row) console.error(`constraint: ${row.constraint_definition}`);
  process.exit(1);
}

console.log("production control-plane Story asset-kind constraint verified");
console.log(`constraint: ${row.constraint_name}`);
console.log(`definition: ${row.constraint_definition}`);
console.log(`required_kinds: ${GENERIC_STORY_ASSET_KINDS.join(", ")}`);
