import { describe, expect, test } from "bun:test";

import type { PowerDnsZoneSnapshot } from "./pdns-store";
import { auditManagedAppRecords } from "./app-record-audit";

function zone(rrsets: PowerDnsZoneSnapshot["rrsets"]): PowerDnsZoneSnapshot {
  return {
    dnssec: true,
    name: "community.",
    nameservers: ["ns1.community."],
    rrsets,
    serial: 1,
  };
}

describe("managed app record audit", () => {
  test("accepts app A and TLSA records converged with managed records", () => {
    expect(auditManagedAppRecords(zone([
      { name: "community", type: "A", ttl: 300, records: ["192.0.2.1"] },
      { name: "*.community", type: "A", ttl: 300, records: ["192.0.2.2"] },
      { name: "app.community", type: "A", ttl: 300, records: ["192.0.2.2"] },
      { name: "_443._tcp.community", type: "TLSA", ttl: 300, records: ["3 1 1 ABCD"] },
      { name: "_443._tcp.app.community", type: "TLSA", ttl: 300, records: ["3 1 1 ABCD"] },
    ]))).toMatchObject({ status: "ok", issues: [] });
  });

  test("reports both records missing on a legacy managed zone", () => {
    expect(auditManagedAppRecords(zone([
      { name: "community", type: "A", ttl: 300, records: ["192.0.2.1"] },
      { name: "*.community", type: "A", ttl: 300, records: ["192.0.2.2"] },
      { name: "_443._tcp.community", type: "TLSA", ttl: 300, records: ["3 1 1 ABCD"] },
    ]))).toMatchObject({
      expectedA: ["192.0.2.2"],
      issues: ["missing_app_a", "missing_app_tlsa"],
      status: "drift",
    });
  });

  test("skips zones without a managed web address", () => {
    expect(auditManagedAppRecords(zone([
      { name: "community", type: "NS", ttl: 300, records: ["ns1.community."] },
    ])).status).toBe("skipped");
  });
});
