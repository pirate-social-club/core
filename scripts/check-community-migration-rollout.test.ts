import { describe, expect, test } from "bun:test"

import {
  checkCommunityMigrationRollouts,
  GRANDFATHERED_COMMUNITY_MIGRATIONS,
  rolloutContractPath,
} from "./check-community-migration-rollout.mjs"

const migrationPath = "db/community-template/migrations/1157_community_handle_claim_intents.sql"
const contractPath = rolloutContractPath(migrationPath)
const validContract = {
  migration: "1157_community_handle_claim_intents.sql",
  rollout_workflow: "pirate-social-club/web/.github/workflows/community-handle-claim-intents-fleet-migration.yml",
  operator_spec: "scripts/community/apply-community-handle-claim-intents-d1-migration.ts",
  targets: ["staging", "production"],
  audit_before_apply: true,
  production_confirmation: "APPLY 1157 TO PRODUCTION",
}

function check(contract = validContract, changedPaths = [migrationPath, contractPath]) {
  return checkCommunityMigrationRollouts({
    addedMigrationPaths: [migrationPath],
    changedPaths,
    contracts: new Map([[contractPath, contract]]),
  })
}

describe("community migration rollout contracts", () => {
  test("records the reviewed pre-rule grandfathering dates", () => {
    expect(GRANDFATHERED_COMMUNITY_MIGRATIONS.get("1156_song_study_fill_blank.sql")).toEqual({
      mergedAt: "2026-08-12",
      rule: "#531",
      ruleIntroducedAt: "2026-08-13",
      reviewedAt: "2026-08-14",
    })
    expect(GRANDFATHERED_COMMUNITY_MIGRATIONS.get("1158_generic_assets_learning_foundation.sql")).toEqual({
      mergedAt: "2026-08-13",
      rule: "#531",
      ruleIntroducedAt: "2026-08-13",
      reviewedAt: "2026-08-14",
    })
  })

  test("allows migrations merged before rule #531 without fabricating contracts", () => {
    const migration = "db/community-template/migrations/1156_song_study_fill_blank.sql"
    expect(checkCommunityMigrationRollouts({
      addedMigrationPaths: [migration],
      changedPaths: [migration],
      contracts: new Map(),
    })).toEqual([])
  })

  test("requires a contract in the same change as a new migration", () => {
    expect(check(validContract, [migrationPath])).toEqual([
      `${migrationPath}: add ${contractPath} in the same change with its rollout contract`,
    ])
  })

  test("accepts a complete contract", () => {
    expect(check()).toEqual([])
  })

  test("requires both rollout targets and an audit", () => {
    expect(check({
      ...validContract,
      targets: ["production"],
      audit_before_apply: false,
    })).toEqual([
      `${contractPath}: targets must contain staging and production exactly once`,
      `${contractPath}: audit_before_apply must be true`,
    ])
  })

  test("requires a tracked Core operator spec", () => {
    expect(check({
      ...validContract,
      operator_spec: "scripts/community/missing-runner.ts",
    })).toEqual([
      `${contractPath}: operator_spec must name an existing scripts/community/*.ts runner`,
    ])
  })

  test("binds the confirmation to the migration prefix", () => {
    expect(check({
      ...validContract,
      production_confirmation: "APPLY 1156 TO PRODUCTION",
    })).toEqual([
      `${contractPath}: production_confirmation must be \"APPLY 1157 TO PRODUCTION\"`,
    ])
  })

  test("rejects a contract that points at another migration", () => {
    expect(check({
      ...validContract,
      migration: "1156_other_migration.sql",
    })).toEqual([
      `${contractPath}: migration must be \"1157_community_handle_claim_intents.sql\"`,
    ])
  })
})
