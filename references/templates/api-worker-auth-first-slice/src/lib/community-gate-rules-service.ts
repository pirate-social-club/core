import type { AuthBootstrapStore } from "./db";
import type { CommunityGateRuleRow } from "../types/db";
import type { Env } from "../types/env";
import { loadCommunityGateRuleBoundary } from "./community-gate-rule-boundary";
import { parseErc721GateConfig } from "./community-erc721-gate";
import { badRequestError, notFoundError } from "./errors";
import { createId } from "./ids";
import { nowIso } from "./time";

type GateRuleResponse = {
  gate_rule_id: string;
  community_id: string;
  scope: CommunityGateRuleRow["scope"];
  gate_family: CommunityGateRuleRow["gate_family"];
  gate_type: CommunityGateRuleRow["gate_type"];
  proof_requirements: unknown[] | null;
  chain_namespace: string | null;
  gate_config: Record<string, unknown> | null;
  status: CommunityGateRuleRow["status"];
  created_at: string;
  updated_at: string;
};

type UpsertGateRuleBody = {
  gate_rule_id?: string;
  scope?: CommunityGateRuleRow["scope"];
  gate_family?: CommunityGateRuleRow["gate_family"];
  gate_type?: CommunityGateRuleRow["gate_type"];
  proof_requirements?: unknown[] | null;
  chain_namespace?: string | null;
  gate_config?: Record<string, unknown> | null;
  status?: CommunityGateRuleRow["status"];
};

