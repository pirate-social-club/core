#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sanitizePostgresUrlForBunSql } from "../lib/postgres-url";

export type AttestationRepairRow = {
  user_attestation_id: string;
  user_id: string;
  source_verification_session_id: string | null;
  source_identity_nullifier_id: string | null;
  provider: string;
  attestation_type: string;
  capability_key: string | null;
  status: "accepted" | "expired" | "revoked" | "superseded";
  value_json: unknown;
  value_json_text: string;
  verified_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  nullifier_link_count: number;
  valid_nullifier_link_count: number;
  invalid_nullifier_link_count: number;
};

export type SupersedeMutation = {
  userAttestationId: string;
  reason: "provenance_unbound" | "duplicate_active_attestation";
  duplicateGroupKey: string | null;
};

export type ExpireMutation = {
  userAttestationId: string;
};

export type RepairPlan = {
  duplicateGroups: Array<{
    key: string;
    winnerUserAttestationId: string;
    loserUserAttestationIds: string[];
  }>;
  supersede: SupersedeMutation[];
  expire: ExpireMutation[];
};

export type RepairSnapshot = {
  snapshot_version: 1;
  generated_at: string;
  decision_ref: string;
  mode: "dry-run" | "execute";
  database: { name: string; user: string; host: string };
  before_audit: unknown;
  plan: RepairPlan;
  rows: AttestationRepairRow[];
};

type Options = {
  auditBeforeFile: string;
  confirmRepair: string;
  databaseUrlEnv: string;
  decisionRef: string;
  execute: boolean;
  snapshotFile: string;
};

const REQUIRED_CONFIRMATION = "provider-identity-evidence";

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/control-plane/provider-identity-evidence-repair.ts \
    --database-url-env ENV_NAME \
    --audit-before-file FILE \
    --snapshot-file FILE \
    --decision-ref REF \
    [--execute --confirm-repair provider-identity-evidence]

Reconciles provider-keyed identity attestations in one PostgreSQL transaction.
The default is a dry run. The command never updates the derived user projection.

The audit file must be the aggregate, read-only output captured immediately
before the repair. The snapshot contains complete affected rows, including
value_json, and is never overwritten for a decision reference once created.

Options:
  --database-url-env ENV_NAME   Environment variable containing the database URL.
  --audit-before-file FILE      Aggregate audit JSON captured before this run.
  --snapshot-file FILE          Output path for the reversible full-row snapshot.
  --decision-ref REF            Human-reviewed decision/reference identifier.
  --execute                     Apply the planned transitions.
  --confirm-repair VALUE        Required with --execute: provider-identity-evidence.
  -h, --help                    Show this help text.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    auditBeforeFile: "",
    confirmRepair: "",
    databaseUrlEnv: "",
    decisionRef: "",
    execute: false,
    snapshotFile: "",
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--audit-before-file":
        options.auditBeforeFile = value ?? "";
        index += 2;
        break;
      case "--confirm-repair":
        options.confirmRepair = value ?? "";
        index += 2;
        break;
      case "--database-url-env":
        options.databaseUrlEnv = value ?? "";
        index += 2;
        break;
      case "--decision-ref":
        options.decisionRef = value ?? "";
        index += 2;
        break;
      case "--execute":
        options.execute = true;
        index += 1;
        break;
      case "--snapshot-file":
        options.snapshotFile = value ?? "";
        index += 2;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.databaseUrlEnv || !options.auditBeforeFile || !options.snapshotFile || !options.decisionRef) {
    usage();
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/u.test(options.decisionRef)) {
    throw new Error("--decision-ref must be 3-160 characters of [A-Za-z0-9._:/-]");
  }
  if (options.execute && options.confirmRepair !== REQUIRED_CONFIRMATION) {
    throw new Error(`--execute requires --confirm-repair ${REQUIRED_CONFIRMATION}`);
  }
  return options;
}

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`missing database url env var: ${name}`);
  return value;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("user_attestations.value_json was not valid JSON");
  }
}

function numericValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`invalid count returned by PostgreSQL: ${String(value)}`);
  }
  return parsed;
}

function groupKey(row: Pick<AttestationRepairRow, "user_id" | "provider" | "capability_key">): string {
  return [row.user_id, row.provider, row.capability_key ?? ""].join("\u001f");
}

function isEarlierVerifiedRow(left: AttestationRepairRow, right: AttestationRepairRow): boolean {
  const leftVerified = left.verified_at ?? "9999-12-31T23:59:59.999Z";
  const rightVerified = right.verified_at ?? "9999-12-31T23:59:59.999Z";
  return leftVerified.localeCompare(rightVerified) < 0
    || (leftVerified === rightVerified && left.created_at.localeCompare(right.created_at) < 0)
    || (leftVerified === rightVerified
      && left.created_at === right.created_at
      && left.user_attestation_id.localeCompare(right.user_attestation_id) < 0);
}

function chooseDuplicateWinner(rows: AttestationRepairRow[]): AttestationRepairRow {
  return [...rows].sort((left, right) => {
    const leftLinked = left.nullifier_link_count > 0 ? 1 : 0;
    const rightLinked = right.nullifier_link_count > 0 ? 1 : 0;
    if (leftLinked !== rightLinked) return rightLinked - leftLinked;
    if (isEarlierVerifiedRow(left, right)) return -1;
    if (isEarlierVerifiedRow(right, left)) return 1;
    return 0;
  })[0]!;
}

/**
 * Build a fail-closed, deterministic plan from rows locked by the caller.
 * The function deliberately uses the source link only as a ranking signal;
 * invalid links are rejected rather than silently treated as provenance.
 */
export function buildRepairPlan(rows: AttestationRepairRow[], nowMs = Date.now()): RepairPlan {
  for (const row of rows) {
    if (row.expires_at !== null && !Number.isFinite(Date.parse(row.expires_at))) {
      throw new Error(`invalid expires_at requires review: ${row.user_attestation_id}`);
    }
    if (row.verified_at !== null && !Number.isFinite(Date.parse(row.verified_at))) {
      throw new Error(`invalid verified_at requires review: ${row.user_attestation_id}`);
    }
  }
  const activeUniqueHuman = rows.filter((row) =>
    row.status === "accepted"
    && row.capability_key === "unique_human"
    && row.verified_at !== null
    && (row.expires_at === null || Date.parse(row.expires_at) > nowMs)
    && row.nullifier_link_count >= 0,
  );
  for (const row of activeUniqueHuman) {
    if (row.invalid_nullifier_link_count > 0) {
      throw new Error(`invalid nullifier link requires review: ${row.user_attestation_id}`);
    }
  }

  const groups = new Map<string, AttestationRepairRow[]>();
  for (const row of activeUniqueHuman) {
    const key = groupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const duplicateGroups: RepairPlan["duplicateGroups"] = [];
  const supersedeById = new Map<string, SupersedeMutation>();
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const valueTexts = new Set(group.map((row) => row.value_json_text));
    if (valueTexts.size !== 1) {
      throw new Error(`conflicting duplicate values require review: ${key}`);
    }
    const winner = chooseDuplicateWinner(group);
    const losers = group.filter((row) => row.user_attestation_id !== winner.user_attestation_id);
    duplicateGroups.push({
      key,
      winnerUserAttestationId: winner.user_attestation_id,
      loserUserAttestationIds: losers.map((row) => row.user_attestation_id).sort(),
    });
    for (const loser of losers) {
      supersedeById.set(loser.user_attestation_id, {
        userAttestationId: loser.user_attestation_id,
        reason: loser.nullifier_link_count === 0 ? "provenance_unbound" : "duplicate_active_attestation",
        duplicateGroupKey: key,
      });
    }
  }

  for (const row of activeUniqueHuman) {
    if (row.nullifier_link_count === 0 && !supersedeById.has(row.user_attestation_id)) {
      supersedeById.set(row.user_attestation_id, {
        userAttestationId: row.user_attestation_id,
        reason: "provenance_unbound",
        duplicateGroupKey: null,
      });
    }
  }

  const expire = rows
    .filter((row) => row.status === "accepted" && row.expires_at !== null)
    .filter((row) => Date.parse(row.expires_at!) <= nowMs)
    .map((row) => ({ userAttestationId: row.user_attestation_id }));

  return {
    duplicateGroups: duplicateGroups.sort((left, right) => left.key.localeCompare(right.key)),
    supersede: [...supersedeById.values()].sort((left, right) => left.userAttestationId.localeCompare(right.userAttestationId)),
    expire: expire.sort((left, right) => left.userAttestationId.localeCompare(right.userAttestationId)),
  };
}

