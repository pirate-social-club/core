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

function snapshotHash(snapshot: PowerDnsZoneSnapshot): string {
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

function challengeRecords(snapshot: PowerDnsZoneSnapshot, root: string): string[] {
  return snapshot.rrsets
    .filter((rrset) => rrset.type.toUpperCase() === "TXT" && rrset.name.toLowerCase() === challengeRrsetName(root))
    .flatMap((rrset) => rrset.records)
    .filter((record) => /^"?pirate-verification=[^"\r\n]+"?$/u.test(record.trim()));
}

export function auditUnclaimedZone(
  snapshot: PowerDnsZoneSnapshot,
  inventory: ZoneControlPlaneInventory,
): UnclaimedZoneAudit {
  const root = rootLabel(snapshot.name);
  const controlPlane = inventory.roots.find((entry) => entry.normalized_root_label === root) ?? null;
  const records = challengeRecords(snapshot, root);
  const values = records.map(txtValue);

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
    zone_snapshot_sha256: snapshotHash(snapshot),
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