function serializeGateRule(row: CommunityGateRuleRow): GateRuleResponse {
  return {
    gate_rule_id: row.gate_rule_id,
    community_id: row.community_id,
    scope: row.scope,
    gate_family: row.gate_family,
    gate_type: row.gate_type,
    proof_requirements: row.proof_requirements_json ? (JSON.parse(row.proof_requirements_json) as unknown[]) : null,
    chain_namespace: row.chain_namespace,
    gate_config: row.gate_config_json ? (JSON.parse(row.gate_config_json) as Record<string, unknown>) : null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateIdentityGate(body: UpsertGateRuleBody): {
  chain_namespace: null;
  proof_requirements_json: string | null;
  gate_config_json: string | null;
} {
  if (
    body.gate_type !== "unique_human" &&
    body.gate_type !== "age_over_18" &&
    body.gate_type !== "nationality" &&
    body.gate_type !== "gender" &&
    body.gate_type !== "sanctions_clear" &&
    body.gate_type !== "wallet_score"
  ) {
    throw badRequestError(`Unsupported identity gate type ${String(body.gate_type)}`);
  }

  return {
    chain_namespace: null,
    proof_requirements_json: body.proof_requirements == null ? null : JSON.stringify(body.proof_requirements),
    gate_config_json: body.gate_config == null ? null : JSON.stringify(body.gate_config),
  };
}

function validateTokenGate(body: UpsertGateRuleBody): {
  chain_namespace: string | null;
  proof_requirements_json: string | null;
  gate_config_json: string | null;
} {
  if (body.gate_type !== "erc721_holding") {
    throw badRequestError(`Unsupported token gate type ${String(body.gate_type)}`);
  }

  const parsed = parseErc721GateConfig(body.gate_config);
  if (body.chain_namespace && body.chain_namespace !== parsed.chain_namespace) {
    throw badRequestError("chain_namespace must match gate_config.chain_namespace");
  }

  return {
    chain_namespace: parsed.chain_namespace,
    proof_requirements_json: body.proof_requirements == null ? null : JSON.stringify(body.proof_requirements),
    gate_config_json: JSON.stringify(parsed),
  };
}

export async function listCommunityGateRules(input: {
  communityId: string;
  store: AuthBootstrapStore;
}): Promise<GateRuleResponse[]> {
  const community = await input.store.getCommunityById(input.communityId);
  if (!community) {
    throw notFoundError("Community not found");
  }

  const gateRuleBoundary = await loadCommunityGateRuleBoundary(input.store, input.communityId);
  const rows = gateRuleBoundary
    ? await gateRuleBoundary.listRules(input.communityId)
    : await input.store.listCommunityGateRules(input.communityId);
  return rows.map(serializeGateRule);
}

export async function upsertCommunityGateRule(input: {
  communityId: string;
  requestBody: UpsertGateRuleBody;
  store: AuthBootstrapStore;
  env: Env;
  actorId?: string | null;
  now?: Date;
}): Promise<GateRuleResponse> {
  const community = await input.store.getCommunityById(input.communityId);
  if (!community) {
    throw notFoundError("Community not found");
  }

  if (!input.requestBody.scope || !input.requestBody.gate_family || !input.requestBody.gate_type) {
    throw badRequestError("scope, gate_family, and gate_type are required");
  }

  const now = input.now ?? new Date();
  const timestamp = nowIso(now);

  const normalized =
    input.requestBody.gate_family === "identity_proof"
      ? validateIdentityGate(input.requestBody)
      : validateTokenGate(input.requestBody);

  const gateRuleId = input.requestBody.gate_rule_id ?? createId("gate");
  const gateRuleBoundary = await loadCommunityGateRuleBoundary(input.store, input.communityId);
  const canonicalStored = gateRuleBoundary
    ? await gateRuleBoundary.withTransaction(async (communityTx) => {
        const existing = input.requestBody.gate_rule_id
          ? await communityTx.getRuleById(input.requestBody.gate_rule_id)
          : null;
        if (existing && existing.community_id !== input.communityId) {
          throw notFoundError("Community gate rule not found");
        }

        await communityTx.upsertRule({
          gate_rule_id: gateRuleId,
          community_id: input.communityId,
          scope: input.requestBody.scope as CommunityGateRuleRow["scope"],
          gate_family: input.requestBody.gate_family as CommunityGateRuleRow["gate_family"],
          gate_type: input.requestBody.gate_type as CommunityGateRuleRow["gate_type"],
          proof_requirements_json: normalized.proof_requirements_json,
          chain_namespace: normalized.chain_namespace,
          gate_config_json: normalized.gate_config_json,
          status: input.requestBody.status ?? "active",
          created_at: existing?.created_at ?? timestamp,
          updated_at: timestamp,
        });

        return communityTx.getRuleById(gateRuleId);
      })
    : null;
  const stored = await input.store.withTransaction(async (tx) => {
    const existing = input.requestBody.gate_rule_id
      ? await tx.getCommunityGateRuleById(input.requestBody.gate_rule_id)
      : null;
    if (existing && existing.community_id !== input.communityId) {
      throw notFoundError("Community gate rule not found");
    }
    await tx.upsertCommunityGateRule({
      gate_rule_id: gateRuleId,
      community_id: input.communityId,
      scope: input.requestBody.scope as CommunityGateRuleRow["scope"],
      gate_family: input.requestBody.gate_family as CommunityGateRuleRow["gate_family"],
      gate_type: input.requestBody.gate_type as CommunityGateRuleRow["gate_type"],
      proof_requirements_json: normalized.proof_requirements_json,
      chain_namespace: normalized.chain_namespace,
      gate_config_json: normalized.gate_config_json,
      status: input.requestBody.status ?? "active",
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
    });

    await tx.insertAuditLog({
      audit_event_id: createId("audit"),
      actor_type: "operator",
      actor_id: input.actorId ?? "operator",
      action: existing ? "community.gate_rule_updated" : "community.gate_rule_created",
      target_type: "community_gate_rule",
      target_id: gateRuleId,
      community_id: input.communityId,
      metadata_json: JSON.stringify({
        scope: input.requestBody.scope,
        gate_family: input.requestBody.gate_family,
        gate_type: input.requestBody.gate_type,
      }),
      created_at: timestamp,
    });
    return tx.getCommunityGateRuleById(gateRuleId);
  });

  const finalStored = canonicalStored ?? stored;
  if (!finalStored) {
    throw new Error("Stored gate rule could not be loaded");
  }

  return serializeGateRule(finalStored);
}
