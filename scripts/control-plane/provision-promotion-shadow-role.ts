#!/usr/bin/env bun

import { provisionPromotionShadowRole } from "../lib/promotion-shadow-role";

function readOption(name: string): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : (process.argv[index + 1] ?? "");
}

const databaseUrlEnv = readOption("--database-url-env");
const passwordEnv = readOption("--password-env");
if (!databaseUrlEnv || !passwordEnv) {
  console.error(
    "Usage: bun scripts/control-plane/provision-promotion-shadow-role.ts " +
    "--database-url-env OWNER_URL_ENV --password-env SHADOW_PASSWORD_ENV",
  );
  process.exit(1);
}

const databaseUrl = process.env[databaseUrlEnv];
const password = process.env[passwordEnv];
if (!databaseUrl) throw new Error(`missing database URL environment variable: ${databaseUrlEnv}`);
if (!password) throw new Error(`missing password environment variable: ${passwordEnv}`);

const sql = new Bun.SQL(databaseUrl);
try {
  const report = await provisionPromotionShadowRole({ sql, password });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await sql.end();
}
