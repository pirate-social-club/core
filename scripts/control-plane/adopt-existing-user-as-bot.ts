#!/usr/bin/env bun

import { randomBytes } from "node:crypto";

type Options = {
  databaseUrlEnv: string;
  execute: boolean;
  handle: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/control-plane/adopt-existing-user-as-bot.ts --handle HANDLE --execute [--database-url-env ENV_NAME]

Adds a bot auth_provider_links row to an existing active handle so the admin bot
provisioning API can safely adopt it.

Environment:
  CONTROL_PLANE_DATABASE_URL   Default database URL source.

Options:
  --handle HANDLE              Existing active handle, e.g. habibi.pirate.
  --database-url-env ENV_NAME  Env var containing the database URL. Default: CONTROL_PLANE_DATABASE_URL.
  --execute                    Required to write. Without it, the script prints the planned action.
  -h, --help                   Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "CONTROL_PLANE_DATABASE_URL",
    execute: false,
    handle: "",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--handle":
        options.handle = value ?? "";
        index += 2;
        break;
      case "--database-url-env":
        options.databaseUrlEnv = value ?? options.databaseUrlEnv;
        index += 2;
        break;
      case "--execute":
        options.execute = true;
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

  options.handle = options.handle.trim().toLowerCase();
  if (options.handle.endsWith(".pirate")) {
    options.handle = options.handle.slice(0, -".pirate".length);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.handle)) {
    console.error(`invalid handle: ${options.handle}`);
    usage();
  }

  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`missing database url env var: ${name}`);
  }
  return value;
}

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = requireEnv(options.databaseUrlEnv);
const sql = new Bun.SQL(databaseUrl);
const providerSubject = `bot:${options.handle}.pirate`;

try {
  await sql.begin(async (tx) => {
    const handles = await tx<{ user_id: string }[]>`
      SELECT user_id
      FROM global_handles
      WHERE label_normalized = ${options.handle}
        AND status = 'active'
      LIMIT 1
    `;
    const userId = handles[0]?.user_id;
    if (!userId) {
      throw new Error(`active handle not found: ${options.handle}`);
    }

    const existingLinks = await tx<{ provider: string; provider_subject: string }[]>`
      SELECT provider, provider_subject
      FROM auth_provider_links
      WHERE user_id = ${userId}
        AND provider = 'bot'
        AND status = 'active'
      LIMIT 1
    `;
    const existingLink = existingLinks[0];
    if (existingLink) {
      if (existingLink.provider_subject !== providerSubject) {
        throw new Error(
          `user already has a different active bot subject: ${existingLink.provider_subject}`,
        );
      }
      console.log(`ok existing bot link user_id=${userId} provider_subject=${providerSubject}`);
      return;
    }

    console.log(`plan add bot link user_id=${userId} provider_subject=${providerSubject}`);
    if (!options.execute) {
      console.log("dry-run only; pass --execute to write");
      return;
    }

    await tx`
      INSERT INTO auth_provider_links (
        auth_provider_link_id, user_id, provider, provider_subject, provider_user_ref,
        status, linked_at, revoked_at, created_at, updated_at
      ) VALUES (
        ${makeId("apl")}, ${userId}, 'bot', ${providerSubject}, ${providerSubject},
        'active', NOW(), NULL, NOW(), NOW()
      )
    `;
    console.log(`inserted bot link user_id=${userId} provider_subject=${providerSubject}`);
  });
} finally {
  await sql.end();
}
