import { createHash } from "node:crypto";
import type { PowerDnsZoneSnapshot } from "./pdns-store";

export type ZoneControlPlaneInventoryRoot = {
  normalized_root_label: string;
  active_attachment_count: number;
  active_verification_count: number;
  pending_session_count: number;
  delegation_state_present: boolean;
  canonical_routing_eligible: boolean;
  routing_hard_denied: boolean;
  challenge_txt_values: string[];
  active_challenge_txt_values: string[];
  last_activity_at: string | null;
  protected: boolean;
};

export type ZoneControlPlaneInventory = {
  schema_version: "hns-zone-control-plane-v1";
  generated_at: string;
  roots: ZoneControlPlaneInventoryRoot[];
};

export type UnclaimedZoneAuditStatus =
  | "protected"
  | "review_candidate"
  | "unknown_control_plane_root"
  | "no_challenge_rrset"
  | "reserved_zone";

export type UnclaimedZoneAudit = {
  zone_name: string;
  status: UnclaimedZoneAuditStatus;
  safe_to_delete: false;
  reason: string;
  serial: number;
  challenge_records: string[];
  challenge_values: string[];
  control_plane: ZoneControlPlaneInventoryRoot | null;
  zone_snapshot_sha256: string;
  control_plane_inventory_sha256: string;
};

export type UnclaimedZoneGcGuardRequest = {
  expected_zone_serial: number;
  expected_zone_snapshot_sha256: string;
  expected_control_plane_inventory_sha256: string;
  operator: string;
  reason: string;
};

export type UnclaimedZoneGcDecision =
  | {
      allowed: true;
      reason: "all_gc_preconditions_match";
      zone_name: string;
      rrset_name: string;
      records: string[];
      expected_zone_serial: number;
      expected_zone_snapshot_sha256: string;
      expected_control_plane_inventory_sha256: string;
      operator: string;
      reason_text: string;
    }
  | {
      allowed: false;
      reason: string;
    };

const RESERVED_ROOTS = new Set(["pirate", "clawitzer"]);

function rootLabel(zoneName: string): string {
  return zoneName.replace(/\.$/u, "").toLowerCase();
}

function challengeRrsetName(root: string): string {
  return `_pirate.${root}.`;
}

function txtValue(record: string): string {
  const trimmed = record.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
  return trimmed;
}

