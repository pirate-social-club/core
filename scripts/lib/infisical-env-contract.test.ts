import { describe, expect, test } from "bun:test";

import {
  COMMERCE_SECRET_IDS,
  ENV_CONTRACT,
  secretId,
  wranglerApiRequiredSecretNames,
} from "./infisical-env-contract";

const rewardRuntimeKeys = [
  "REWARDS_CAMPAIGN_CHAIN_ID",
  "REWARDS_CAMPAIGN_USDC_TOKEN_ADDRESS",
  "REWARDS_CAMPAIGN_TREASURY_ADDRESS",
  "REWARDS_CAMPAIGN_RPC_URL",
  "REWARDS_CAMPAIGN_ALERT_OWNER",
  "REWARDS_CAMPAIGN_ALERT_DESTINATION",
  "REWARDS_CAMPAIGN_QUOTE_TTL_SECONDS",
  "REWARDS_CAMPAIGN_MIN_BUDGET_CENTS",
  "REWARDS_CAMPAIGN_MAX_BUDGET_CENTS",
  "REWARDS_CAMPAIGN_MAX_REWARD_CENTS",
  "REWARDS_CAMPAIGN_MIN_DURATION_SECONDS",
  "REWARDS_CAMPAIGN_MAX_DURATION_SECONDS",
] as const;

describe("reward campaign Infisical contract", () => {
  test("requires the complete runtime and operator set for staging", () => {
    for (const key of [...rewardRuntimeKeys, "PIRATE_REWARD_CAMPAIGN_OPERATOR_CREDENTIAL"]) {
      const spec = ENV_CONTRACT.secrets.find((candidate) => candidate.path === "/services/api" && candidate.key === key);
      expect(spec?.requiredness).toBe("required_for_staging");
      expect(COMMERCE_SECRET_IDS).toContain(secretId("/services/api", key));
    }
  });

  test("validates chain, HTTPS RPC, and operator credential shapes", () => {
    const spec = (key: string) => ENV_CONTRACT.secrets.find((candidate) => candidate.key === key)?.validate;
    expect(spec("REWARDS_CAMPAIGN_CHAIN_ID")?.("84532")).toBeNull();
    expect(spec("REWARDS_CAMPAIGN_CHAIN_ID")?.("1")).toContain("Base");
    expect(spec("REWARDS_CAMPAIGN_RPC_URL")?.("https://sepolia.base.org")).toBeNull();
    expect(spec("REWARDS_CAMPAIGN_RPC_URL")?.("http://localhost:8545")).toContain("https");
    expect(spec("PIRATE_REWARD_CAMPAIGN_OPERATOR_CREDENTIAL")?.(`opc_${"a".repeat(32)}.${"b".repeat(43)}`)).toBeNull();
    expect(spec("PIRATE_REWARD_CAMPAIGN_OPERATOR_CREDENTIAL")?.("not-a-credential")).toContain("opc_");
  });

  test("keeps the human operator credential out of Worker secret sync", () => {
    const names = wranglerApiRequiredSecretNames("commerce");
    expect(names).toContain("REWARDS_CAMPAIGN_RPC_URL");
    expect(names).not.toContain("PIRATE_REWARD_CAMPAIGN_OPERATOR_CREDENTIAL");
  });

  test("rejects inconsistent campaign guardrails", () => {
    const check = ENV_CONTRACT.crossPathChecks.find((candidate) => candidate.description.includes("Reward campaign"));
    const base = new Map([
      [secretId("/services/api", "REWARDS_CAMPAIGN_QUOTE_TTL_SECONDS"), { path: "/services/api", value: "900" }],
      [secretId("/services/api", "REWARDS_CAMPAIGN_MIN_BUDGET_CENTS"), { path: "/services/api", value: "1000" }],
      [secretId("/services/api", "REWARDS_CAMPAIGN_MAX_BUDGET_CENTS"), { path: "/services/api", value: "1000000" }],
      [secretId("/services/api", "REWARDS_CAMPAIGN_MIN_DURATION_SECONDS"), { path: "/services/api", value: "3600" }],
      [secretId("/services/api", "REWARDS_CAMPAIGN_MAX_DURATION_SECONDS"), { path: "/services/api", value: "7776000" }],
    ]);
    expect(check?.check(base)).toEqual({ status: "ok" });
    base.set(secretId("/services/api", "REWARDS_CAMPAIGN_MIN_BUDGET_CENTS"), { path: "/services/api", value: "2000000" });
    expect(check?.check(base)).toEqual({ status: "fail", message: "minimum budget exceeds maximum" });
  });
});
