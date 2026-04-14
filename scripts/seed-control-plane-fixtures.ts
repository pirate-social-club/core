#!/usr/bin/env bun

import { seedControlPlaneFixtures } from "./lib/control-plane-fixtures";

type Options = {
  databaseUrlEnv: string;
  allowProduction: boolean;
  userId: string;
  subject: string;
  providerSubject?: string;
  handle: string;
  namespaceLabel: string;
  redditUsername: string;
  provider: string;
  issuer: string;
};

function usage(): never {
  console.error(`Usage:
  bun scripts/seed-control-plane-fixtures.ts --database-url-env ENV_NAME [options]

Seeds deterministic control-plane fixtures for the JWT-first, no-browser execution path.

Options:
  --database-url-env ENV_NAME  Environment variable containing the control-plane DB URL. Required.
  --user-id ID                 Default: usr_demo_01
  --subject SUB                Default: demo-subject-01
  --provider-subject VALUE     Optional explicit override. Default: "\${issuer}|\${subject}"
  --handle LABEL               Default: demo
  --namespace-label LABEL      Default: demo
  --reddit-username NAME       Default: technohippie
  --provider NAME              Default: jwt
  --issuer ISS                 Default: pirate-dev-upstream
  --allow-production           Allow writes to Neon-hosted databases. Default: false
  -h, --help                   Show this help text.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    databaseUrlEnv: "",
    allowProduction: false,
    userId: "usr_demo_01",
    subject: "demo-subject-01",
    handle: "demo",
    namespaceLabel: "demo",
    redditUsername: "technohippie",
    provider: "jwt",
    issuer: "pirate-dev-upstream",
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case "--database-url-env":
        options.databaseUrlEnv = value ?? "";
        index += 2;
        break;
      case "--user-id":
        options.userId = value ?? options.userId;
        index += 2;
        break;
      case "--subject":
        options.subject = value ?? options.subject;
        index += 2;
        break;
      case "--provider-subject":
        options.providerSubject = value;
        index += 2;
        break;
      case "--handle":
        options.handle = value ?? options.handle;
        index += 2;
        break;
      case "--namespace-label":
        options.namespaceLabel = value ?? options.namespaceLabel;
        index += 2;
        break;
      case "--reddit-username":
        options.redditUsername = value ?? options.redditUsername;
        index += 2;
        break;
      case "--provider":
        options.provider = value ?? options.provider;
        index += 2;
        break;
      case "--issuer":
        options.issuer = value ?? options.issuer;
        index += 2;
        break;
      case "--allow-production":
        options.allowProduction = true;
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

  if (!options.databaseUrlEnv) {
    usage();
  }

  return options;
}

function assertSafeTargetDatabaseUrl(databaseUrl: string, allowProduction: boolean) {
  let hostname = "";
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return;
  }

  if (hostname.includes(".neon.tech") && !allowProduction) {
    console.error(
      "refusing to seed fixtures into a Neon-hosted database without --allow-production",
    );
    process.exit(1);
  }
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = process.env[options.databaseUrlEnv];

if (!databaseUrl) {
  console.error(`missing database url env var: ${options.databaseUrlEnv}`);
  process.exit(1);
}

assertSafeTargetDatabaseUrl(databaseUrl, options.allowProduction);

const result = await seedControlPlaneFixtures({
  databaseUrl,
  userId: options.userId,
  subject: options.subject,
  providerSubject: options.providerSubject,
  handle: options.handle,
  namespaceLabel: options.namespaceLabel,
  redditUsername: options.redditUsername,
  provider: options.provider,
  issuer: options.issuer,
});

console.log(`fixture seed complete
env: ${options.databaseUrlEnv}
user_id: ${result.userId}
provider: ${result.provider}
issuer: ${result.issuer}
subject: ${result.subject}
provider_subject: ${result.providerSubject}
global_handle: ${result.globalHandle}
reddit_username: ${result.redditUsername}
namespace_verification_id: ${result.namespaceVerificationId}
assertions: ${result.assertionsJson}
capabilities: ${result.capabilitiesJson}`);
