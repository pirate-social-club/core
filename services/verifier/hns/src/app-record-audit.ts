import type { PowerDnsZoneSnapshot } from "./pdns-store";

export type ManagedAppRecordAudit = {
  appA: string[];
  appTlsa: string[];
  expectedA: string[];
  expectedTlsa: string[];
  issues: string[];
  status: "ok" | "skipped" | "drift";
  zone: string;
};

export type ManagedAppRecordAuditOptions = {
  allowExplicitAppA?: boolean;
};

function records(zone: PowerDnsZoneSnapshot, name: string, type: string): string[] {
  return zone.rrsets
    .filter((rrset) => rrset.name === name && rrset.type.toUpperCase() === type)
    .flatMap((rrset) => rrset.records)
    .sort();
}

function sameRecords(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((record, index) => record === right[index]);
}

export function auditManagedAppRecords(
  zone: PowerDnsZoneSnapshot,
  options: ManagedAppRecordAuditOptions = {},
): ManagedAppRecordAudit {
  const zoneName = zone.name.replace(/\.$/u, "");
  const appName = `app.${zoneName}`;
  const wildcardA = records(zone, `*.${zoneName}`, "A");
  const apexA = records(zone, zoneName, "A");
  const expectedA = wildcardA.length > 0 ? wildcardA : apexA;
  const appA = records(zone, appName, "A");
  const expectedTlsa = records(zone, `_443._tcp.${zoneName}`, "TLSA");
  const appTlsa = records(zone, `_443._tcp.${appName}`, "TLSA");

  if (expectedA.length === 0) {
    return {
      appA,
      appTlsa,
      expectedA,
      expectedTlsa,
      issues: [],
      status: "skipped",
      zone: zoneName,
    };
  }

  const issues: string[] = [];
  if (appA.length === 0) {
    issues.push("missing_app_a");
  } else if (!options.allowExplicitAppA && !sameRecords(appA, expectedA)) {
    issues.push("app_a_mismatch");
  }
  if (expectedTlsa.length > 0 && !sameRecords(appTlsa, expectedTlsa)) {
    issues.push(appTlsa.length === 0 ? "missing_app_tlsa" : "app_tlsa_mismatch");
  }

  return {
    appA,
    appTlsa,
    expectedA,
    expectedTlsa,
    issues,
    status: issues.length === 0 ? "ok" : "drift",
    zone: zoneName,
  };
}