function supersededValue(reason: SupersedeMutation["reason"], decisionRef: string, duplicateGroupKey: string | null): string {
  const value: Record<string, unknown> = {
    state: "superseded",
    reason,
    ref: decisionRef,
  };
  if (duplicateGroupKey) value.duplicate_group = duplicateGroupKey;
  return JSON.stringify(value);
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeSnapshotOnce(path: string, snapshot: RepairSnapshot): Promise<void> {
  if (existsSync(path)) {
    const existing = readJsonFile(path) as Partial<RepairSnapshot>;
    if (existing.snapshot_version !== 1 || existing.decision_ref !== snapshot.decision_ref) {
      throw new Error(`refusing to overwrite snapshot with a different decision: ${path}`);
    }
    const existingPlan = existing.plan as Partial<RepairPlan> | undefined;
    const existingHasMutations = Boolean(
      existingPlan
      && ((existingPlan.supersede?.length ?? 0) > 0
        || (existingPlan.expire?.length ?? 0) > 0),
    );
    const currentHasMutations = snapshot.plan.supersede.length > 0 || snapshot.plan.expire.length > 0;
    if (currentHasMutations && !existingHasMutations) {
      throw new Error(`current plan is not the plan captured by the existing snapshot: ${path}`);
    }
    if (currentHasMutations && existingHasMutations
      && JSON.stringify(existing.rows) !== JSON.stringify(snapshot.rows)) {
      throw new Error(`current rows differ from the existing decision snapshot: ${path}`);
    }
    return;
  }
  await Bun.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function rowSelectSql(): string {
  return `
    SELECT a.user_attestation_id,
           a.user_id,
           a.source_verification_session_id,
           a.source_identity_nullifier_id,
           a.provider,
           a.attestation_type,
           a.capability_key,
           a.status,
           a.value_json::text AS value_json_text,
           a.verified_at::text AS verified_at,
           a.expires_at::text AS expires_at,
           a.revoked_at::text AS revoked_at,
           a.created_at::text AS created_at,
           a.updated_at::text AS updated_at,
           (
             SELECT COUNT(*)::integer
             FROM identity_nullifiers n
             WHERE n.source_user_attestation_id = a.user_attestation_id
           ) AS nullifier_link_count,
           (
             SELECT COUNT(*)::integer
             FROM identity_nullifiers n
             WHERE n.source_user_attestation_id = a.user_attestation_id
               AND n.status = 'active'
               AND n.user_id = a.user_id
               AND n.provider = a.provider
           ) AS valid_nullifier_link_count,
           (
             SELECT COUNT(*)::integer
             FROM identity_nullifiers n
             WHERE n.source_user_attestation_id = a.user_attestation_id
               AND NOT (
                 n.status = 'active'
                 AND n.user_id = a.user_id
                 AND n.provider = a.provider
               )
           ) AS invalid_nullifier_link_count
    FROM user_attestations a
    WHERE a.status = 'accepted'
      AND (
        (
          a.capability_key = 'unique_human'
          AND a.verified_at IS NOT NULL
          AND a.verified_at <= CURRENT_TIMESTAMP
          AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
        )
        OR (a.expires_at IS NOT NULL AND a.expires_at <= CURRENT_TIMESTAMP)
      )
    ORDER BY a.user_attestation_id ASC
    FOR UPDATE OF a`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const auditBeforeFile = resolve(options.auditBeforeFile);
  const snapshotFile = resolve(options.snapshotFile);
  const beforeAudit = readJsonFile(auditBeforeFile);
  const databaseUrl = requireEnv(options.databaseUrlEnv);
  const parsedDatabaseUrl = new URL(databaseUrl);
  const db = new Bun.SQL(sanitizePostgresUrlForBunSql(databaseUrl));

  try {
    const result = await db.begin(async (tx) => {
      const databaseRows = await tx<{ name: string; user: string }[]>`
        SELECT current_database() AS name, current_user AS user
      `;
      const rows = await tx.unsafe<{
        user_attestation_id: string;
        user_id: string;
        source_verification_session_id: string | null;
        source_identity_nullifier_id: string | null;
        provider: string;
        attestation_type: string;
        capability_key: string | null;
        status: AttestationRepairRow["status"];
        value_json_text: string;
        verified_at: string | null;
        expires_at: string | null;
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
        nullifier_link_count: number | string;
        valid_nullifier_link_count: number | string;
        invalid_nullifier_link_count: number | string;
      }[]>(rowSelectSql());
      const repairRows: AttestationRepairRow[] = rows.map((row) => ({
        ...row,
        value_json: parseJsonValue(row.value_json_text),
        nullifier_link_count: numericValue(row.nullifier_link_count),
        valid_nullifier_link_count: numericValue(row.valid_nullifier_link_count),
        invalid_nullifier_link_count: numericValue(row.invalid_nullifier_link_count),
      }));
      const plan = buildRepairPlan(repairRows, Date.now());
      const snapshot: RepairSnapshot = {
        snapshot_version: 1,
        generated_at: new Date().toISOString(),
        decision_ref: options.decisionRef,
        mode: options.execute ? "execute" : "dry-run",
        database: {
          name: databaseRows[0]?.name ?? "",
          user: databaseRows[0]?.user ?? "",
          host: parsedDatabaseUrl.hostname || "unknown",
        },
        before_audit: beforeAudit,
        plan,
        rows: repairRows,
      };
      await writeSnapshotOnce(snapshotFile, snapshot);

      if (!options.execute) {
        return { plan, snapshot };
      }

      for (const mutation of plan.supersede) {
        const updated = await tx<{ user_attestation_id: string }[]>`
          UPDATE user_attestations
          SET status = 'superseded',
              value_json = CAST(${supersededValue(mutation.reason, options.decisionRef, mutation.duplicateGroupKey)} AS JSONB),
              updated_at = CURRENT_TIMESTAMP
          WHERE user_attestation_id = ${mutation.userAttestationId}
            AND status = 'accepted'
          RETURNING user_attestation_id
        `;
        if (updated.length !== 1) {
          throw new Error(`expected one accepted attestation to supersede: ${mutation.userAttestationId}`);
        }
      }

      for (const mutation of plan.expire) {
        const updated = await tx<{ user_attestation_id: string }[]>`
          UPDATE user_attestations
          SET status = 'expired',
              updated_at = CURRENT_TIMESTAMP
          WHERE user_attestation_id = ${mutation.userAttestationId}
            AND status = 'accepted'
            AND expires_at IS NOT NULL
            AND expires_at <= CURRENT_TIMESTAMP
          RETURNING user_attestation_id
        `;
        if (updated.length !== 1) {
          throw new Error(`expected one stale accepted attestation to expire: ${mutation.userAttestationId}`);
        }
      }

      return { plan, snapshot };
    });

    console.log(`provider identity evidence repair: ${options.execute ? "execute" : "dry-run"}`);
    console.log(`decision_ref: ${options.decisionRef}`);
    console.log(`snapshot: ${snapshotFile}`);
    console.log(`duplicate_groups: ${result.plan.duplicateGroups.length}`);
    console.log(`supersede: ${result.plan.supersede.length}`);
    console.log(`expire: ${result.plan.expire.length}`);
    console.log(options.execute ? "repair committed" : "dry-run complete; no data changed");
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  await main();
}
