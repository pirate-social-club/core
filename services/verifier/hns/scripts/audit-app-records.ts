#!/usr/bin/env bun

import { auditManagedAppRecords } from "../src/app-record-audit";
import { PowerDnsApiClient } from "../src/pdns-store";

function requireEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function zoneAllowlist(): Set<string> | null {
  const index = Bun.argv.indexOf("--zones");
  if (index < 0) return null;
  const value = Bun.argv[index + 1]?.trim();
  if (!value) throw new Error("--zones requires a comma-separated value");
  return new Set(value.split(",").map((zone) => zone.trim().replace(/\.$/u, "")).filter(Boolean));
}

function explicitAppAAllowlist(): Set<string> {
  const index = Bun.argv.indexOf("--allow-explicit-app-a-zones");
  if (index < 0) return new Set();
  const value = Bun.argv[index + 1]?.trim();
  if (!value) throw new Error("--allow-explicit-app-a-zones requires a comma-separated value");
  return new Set(value.split(",").map((zone) => zone.trim().replace(/\.$/u, "")).filter(Boolean));
}

async function main(): Promise<void> {
  const store = new PowerDnsApiClient({
    apiKey: requireEnv("PDNS_API_KEY"),
    apiUrl: requireEnv("PDNS_API_URL"),
    defaultSoaContent: "unused.invalid. unused.invalid. 0 3600 900 1209600 300",
    serverId: Bun.env.PDNS_SERVER_ID?.trim() || "localhost",
  });
  const allowlist = zoneAllowlist();
  const explicitAppA = explicitAppAAllowlist();
  const audits = [];
  for (const zoneName of await store.listZoneNames()) {
    const normalized = zoneName.replace(/\.$/u, "");
    if (allowlist && !allowlist.has(normalized)) continue;
    const snapshot = await store.getZoneByName(zoneName);
    if (snapshot) {
      audits.push(auditManagedAppRecords(snapshot, {
        allowExplicitAppA: explicitAppA.has(normalized),
      }));
    }
  }
  const drift = audits.filter((audit) => audit.status === "drift");
  console.log(JSON.stringify({
    audited_zones: audits.length,
    drift_zones: drift.length,
    results: audits,
  }, null, 2));
  if (drift.length > 0) process.exitCode = 1;
}

await main();
