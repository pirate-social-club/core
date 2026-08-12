import { describe, expect, test } from "bun:test";
import {
  auditUnclaimedZone,
  evaluateUnclaimedZoneGcGuard,
  hashPowerDnsZoneSnapshot,
  hashZoneControlPlaneInventory,
  type ZoneControlPlaneInventory,
} from "./unclaimed-zone-audit";
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

  test("guard returns only a scoped challenge RRset deletion after exact revalidation", () => {
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
        challenge_txt_values: [],
        active_challenge_txt_values: [],
        last_activity_at: null,
        protected: false,
      }],
    };
    const snapshot = zone("tame_impala.", ['"pirate-verification=stale"']);
    const audit = auditUnclaimedZone(snapshot, reviewInventory);
    const result = evaluateUnclaimedZoneGcGuard(audit, snapshot, reviewInventory, {
      expected_zone_serial: snapshot.serial,
      expected_zone_snapshot_sha256: hashPowerDnsZoneSnapshot(snapshot),
      expected_control_plane_inventory_sha256: hashZoneControlPlaneInventory(reviewInventory),
      operator: "operator",
      reason: "remove documented orphan challenge TXT after review",
    });
    expect(result).toEqual({
      allowed: true,
      reason: "all_gc_preconditions_match",
      zone_name: "tame_impala.",
      rrset_name: "_pirate.tame_impala.",
      records: ['"pirate-verification=stale"'],
      expected_zone_serial: 42,
      expected_zone_snapshot_sha256: hashPowerDnsZoneSnapshot(snapshot),
      expected_control_plane_inventory_sha256: hashZoneControlPlaneInventory(reviewInventory),
      operator: "operator",
      reason_text: "remove documented orphan challenge TXT after review",
    });
  });

  test("guard denies a changed serial or snapshot", () => {
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
        challenge_txt_values: [],
        active_challenge_txt_values: [],
        last_activity_at: null,
        protected: false,
      }],
    };
    const snapshot = zone("tame_impala.", ['"pirate-verification=stale"']);
    const changed = { ...snapshot, serial: snapshot.serial + 1 };
    const audit = auditUnclaimedZone(snapshot, reviewInventory);
    const result = evaluateUnclaimedZoneGcGuard(audit, changed, reviewInventory, {
      expected_zone_serial: snapshot.serial,
      expected_zone_snapshot_sha256: hashPowerDnsZoneSnapshot(snapshot),
      expected_control_plane_inventory_sha256: hashZoneControlPlaneInventory(reviewInventory),
      operator: "operator",
      reason: "review",
    });
    expect(result).toEqual({ allowed: false, reason: "zone_snapshot_changed_since_audit" });
  });

  test("guard denies an unmanaged TXT record in the challenge RRset", () => {
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
        challenge_txt_values: [],
        active_challenge_txt_values: [],
        last_activity_at: null,
        protected: false,
      }],
    };
    const snapshot = zone("tame_impala.", ['"pirate-verification=stale"', '"owner-note=keep"']);
    const audit = auditUnclaimedZone(snapshot, reviewInventory);
    const result = evaluateUnclaimedZoneGcGuard(audit, snapshot, reviewInventory, {
      expected_zone_serial: snapshot.serial,
      expected_zone_snapshot_sha256: hashPowerDnsZoneSnapshot(snapshot),
      expected_control_plane_inventory_sha256: hashZoneControlPlaneInventory(reviewInventory),
      operator: "operator",
      reason: "review",
    });
    expect(result).toEqual({ allowed: false, reason: "challenge_rrset_changed_or_contains_unmanaged_records" });
  });

  test("guard requires an attributed reason", () => {
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
        challenge_txt_values: [],
        active_challenge_txt_values: [],
        last_activity_at: null,
        protected: false,
      }],
    };
    const snapshot = zone("tame_impala.", ['"pirate-verification=stale"']);
    const audit = auditUnclaimedZone(snapshot, reviewInventory);
    const result = evaluateUnclaimedZoneGcGuard(audit, snapshot, reviewInventory, {
      expected_zone_serial: snapshot.serial,
      expected_zone_snapshot_sha256: hashPowerDnsZoneSnapshot(snapshot),
      expected_control_plane_inventory_sha256: hashZoneControlPlaneInventory(reviewInventory),
      operator: " ",
      reason: " ",
    });
    expect(result).toEqual({ allowed: false, reason: "operator_and_reason_are_required" });
  });
});
