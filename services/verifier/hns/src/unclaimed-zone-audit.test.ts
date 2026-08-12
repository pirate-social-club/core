import { describe, expect, test } from "bun:test";
import { auditUnclaimedZone, type ZoneControlPlaneInventory } from "./unclaimed-zone-audit";
import type { PowerDnsZoneSnapshot } from "./pdns-store";

const inventory: ZoneControlPlaneInventory = {
  schema_version: "hns-zone-control-plane-v1",
  generated_at: "2026-08-12T12:00:00.000Z",
  roots: [],
};

function zone(name: string, records: string[]): PowerDnsZoneSnapshot {
  return {
    name,
    serial: 42,
    dnssec: true,
    nameservers: ["ns1.pirate."],
    rrsets: [{ name: `_pirate.${name}`, type: "TXT", ttl: 300, records }],
  };
}

describe("unclaimed HNS zone audit", () => {
  test("never classifies a missing control-plane root as deletable", () => {
    const result = auditUnclaimedZone(zone("unknown.", ['"pirate-verification=old"']), inventory);
    expect(result.status).toBe("unknown_control_plane_root");
    expect(result.safe_to_delete).toBe(false);
  });

  test("reports a stale challenge for review when no active evidence references it", () => {
    const reviewInventory: ZoneControlPlaneInventory = {
      ...inventory,
      roots: [{
        normalized_root_label: "tame_impala",
        active_attachment_count: 0,
        active_verification_count: 0,
        pending_session_count: 0,
        delegation_state_present: false,
        canonical_routing_eligible: false,
        routing_hard_denied: false,
        challenge_txt_values: ["pirate-verification=expired"],
        active_challenge_txt_values: [],
        last_activity_at: "2026-06-01T00:00:00.000Z",
        protected: false,
      }],
    };
    const result = auditUnclaimedZone(zone("tame_impala.", ['"pirate-verification=stale"']), reviewInventory);
    expect(result.status).toBe("review_candidate");
    expect(result.reason).toContain("not_referenced");
    expect(result.zone_snapshot_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.safe_to_delete).toBe(false);
  });

  test("protects a zone whose active challenge is still present", () => {
    const protectedInventory: ZoneControlPlaneInventory = {
      ...inventory,
      roots: [{
        normalized_root_label: "active",
        active_attachment_count: 0,
        active_verification_count: 0,
        pending_session_count: 1,
        delegation_state_present: false,
        canonical_routing_eligible: false,
        routing_hard_denied: false,
        challenge_txt_values: ["pirate-verification=active"],
        active_challenge_txt_values: ["pirate-verification=active"],
        last_activity_at: null,
        protected: true,
      }],
    };
    expect(auditUnclaimedZone(zone("active.", ['"pirate-verification=active"']), protectedInventory).status)
      .toBe("protected");
  });

  test("reserved shared zones are never GC candidates", () => {
    const result = auditUnclaimedZone(zone("pirate.", ['"pirate-verification=old"']), inventory);
    expect(result.status).toBe("reserved_zone");
    expect(result.safe_to_delete).toBe(false);
  });
});
