#!/usr/bin/env bun

import { readFile } from "node:fs/promises";

import {
  auditActivatedDnsObservation,
  type ActivatedDnsObservation,
} from "../src/public-dns-audit";
import { buildDnsQuery, parseDnsAnswers } from "../src/dns-wire";

type GatewayInventory = {
  gateway_ipv4: string[];
  hns_doh_endpoints: string[];
  schema_version: number;
};

type PublicNamespace = {
  community?: { id?: unknown };
  root_label?: unknown;
};

const inventoryPath = new URL(
  "../../../../ops/vps/hns-authoritative-dns/gateway-inventory.json",
  import.meta.url,
);

function requiredStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const strings = value.map((entry) => typeof entry === "string" ? entry.trim() : "").filter(Boolean);
  if (strings.length === 0) throw new Error(`${field} must not be empty`);
  return strings;
}

async function query(endpoint: string, name: string, type: "A" | "TLSA"): Promise<string[]> {
  const id = Math.floor(Math.random() * 0xffff);
  const wire = buildDnsQuery(name, type, id);
  const encoded = Buffer.from(wire).toString("base64url");
  const response = await fetch(`${endpoint}?dns=${encoded}`, {
    headers: { accept: "application/dns-message" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HNS DoH query returned HTTP ${response.status} for type ${type}`);
  const parsed = parseDnsAnswers(new Uint8Array(await response.arrayBuffer()), id);
  if (parsed.rcode !== 0) throw new Error(`HNS DoH query returned rcode ${parsed.rcode} for type ${type}`);
  return parsed.records;
}

async function main(): Promise<void> {
  const rawInventory = JSON.parse(await readFile(inventoryPath, "utf8")) as GatewayInventory;
  if (rawInventory.schema_version !== 1) throw new Error("unsupported gateway inventory schema");
  const endpoints = requiredStrings(rawInventory.hns_doh_endpoints, "hns_doh_endpoints");
  const expectedGatewayIpv4 = requiredStrings(rawInventory.gateway_ipv4, "gateway_ipv4");

  const response = await fetch("https://api.pirate.sc/public-namespaces", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`namespace inventory returned HTTP ${response.status}`);
  const body = await response.json() as { namespaces?: PublicNamespace[] };
  const namespaces = (body.namespaces ?? []).flatMap((namespace) => {
    const root = typeof namespace.root_label === "string" ? namespace.root_label.trim() : "";
    const communityId = typeof namespace.community?.id === "string" ? namespace.community.id.trim() : "";
    return root && communityId ? [{ communityId, root }] : [];
  });
  if (namespaces.length === 0) throw new Error("activated namespace inventory is empty");

  const audits = [];
  for (const namespace of namespaces) {
    for (const endpoint of endpoints) {
      const observation: ActivatedDnsObservation = {
        apexA: await query(endpoint, namespace.root, "A"),
        apexTlsa: await query(endpoint, `_443._tcp.${namespace.root}`, "TLSA"),
        appA: await query(endpoint, `app.${namespace.root}`, "A"),
        appTlsa: await query(endpoint, `_443._tcp.app.${namespace.root}`, "TLSA"),
        communityId: namespace.communityId,
        resolverEndpoint: new URL(endpoint).host,
      };
      audits.push(auditActivatedDnsObservation(observation, expectedGatewayIpv4));
    }
  }

  const drift = audits.filter((audit) => audit.status === "drift");
  console.log(JSON.stringify({
    activated_communities: namespaces.length,
    resolver_observations: audits.length,
    drift_observations: drift.length,
    results: audits,
  }, null, 2));
  if (drift.length > 0) process.exitCode = 1;
}

await main();
