import { describe, expect, test } from "bun:test";

import { auditActivatedDnsObservation } from "./public-dns-audit";

const base = {
  apexA: ["192.0.2.10"],
  apexTlsa: ["3 1 1 ABCD"],
  appA: ["192.0.2.10"],
  appTlsa: ["3 1 1 ABCD"],
  communityId: "community_test",
  resolverEndpoint: "dns.example",
};

describe("activated public DNS audit", () => {
  test("accepts records matching independent gateway inventory", () => {
    expect(auditActivatedDnsObservation(base, ["192.0.2.10"])).toMatchObject({
      issues: [],
      status: "ok",
    });
  });

  test("detects stale apex and app addresses even when they agree", () => {
    expect(auditActivatedDnsObservation({
      ...base,
      apexA: ["192.0.2.99"],
      appA: ["192.0.2.99"],
    }, ["192.0.2.10"])).toMatchObject({
      issues: ["apex_a_inventory_mismatch", "app_a_inventory_mismatch"],
      status: "drift",
    });
  });

  test("detects missing and divergent TLSA records", () => {
    expect(auditActivatedDnsObservation({
      ...base,
      appTlsa: ["3 1 1 EFGH"],
    }, ["192.0.2.10"])).toMatchObject({ issues: ["app_tlsa_mismatch"] });
    expect(auditActivatedDnsObservation({
      ...base,
      appTlsa: [],
    }, ["192.0.2.10"])).toMatchObject({ issues: ["missing_app_tlsa"] });
  });
});
