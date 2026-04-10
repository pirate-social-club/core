import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listCommunityGateRules, upsertCommunityGateRule } from "./lib/community-gate-rules-service";
import type { AuthBootstrapStore, AuthBootstrapTx } from "./lib/db";
import type { CommunityDatabaseBindingRow, CommunityGateRuleRow, CommunityRow } from "./types/db";
import type { Env } from "./types/env";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function buildEnv(): Env {
  return {
    CONTROL_PLANE_DATABASE_URL: "unused",
    AUTH_UPSTREAM_JWT_ISSUER: "unused",
    AUTH_UPSTREAM_JWT_AUDIENCE: "unused",
    AUTH_UPSTREAM_JWT_SHARED_SECRET: "unused",
    PIRATE_APP_JWT_ISSUER: "unused",
    PIRATE_APP_JWT_AUDIENCE: "unused",
    PIRATE_APP_JWT_PUBLIC_KEY: "unused",
    PIRATE_APP_JWT_PRIVATE_KEY: "unused",
    COMMUNITY_GATE_OPERATOR_AUTH_TOKEN: "operator-secret",
  };
}

function buildCommunity(): CommunityRow {
  return {
    community_id: "cmt_01",
    creator_user_id: "usr_owner",
    display_name: "Collectors",
    membership_mode: "gated",
    status: "active",
    provisioning_state: "active",
    transfer_state: "none",
    registry_publication_state: "published",
    registry_attempt_id: null,
    registry_published_at: null,
    registry_publication_job_id: null,
    registry_error_code: null,
    route_slug: null,
    namespace_verification_id: null,
    primary_database_binding_id: null,
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
  };
}

