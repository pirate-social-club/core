import { createHash, X509Certificate } from "node:crypto";

import type { PowerDnsRrsetInput, PowerDnsZoneSnapshot } from "./pdns-store";

export const DANE_EE_SPKI_SHA256_PREFIX = "3 1 1";

const WEB_ADDRESS_TYPES = new Set(["A", "AAAA", "CNAME", "HTTPS", "SVCB"]);

export function normalizeDaneEeAssociation(value: string): string {
  const match = value.trim().match(/^3\s+1\s+1\s+([0-9a-f]{64})$/iu);
  if (!match) {
    throw new Error("TLSA association must be DANE-EE SPKI SHA-256: 3 1 1 <64 hex characters>");
  }
  return `${DANE_EE_SPKI_SHA256_PREFIX} ${match[1]!.toUpperCase()}`;
}

export function parseDaneEeAssociations(value: string | null | undefined): string[] {
  const associations = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeDaneEeAssociation);
  return [...new Set(associations)];
}

export function daneEeAssociationFromCertificatePem(pem: string): string {
  const certificate = new X509Certificate(pem);
  const spki = certificate.publicKey.export({ type: "spki", format: "der" });
  const digest = createHash("sha256").update(spki).digest("hex").toUpperCase();
  return `${DANE_EE_SPKI_SHA256_PREFIX} ${digest}`;
}

export function buildManagedTlsaRrsets(input: {
  zoneName: string;
  ttl: number;
  associations: string[];
  explicitWebHosts?: string[];
}): PowerDnsRrsetInput[] {
  const zoneName = canonical(input.zoneName);
  const associations = [...new Set(input.associations.map(normalizeDaneEeAssociation))];
  if (associations.length === 0) {
    return [];
  }

  const owners = new Set([
    `_443._tcp.${zoneName}`,
    `*.${zoneName}`,
  ]);

  for (const host of input.explicitWebHosts ?? []) {
    const canonicalHost = canonical(host);
    if (!canonicalHost.endsWith(`.${zoneName}`) || canonicalHost.startsWith("*.")) {
      throw new Error(`explicit TLS web host ${host} is not a concrete name inside ${zoneName}`);
    }
    owners.add(`_443._tcp.${canonicalHost}`);
  }

  return [...owners].sort().map((name) => ({
    name,
    type: "TLSA",
    ttl: input.ttl,
    records: associations,
  }));
}

export function deriveExplicitWebHosts(zone: PowerDnsZoneSnapshot): string[] {
  const zoneName = stripTrailingDot(zone.name);
  const nameservers = new Set(zone.nameservers.map(stripTrailingDot));
  const hosts = new Set<string>();

  for (const rrset of zone.rrsets) {
    const name = stripTrailingDot(rrset.name);
    if (
      !WEB_ADDRESS_TYPES.has(rrset.type.toUpperCase())
      || name === zoneName
      || name.startsWith("*.")
      || name.startsWith("_")
      || nameservers.has(name)
      || !name.endsWith(`.${zoneName}`)
    ) {
      continue;
    }
    hosts.add(name);
  }

  return [...hosts].sort();
}

function canonical(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function stripTrailingDot(value: string): string {
  return value.replace(/\.$/u, "");
}