export function hashPowerDnsZoneSnapshot(snapshot: PowerDnsZoneSnapshot): string {
  const stable = {
    name: snapshot.name,
    serial: snapshot.serial,
    dnssec: snapshot.dnssec,
    nameservers: [...snapshot.nameservers].sort(),
    rrsets: [...snapshot.rrsets]
      .map((rrset) => ({
        name: rrset.name,
        type: rrset.type,
        ttl: rrset.ttl,
        records: [...rrset.records].sort(),
      }))
      .sort((left, right) => `${left.name}|${left.type}`.localeCompare(`${right.name}|${right.type}`)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function hashZoneControlPlaneInventory(inventory: ZoneControlPlaneInventory): string {
  const stable = {
    schema_version: inventory.schema_version,
    generated_at: inventory.generated_at,
    roots: [...inventory.roots]
      .map((root) => ({
        ...root,
        challenge_txt_values: [...root.challenge_txt_values].sort(),
        active_challenge_txt_values: [...root.active_challenge_txt_values].sort(),
      }))
      .sort((left, right) => left.normalized_root_label.localeCompare(right.normalized_root_label)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function challengeRecords(snapshot: PowerDnsZoneSnapshot, root: string): string[] {
  return snapshot.rrsets
    .filter((rrset) => rrset.type.toUpperCase() === "TXT" && rrset.name.toLowerCase() === challengeRrsetName(root))
    .flatMap((rrset) => rrset.records)
    .filter((record) => /^"?pirate-verification=[^"\r\n]+"?$/u.test(record.trim()));
}

function allChallengeRrsetRecords(snapshot: PowerDnsZoneSnapshot, root: string): string[] {
  return snapshot.rrsets
    .filter((rrset) => rrset.type.toUpperCase() === "TXT" && rrset.name.toLowerCase() === challengeRrsetName(root))
    .flatMap((rrset) => rrset.records);
}

export function auditUnclaimedZone(
  snapshot: PowerDnsZoneSnapshot,
  inventory: ZoneControlPlaneInventory,
): UnclaimedZoneAudit {
  const root = rootLabel(snapshot.name);
  const controlPlane = inventory.roots.find((entry) => entry.normalized_root_label === root) ?? null;
  const records = challengeRecords(snapshot, root);
  const values = records.map(txtValue);
  const inventorySha256 = hashZoneControlPlaneInventory(inventory);

  let status: UnclaimedZoneAuditStatus;
  let reason: string;
  if (RESERVED_ROOTS.has(root)) {
    status = "reserved_zone";
    reason = "shared_authoritative_zone_is_never_a_gc_target";
  } else if (!controlPlane) {
    status = "unknown_control_plane_root";
    reason = "control_plane_inventory_has_no_root_record";
  } else if (controlPlane.protected || values.some((value) => controlPlane.active_challenge_txt_values.includes(value))) {
    status = "protected";
    reason = "active_attachment_session_delegation_or_denial_protects_root";
  } else if (records.length === 0) {
    status = "no_challenge_rrset";
    reason = "zone_has_no_managed_pirate_challenge_txt_to_review";
  } else {
    status = "review_candidate";
    reason = "challenge_txt_is_not_referenced_by_active_control_plane_evidence";
  }

  return {
    zone_name: snapshot.name,
    status,
    safe_to_delete: false,
    reason,
    serial: snapshot.serial,
    challenge_records: records,
    challenge_values: values,
    control_plane: controlPlane,
    zone_snapshot_sha256: hashPowerDnsZoneSnapshot(snapshot),
    control_plane_inventory_sha256: inventorySha256,
  };
}

export function auditUnclaimedZones(
  snapshots: PowerDnsZoneSnapshot[],
  inventory: ZoneControlPlaneInventory,
): UnclaimedZoneAudit[] {
  return snapshots
    .map((snapshot) => auditUnclaimedZone(snapshot, inventory))
    .sort((left, right) => left.zone_name.localeCompare(right.zone_name));
}

/**
 * Pure guard for a future, explicitly authorized GC command. This function
 * never talks to PowerDNS and never marks an audit as safe to delete. The
 * eventual mutator must re-read the zone and inventory immediately before
 * calling it, then apply only the returned `_pirate.<root>` TXT deletion.
 */
export function evaluateUnclaimedZoneGcGuard(
  audit: UnclaimedZoneAudit,
  currentSnapshot: PowerDnsZoneSnapshot,
  inventory: ZoneControlPlaneInventory,
  request: UnclaimedZoneGcGuardRequest,
): UnclaimedZoneGcDecision {
  const currentAudit = auditUnclaimedZone(currentSnapshot, inventory);
  const currentRoot = rootLabel(currentSnapshot.name);
  const currentRrsetRecords = allChallengeRrsetRecords(currentSnapshot, currentRoot);

  if (request.operator.trim().length === 0 || request.reason.trim().length === 0) {
    return { allowed: false, reason: "operator_and_reason_are_required" };
  }
  if (audit.status !== "review_candidate" || currentAudit.status !== "review_candidate") {
    return { allowed: false, reason: "zone_is_not_a_current_review_candidate" };
  }
  if (audit.zone_name !== currentSnapshot.name || audit.serial !== request.expected_zone_serial) {
    return { allowed: false, reason: "zone_identity_or_serial_does_not_match_audit" };
  }
  if (request.expected_zone_snapshot_sha256 !== audit.zone_snapshot_sha256
    || hashPowerDnsZoneSnapshot(currentSnapshot) !== request.expected_zone_snapshot_sha256) {
    return { allowed: false, reason: "zone_snapshot_changed_since_audit" };
  }
  const inventorySha256 = hashZoneControlPlaneInventory(inventory);
  if (request.expected_control_plane_inventory_sha256 !== audit.control_plane_inventory_sha256
    || inventorySha256 !== request.expected_control_plane_inventory_sha256) {
    return { allowed: false, reason: "control_plane_inventory_changed_since_audit" };
  }
  if (currentRrsetRecords.length === 0 || currentRrsetRecords.length !== currentAudit.challenge_records.length) {
    return { allowed: false, reason: "challenge_rrset_changed_or_contains_unmanaged_records" };
  }
  if (currentAudit.control_plane === null || currentAudit.control_plane.protected) {
    return { allowed: false, reason: "control_plane_evidence_protects_root" };
  }

  return {
    allowed: true,
    reason: "all_gc_preconditions_match",
    zone_name: currentSnapshot.name,
    rrset_name: challengeRrsetName(currentRoot),
    records: currentAudit.challenge_records,
    expected_zone_serial: request.expected_zone_serial,
    expected_zone_snapshot_sha256: request.expected_zone_snapshot_sha256,
    expected_control_plane_inventory_sha256: request.expected_control_plane_inventory_sha256,
    operator: request.operator.trim(),
    reason_text: request.reason.trim(),
  };
}
