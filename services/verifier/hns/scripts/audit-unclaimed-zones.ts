#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { PowerDnsApiClient } from "../src/pdns-store";
import {
  auditUnclaimedZones,
  type ZoneControlPlaneInventory,
} from "../src/unclaimed-zone-audit";

function requiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1]?.trim() : "";
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

const args = process.argv.slice(2);
if (args.includes("--apply") || args.includes("--delete")) {
  throw new Error("This command is read-only; no GC apply mode exists");
}
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: bun run scripts/audit-unclaimed-zones.ts --control-plane-inventory PATH");
  process.exit(0);
}

const inventoryPath = valueAfter(args, "--control-plane-inventory");
const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as ZoneControlPlaneInventory;
if (inventory.schema_version !== "hns-zone-control-plane-v1") {
  throw new Error("unsupported control-plane inventory schema");
}

const store = new PowerDnsApiClient({
  apiKey: requiredEnv("PDNS_API_KEY"),
  apiUrl: requiredEnv("PDNS_API_URL"),
  defaultSoaContent: "unused.invalid. unused.invalid. 0 3600 900 1209600 300",
  serverId: Bun.env.PDNS_SERVER_ID?.trim() || "localhost",
});

const snapshots = [];
for (const zoneName of await store.listZoneNames()) {
  const snapshot = await store.getZoneByName(zoneName);
  if (snapshot) snapshots.push(snapshot);
}

const results = auditUnclaimedZones(snapshots, inventory);
console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  read_only: true,
  apply_supported: false,
  control_plane_inventory_generated_at: inventory.generated_at,
  zones_audited: results.length,
  review_candidates: results.filter((result) => result.status === "review_candidate").length,
  results,
}, null, 2));
