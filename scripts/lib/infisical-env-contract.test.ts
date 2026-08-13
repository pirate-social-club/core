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

describe("Megapot ticket-pool Infisical contract", () => {
  const required = [
    "REWARD_TICKET_POOLS_ENABLED",
    "MEGAPOT_CHAIN_ID",
    "MEGAPOT_RPC_URL",
    "MEGAPOT_JACKPOT_ADDRESS",
    "MEGAPOT_RANDOM_TICKET_BUYER_ADDRESS",
    "MEGAPOT_TICKET_NFT_ADDRESS",
    "MEGAPOT_USDC_TOKEN_ADDRESS",
    "MEGAPOT_CUSTODY_ADDRESS",
    "MEGAPOT_REFERRER_ADDRESS",
    "MEGAPOT_SOURCE_TAG",
    "MEGAPOT_PURCHASE_OPERATOR_PRIVATE_KEY",
    "MEGAPOT_STAGING_CUSTODY_PRIVATE_KEY",
    "MEGAPOT_PRICE_QUOTE_TTL_SECONDS",
    "MEGAPOT_ENTRY_CUTOFF_SECONDS",
    "MEGAPOT_PURCHASE_REVIEW_TTL_SECONDS",
    "MEGAPOT_SWEEP_STALE_SECONDS",
    "MEGAPOT_ALERT_OWNER",
    "MEGAPOT_ALERT_DESTINATION",
  ] as const;

  test("declares every Base Sepolia staging input in the commerce profile", () => {
    for (const key of required) {
      const spec = ENV_CONTRACT.secrets.find((candidate) =>
        candidate.path === "/services/api" && candidate.key === key
      );
      expect(spec?.requiredness).toBe("required_for_staging");
      expect(COMMERCE_SECRET_IDS).toContain(secretId("/services/api", key));
    }
  });

  test("validates public protocol config without reading secret values", () => {
    const spec = (key: string) =>
      ENV_CONTRACT.secrets.find((candidate) => candidate.key === key)?.validate;
    expect(spec("REWARD_TICKET_POOLS_ENABLED")?.("true")).toBeNull();
    expect(spec("REWARD_TICKET_POOLS_ENABLED")?.("1")).toContain("true or false");
    expect(spec("MEGAPOT_CHAIN_ID")?.("84532")).toBeNull();
    expect(spec("MEGAPOT_RPC_URL")?.("https://sepolia.base.org")).toBeNull();
    expect(spec("MEGAPOT_SOURCE_TAG")?.("pirate-song-pools")).toBeNull();
    expect(spec("MEGAPOT_SOURCE_TAG")?.("x".repeat(33))).toContain("32 bytes");
  });

  test("prevents staging custody keys on mainnet and enforces fresh quotes", () => {
    const check = ENV_CONTRACT.crossPathChecks.find((candidate) =>
      candidate.description.includes("Megapot staging custody")
    );
    const values = new Map([
      [secretId("/services/api", "MEGAPOT_CHAIN_ID"), { path: "/services/api", value: "84532" }],
      [secretId("/services/api", "MEGAPOT_STAGING_CUSTODY_PRIVATE_KEY"), {
        path: "/services/api",
        value: `0x${"a".repeat(64)}`,
      }],
      [secretId("/services/api", "MEGAPOT_PRICE_QUOTE_TTL_SECONDS"), {
        path: "/services/api",
        value: "60",
      }],
      [secretId("/services/api", "MEGAPOT_ENTRY_CUTOFF_SECONDS"), {
        path: "/services/api",
        value: "300",
      }],
    ]);
    expect(check?.check(values)).toEqual({ status: "ok" });
    values.set(secretId("/services/api", "MEGAPOT_CHAIN_ID"), {
      path: "/services/api",
      value: "8453",
    });
    expect(check?.check(values)).toEqual({
      status: "fail",
      message: "staging custody private key must never be configured for Base mainnet",
    });
  });
});

describe("Story signer Infisical contract", () => {
  test("requires isolated role keys and address guards without a catch-all fallback", () => {
    const required = [
      "STORY_OPERATOR_PRIVATE_KEY",
      "STORY_OPERATOR_PKP_ADDRESS",
      "STORY_ENTITLEMENT_CLASS_CONFIGURER_PRIVATE_KEY",
      "STORY_ENTITLEMENT_CLASS_CONFIGURER_ADDRESS",
      "STORY_CDR_WRITER_PRIVATE_KEY",
      "STORY_CDR_WRITER_PKP_ADDRESS",
      "STORY_ACCESS_CONTROLLER_PRIVATE_KEY",
      "STORY_ACCESS_CONTROLLER_PKP_ADDRESS",
      "MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY",
      "MUSIC_PURCHASE_STORY_SETTLEMENT_PKP_ADDRESS",
    ] as const;
    for (const key of required) {
      const spec = ENV_CONTRACT.secrets.find((candidate) => candidate.path === "/services/api" && candidate.key === key);
      expect(spec?.requiredness).toBe("required_for_hosted");
      expect(COMMERCE_SECRET_IDS).toContain(secretId("/services/api", key));
    }
    expect(ENV_CONTRACT.secrets.some((candidate) => candidate.key === "STORY_RUNTIME_PRIVATE_KEY")).toBe(false);
    expect(COMMERCE_SECRET_IDS).not.toContain(secretId("/services/api", "STORY_RUNTIME_PRIVATE_KEY"));
  });

  test("syncs coordinator-exclusive signer secrets without requiring admission readiness", () => {
    for (const key of ["STORY_COORDINATOR_SIGNER_PRIVATE_KEY", "STORY_COORDINATOR_SIGNER_ADDRESS"] as const) {
      const spec = ENV_CONTRACT.secrets.find((candidate) => candidate.path === "/services/api" && candidate.key === key);
      expect(spec?.requiredness).toBe("deferred");
      expect(COMMERCE_SECRET_IDS).toContain(secretId("/services/api", key));
    }
  });
});

describe("hosted song pipeline Infisical contract", () => {
  test("requires preview authentication and the composite read condition in every hosted environment", () => {
    for (const key of ["SONG_PREVIEW_SHARED_SECRET", "STORY_COMPOSITE_READ_CONDITION_ADDRESS"] as const) {
      const spec = ENV_CONTRACT.secrets.find((candidate) => candidate.path === "/services/api" && candidate.key === key);
      expect(spec?.requiredness).toBe("required_for_hosted");
      expect(COMMERCE_SECRET_IDS).toContain(secretId("/services/api", key));
    }
  });
});
