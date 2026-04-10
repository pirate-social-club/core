import type { CommunityDatabaseBindingRow, CommunityGateRuleRow } from "../types/db";
import type { AuthBootstrapStore } from "./db";
import { createBunTransactionalSqlExecutor } from "./bun-sql-executor";
import type { SqlExecutor, TransactionalSqlExecutor } from "./sql-auth-bootstrap-store";

export type CommunityGateRuleBoundary = {
  listRules(communityId: string): Promise<CommunityGateRuleRow[]>;
  listActiveRules(communityId: string, scope: CommunityGateRuleRow["scope"]): Promise<CommunityGateRuleRow[]>;
  getRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null>;
  withTransaction<T>(fn: (tx: CommunityGateRuleBoundaryTx) => Promise<T>): Promise<T>;
};

export type CommunityGateRuleBoundaryTx = {
  getRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null>;
  upsertRule(input: {
    gate_rule_id: string;
    community_id: string;
    scope: CommunityGateRuleRow["scope"];
    gate_family: CommunityGateRuleRow["gate_family"];
    gate_type: CommunityGateRuleRow["gate_type"];
    proof_requirements_json: string | null;
    chain_namespace: string | null;
    gate_config_json: string | null;
    status: CommunityGateRuleRow["status"];
    created_at: string;
    updated_at: string;
  }): Promise<void>;
};

function isFileDatabaseBinding(binding: CommunityDatabaseBindingRow | null): binding is CommunityDatabaseBindingRow {
  return binding != null && binding.database_url.startsWith("file://");
}

function gateRuleQueries(db: SqlExecutor): CommunityGateRuleBoundaryTx {
  return {
    getRuleById(gateRuleId) {
      return db.get<CommunityGateRuleRow>(
        `SELECT
           gate_rule_id,
           community_id,
           scope,
           gate_family,
           gate_type,
           proof_requirements_json,
           chain_namespace,
           gate_config_json,
           status,
           created_at,
           updated_at
         FROM community_gate_rules
         WHERE gate_rule_id = :gate_rule_id`,
        {
          gate_rule_id: gateRuleId,
        },
      );
    },
    upsertRule(input) {
      return db.run(
        `INSERT INTO community_gate_rules (
           gate_rule_id,
           community_id,
           scope,
           gate_family,
           gate_type,
           proof_requirements_json,
           chain_namespace,
           gate_config_json,
           status,
           created_at,
           updated_at
         ) VALUES (
           :gate_rule_id,
           :community_id,
           :scope,
           :gate_family,
           :gate_type,
           :proof_requirements_json,
           :chain_namespace,
           :gate_config_json,
           :status,
           :created_at,
           :updated_at
         )
         ON CONFLICT (gate_rule_id) DO UPDATE SET
           community_id = excluded.community_id,
           scope = excluded.scope,
           gate_family = excluded.gate_family,
           gate_type = excluded.gate_type,
           proof_requirements_json = excluded.proof_requirements_json,
           chain_namespace = excluded.chain_namespace,
           gate_config_json = excluded.gate_config_json,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        input,
      );
    },
  };
}

class SqliteCommunityGateRuleBoundary implements CommunityGateRuleBoundary {
  constructor(private readonly db: TransactionalSqlExecutor) {}

  listRules(communityId: string): Promise<CommunityGateRuleRow[]> {
    return this.db.all<CommunityGateRuleRow>(
      `SELECT
         gate_rule_id,
         community_id,
         scope,
         gate_family,
         gate_type,
         proof_requirements_json,
         chain_namespace,
         gate_config_json,
         status,
         created_at,
         updated_at
       FROM community_gate_rules
       WHERE community_id = :community_id
       ORDER BY created_at ASC, gate_rule_id ASC`,
      {
        community_id: communityId,
      },
    );
  }

  listActiveRules(
    communityId: string,
    scope: CommunityGateRuleRow["scope"],
  ): Promise<CommunityGateRuleRow[]> {
    return this.db.all<CommunityGateRuleRow>(
      `SELECT
         gate_rule_id,
         community_id,
         scope,
         gate_family,
         gate_type,
         proof_requirements_json,
         chain_namespace,
         gate_config_json,
         status,
         created_at,
         updated_at
       FROM community_gate_rules
       WHERE community_id = :community_id
         AND scope = :scope
         AND status = 'active'
       ORDER BY created_at ASC, gate_rule_id ASC`,
      {
        community_id: communityId,
        scope,
      },
    );
  }

  getRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
    return gateRuleQueries(this.db).getRuleById(gateRuleId);
  }

  withTransaction<T>(fn: (tx: CommunityGateRuleBoundaryTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(gateRuleQueries(tx)));
  }
}

export async function loadCommunityGateRuleBoundary(
  store: AuthBootstrapStore,
  communityId: string,
): Promise<CommunityGateRuleBoundary | null> {
  const maybeGetBinding = (store as {
    getActiveCommunityDatabaseBinding?: (communityId: string) => Promise<CommunityDatabaseBindingRow | null>;
  }).getActiveCommunityDatabaseBinding;
  if (typeof maybeGetBinding !== "function") {
    return null;
  }

  const binding = await maybeGetBinding.call(store, communityId);
  if (!isFileDatabaseBinding(binding)) {
    return null;
  }

  return new SqliteCommunityGateRuleBoundary(createBunTransactionalSqlExecutor(binding.database_url));
}
