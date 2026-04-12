import { randomUUID } from "node:crypto";

type PromoteCandidateRow = {
  community_id: string;
  primary_database_binding_id: string | null;
  status: string;
  provisioning_state: string;
  binding_status: string | null;
  active_credential_count: number | string;
};

export type ReconcileCommunityProvisioningStateInput = {
  controlPlaneDatabaseUrl: string;
  communityIds?: string[];
  allErrorCommunities?: boolean;
  dryRun?: boolean;
  now?: Date;
};

export type ReconcileCommunityProvisioningStateResult = {
  checkedCommunityCount: number;
  promotedCommunityCount: number;
  communities: Array<{
    communityId: string;
    status: "dry_run" | "promoted" | "skipped";
    reason: string;
  }>;
};

function requireText(value: string | null | undefined, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

async function listCandidates(
  databaseUrl: string,
  communityIds: string[],
): Promise<PromoteCandidateRow[]> {
  const db = new Bun.SQL(databaseUrl);
  const rowsSql = `
    SELECT
      c.community_id,
      c.primary_database_binding_id,
      c.status,
      c.provisioning_state,
      cdb.status AS binding_status,
      COALESCE(active_credentials.active_credential_count, 0) AS active_credential_count
    FROM communities AS c
    LEFT JOIN community_database_bindings AS cdb
      ON cdb.community_database_binding_id = c.primary_database_binding_id
    LEFT JOIN (
      SELECT community_database_binding_id, COUNT(*) AS active_credential_count
      FROM community_db_credentials
      WHERE status = 'active'
      GROUP BY community_database_binding_id
    ) AS active_credentials
      ON active_credentials.community_database_binding_id = c.primary_database_binding_id
  `;

  try {
    if (communityIds.length > 0) {
      return await db.unsafe<PromoteCandidateRow[]>(`
        ${rowsSql}
        WHERE c.community_id IN (${communityIds.map(() => "?").join(", ")})
        ORDER BY c.community_id ASC
      `, communityIds) as PromoteCandidateRow[];
    }

    return await db.unsafe<PromoteCandidateRow[]>(`
      ${rowsSql}
      WHERE c.status = 'active'
        AND c.provisioning_state = 'error'
      ORDER BY c.updated_at ASC, c.community_id ASC
    `) as PromoteCandidateRow[];
  } finally {
    await db.end();
  }
}

function validateCandidate(row: PromoteCandidateRow): string | null {
  if (row.status !== "active") {
    return `status=${row.status}`;
  }
  if (row.provisioning_state !== "error") {
    return `provisioning_state=${row.provisioning_state}`;
  }
  if (!row.primary_database_binding_id) {
    return "missing_primary_database_binding_id";
  }
  if (row.binding_status !== "active") {
    return `binding_status=${row.binding_status ?? "null"}`;
  }
  if (Number(row.active_credential_count) !== 1) {
    return `active_credential_count=${row.active_credential_count}`;
  }
  return null;
}

export async function reconcileCommunityProvisioningState(
  input: ReconcileCommunityProvisioningStateInput,
): Promise<ReconcileCommunityProvisioningStateResult> {
  const controlPlaneDatabaseUrl = requireText(input.controlPlaneDatabaseUrl, "controlPlaneDatabaseUrl");
  const communityIds = [...new Set((input.communityIds ?? []).map((value) => value.trim()).filter(Boolean))];
  const allErrorCommunities = input.allErrorCommunities === true;
  const dryRun = input.dryRun === true;

  if (!allErrorCommunities && communityIds.length === 0) {
    throw new Error("provide at least one --community-id or pass --all-error-communities");
  }

  const candidates = await listCandidates(controlPlaneDatabaseUrl, communityIds);
  const timestamp = nowIso(input.now ?? new Date());
  const db = new Bun.SQL(controlPlaneDatabaseUrl);

  try {
    const communities: ReconcileCommunityProvisioningStateResult["communities"] = [];

    for (const candidate of candidates) {
      const invalidReason = validateCandidate(candidate);
      if (invalidReason) {
        communities.push({
          communityId: candidate.community_id,
          status: "skipped",
          reason: invalidReason,
        });
        continue;
      }

      if (dryRun) {
        communities.push({
          communityId: candidate.community_id,
          status: "dry_run",
          reason: "eligible",
        });
        continue;
      }

      await db.begin(async (tx) => {
        await tx`
          UPDATE communities
          SET provisioning_state = 'active',
              updated_at = ${timestamp}
          WHERE community_id = ${candidate.community_id}
            AND status = 'active'
            AND provisioning_state = 'error'
        `;

        await tx`
          INSERT INTO audit_log (
            audit_event_id,
            actor_type,
            actor_id,
            action,
            target_type,
            target_id,
            community_id,
            metadata_json,
            created_at
          ) VALUES (
            ${makeId("aud")},
            'system',
            NULL,
            'community.provisioning_reconciled_active',
            'community',
            ${candidate.community_id},
            ${candidate.community_id},
            ${JSON.stringify({
              previous_provisioning_state: "error",
              reconciliation_reason: "active_binding_with_active_credential",
            })},
            ${timestamp}
          )
        `;
      });

      communities.push({
        communityId: candidate.community_id,
        status: "promoted",
        reason: "promoted_to_active",
      });
    }

    return {
      checkedCommunityCount: candidates.length,
      promotedCommunityCount: communities.filter((entry) => entry.status === "promoted").length,
      communities,
    };
  } finally {
    await db.end();
  }
}