function createBootstrappedCommunityDb() {
  const dir = mkdtempSync(join(tmpdir(), "pirate-community-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "community.db");
  const result = Bun.spawnSync(
    [
      "bash",
      resolve(repoRoot, "scripts/bootstrap-community-db.sh"),
      "--db",
      dbPath,
      "--community-id",
      "cmt_01",
      "--user-id",
      "usr_owner",
      "--display-name",
      "Collectors",
      "--namespace-verification-id",
      "nsv_01",
      "--membership-mode",
      "gated",
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || "failed to bootstrap community db");
  }

  return dbPath;
}

function querySqliteValue(dbPath: string, sql: string): string {
  const result = Bun.spawnSync(["sqlite3", "-noheader", dbPath, sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || "sqlite query failed");
  }

  return new TextDecoder().decode(result.stdout).trim();
}

describe("community gate rules service", () => {
  test("upserts and lists a normalized ERC-721 gate rule", async () => {
    const rules = new Map<string, CommunityGateRuleRow>();
    const community = buildCommunity();

    const tx: Pick<AuthBootstrapTx, "upsertCommunityGateRule" | "insertAuditLog" | "getCommunityGateRuleById"> = {
      async upsertCommunityGateRule(input) {
        rules.set(input.gate_rule_id, {
          gate_rule_id: input.gate_rule_id,
          community_id: input.community_id,
          scope: input.scope,
          gate_family: input.gate_family,
          gate_type: input.gate_type,
          proof_requirements_json: input.proof_requirements_json,
          chain_namespace: input.chain_namespace,
          gate_config_json: input.gate_config_json,
          status: input.status,
          created_at: input.created_at,
          updated_at: input.updated_at,
        });
      },
      async insertAuditLog() {},
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return rules.get(gateRuleId) ?? null;
      },
    };

    const store = {
      async withTransaction<T>(fn: (inner: AuthBootstrapTx) => Promise<T>): Promise<T> {
        return fn(tx as AuthBootstrapTx);
      },
      async getCommunityById(communityId: string): Promise<CommunityRow | null> {
        return communityId === community.community_id ? community : null;
      },
      async listCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]> {
        return [...rules.values()].filter((rule) => rule.community_id === communityId);
      },
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return rules.get(gateRuleId) ?? null;
      },
    } as AuthBootstrapStore;

    const stored = await upsertCommunityGateRule({
      communityId: "cmt_01",
      requestBody: {
        scope: "membership",
        gate_family: "token_holding",
        gate_type: "erc721_holding",
        gate_config: {
          standard: "erc721",
          mode: "contract_any",
          chain_namespace: "eip155:1",
          contract_address: "0x2222222222222222222222222222222222222222",
        },
      },
      store,
      env: buildEnv(),
      actorId: "op_01",
      now: new Date("2026-04-10T00:00:00Z"),
    });

    expect(stored.gate_family).toBe("token_holding");
    expect(stored.gate_type).toBe("erc721_holding");
    expect(stored.chain_namespace).toBe("eip155:1");
    expect(stored.gate_config).toEqual({
      standard: "erc721",
      mode: "contract_any",
      chain_namespace: "eip155:1",
      contract_address: "0x2222222222222222222222222222222222222222",
    });

    const listed = await listCommunityGateRules({
      communityId: "cmt_01",
      store,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.gate_rule_id).toBe(stored.gate_rule_id);
  });

  test("updates an existing gate rule in place and preserves created_at", async () => {
    const rules = new Map<string, CommunityGateRuleRow>([
      [
        "gate_existing",
        {
          gate_rule_id: "gate_existing",
          community_id: "cmt_01",
          scope: "membership",
          gate_family: "token_holding",
          gate_type: "erc721_holding",
          proof_requirements_json: null,
          chain_namespace: "eip155:1",
          gate_config_json: JSON.stringify({
            standard: "erc721",
            mode: "contract_any",
            chain_namespace: "eip155:1",
            contract_address: "0x2222222222222222222222222222222222222222",
          }),
          status: "active",
          created_at: "2026-04-09T00:00:00Z",
          updated_at: "2026-04-09T00:00:00Z",
        },
      ],
    ]);
    const community = buildCommunity();

    const tx: Pick<AuthBootstrapTx, "upsertCommunityGateRule" | "insertAuditLog" | "getCommunityGateRuleById"> = {
      async upsertCommunityGateRule(input) {
        rules.set(input.gate_rule_id, {
          gate_rule_id: input.gate_rule_id,
          community_id: input.community_id,
          scope: input.scope,
          gate_family: input.gate_family,
          gate_type: input.gate_type,
          proof_requirements_json: input.proof_requirements_json,
          chain_namespace: input.chain_namespace,
          gate_config_json: input.gate_config_json,
          status: input.status,
          created_at: input.created_at,
          updated_at: input.updated_at,
        });
      },
      async insertAuditLog() {},
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return rules.get(gateRuleId) ?? null;
      },
    };

    const store = {
      async withTransaction<T>(fn: (inner: AuthBootstrapTx) => Promise<T>): Promise<T> {
        return fn(tx as AuthBootstrapTx);
      },
      async getCommunityById(communityId: string): Promise<CommunityRow | null> {
        return communityId === community.community_id ? community : null;
      },
      async listCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]> {
        return [...rules.values()].filter((rule) => rule.community_id === communityId);
      },
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return rules.get(gateRuleId) ?? null;
      },
    } as AuthBootstrapStore;

    const stored = await upsertCommunityGateRule({
      communityId: "cmt_01",
      requestBody: {
        gate_rule_id: "gate_existing",
        scope: "membership",
        gate_family: "token_holding",
        gate_type: "erc721_holding",
        gate_config: {
          standard: "erc721",
          mode: "token_id_allowlist",
          chain_namespace: "eip155:1",
          contract_address: "0x2222222222222222222222222222222222222222",
          token_ids: ["0x2a"],
        },
      },
      store,
      env: buildEnv(),
      actorId: "op_01",
      now: new Date("2026-04-10T00:00:00Z"),
    });

    expect(stored.gate_rule_id).toBe("gate_existing");
    expect(stored.created_at).toBe("2026-04-09T00:00:00Z");
    expect(stored.updated_at).toBe("2026-04-10T00:00:00.000Z");
    expect(stored.gate_config).toEqual({
      standard: "erc721",
      mode: "token_id_allowlist",
      chain_namespace: "eip155:1",
      contract_address: "0x2222222222222222222222222222222222222222",
      token_ids: ["42"],
    });
  });

  test("writes gate rules into the canonical community db when a binding is active", async () => {
    const dbPath = createBootstrappedCommunityDb();
    const rules = new Map<string, CommunityGateRuleRow>();
    const community = buildCommunity();
    const activeBinding: CommunityDatabaseBindingRow = {
      community_database_binding_id: "cdb_01",
      community_id: "cmt_01",
      binding_role: "primary",
      organization_slug: "local-dev",
      group_name: "club-cmt_01",
      group_id: null,
      database_name: "main",
      database_id: null,
      database_url: `file://${dbPath}`,
      location: "local",
      status: "active",
      transferred_at: null,
      created_at: "2026-04-10T00:00:00Z",
      updated_at: "2026-04-10T00:00:00Z",
    };

    const tx: Pick<AuthBootstrapTx, "upsertCommunityGateRule" | "insertAuditLog" | "getCommunityGateRuleById"> = {
      async upsertCommunityGateRule(input) {
        rules.set(input.gate_rule_id, {
          gate_rule_id: input.gate_rule_id,
          community_id: input.community_id,
          scope: input.scope,
          gate_family: input.gate_family,
          gate_type: input.gate_type,
          proof_requirements_json: input.proof_requirements_json,
          chain_namespace: input.chain_namespace,
          gate_config_json: input.gate_config_json,
          status: input.status,
          created_at: input.created_at,
          updated_at: input.updated_at,
        });
      },
      async insertAuditLog() {},
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return rules.get(gateRuleId) ?? null;
      },
    };

    const store = {
      async withTransaction<T>(fn: (inner: AuthBootstrapTx) => Promise<T>): Promise<T> {
        return fn(tx as AuthBootstrapTx);
      },
      async getCommunityById(communityId: string): Promise<CommunityRow | null> {
        return communityId === community.community_id ? community : null;
      },
      async getActiveCommunityDatabaseBinding(communityId: string): Promise<CommunityDatabaseBindingRow | null> {
        return communityId === community.community_id ? activeBinding : null;
      },
      async listCommunityGateRules(communityId: string): Promise<CommunityGateRuleRow[]> {
        return [...rules.values()].filter((rule) => rule.community_id === communityId);
      },
      async getCommunityGateRuleById(gateRuleId: string): Promise<CommunityGateRuleRow | null> {
        return rules.get(gateRuleId) ?? null;
      },
    } as AuthBootstrapStore;

    const stored = await upsertCommunityGateRule({
      communityId: "cmt_01",
      requestBody: {
        scope: "membership",
        gate_family: "token_holding",
        gate_type: "erc721_holding",
        gate_config: {
          standard: "erc721",
          mode: "contract_any",
          chain_namespace: "eip155:1",
          contract_address: "0x2222222222222222222222222222222222222222",
        },
      },
      store,
      env: buildEnv(),
      actorId: "op_01",
      now: new Date("2026-04-10T00:00:00Z"),
    });

    expect(stored.gate_rule_id).toBeTruthy();
    expect(
      querySqliteValue(
        dbPath,
        `SELECT gate_type FROM community_gate_rules WHERE gate_rule_id = '${stored.gate_rule_id}' LIMIT 1;`,
      ),
    ).toBe("erc721_holding");
    expect(
      querySqliteValue(
        dbPath,
        `SELECT chain_namespace FROM community_gate_rules WHERE gate_rule_id = '${stored.gate_rule_id}' LIMIT 1;`,
      ),
    ).toBe("eip155:1");

    const listed = await listCommunityGateRules({
      communityId: "cmt_01",
      store,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        gate_rule_id: stored.gate_rule_id,
        gate_type: "erc721_holding",
      }),
    ]);
  });
});
