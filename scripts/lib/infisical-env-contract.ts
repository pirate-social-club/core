export type Requiredness =
  | "required_now"
  | "required_for_local_dev"
  | "required_for_hosted"
  | "required_for_staging"
  | "required_for_production"
  | "deferred";

export type SecretSpec = {
  path: string;
  key: string;
  requiredness: Requiredness;
  validate?: (value: string) => string | null;
};

export type SecretProfile = "all" | "core" | "happy-path" | "commerce";

export type CrossPathCheckResult = {
  status: "ok" | "skip" | "fail";
  message?: string;
};

export type CrossPathCheck = {
  description: string;
  check: (secrets: Map<string, { path: string; value: string | null }>) => CrossPathCheckResult;
};

export type FolderSpec = {
  path: string;
  requiredness: Requiredness;
};

export type EnvContract = {
  folders: FolderSpec[];
  secrets: SecretSpec[];
  crossPathChecks: CrossPathCheck[];
};

export const SECRET_PROFILES = ["all", "core", "happy-path", "commerce"] as const satisfies readonly SecretProfile[];

function isPostgresUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol)) {
      return `expected postgresql:// URL, got ${url.protocol}//`;
    }
    if (!url.hostname) {
      return "missing hostname";
    }
    return null;
  } catch {
    return "not a valid URL";
  }
}

function isHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return `expected http(s):// URL, got ${url.protocol}//`;
    }
    if (!url.hostname) {
      return "missing hostname";
    }
    return null;
  } catch {
    return "not a valid URL";
  }
}

function isHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return `expected https:// URL, got ${url.protocol}//`;
    }
    if (!url.hostname) {
      return "missing hostname";
    }
    return null;
  } catch {
    return "not a valid URL";
  }
}

function is64CharHex(value: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return "expected 64-character lowercase hex string";
  }
  return null;
}

function is32CharHex(value: string): string | null {
  if (!/^[0-9a-f]{32}$/.test(value)) {
    return "expected 32-character lowercase hex string";
  }
  return null;
}

function isPositiveInteger(value: string): string | null {
  if (!/^[1-9][0-9]*$/.test(value)) {
    return "expected positive integer";
  }
  return null;
}

function isEvmAddress(value: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return "expected 0x-prefixed EVM address";
  }
  return null;
}

function isEvmPrivateKey(value: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return "expected 0x-prefixed 32-byte EVM private key";
  }
  return null;
}

function isRewardCampaignChainId(value: string): string | null {
  return value === "8453" || value === "84532"
    ? null
    : "expected Base mainnet (8453) or Base Sepolia (84532) chain id";
}

function isOperatorCredential(value: string): string | null {
  if (!/^opc_[0-9a-f]{32}\.[A-Za-z0-9_-]{32,}$/.test(value)) {
    return "expected opc_<32 lowercase hex>.<base64url secret>";
  }
  return null;
}

export const ENV_CONTRACT: EnvContract = {
  folders: [
    { path: "/services", requiredness: "required_now" },
    { path: "/services/api", requiredness: "required_now" },
    { path: "/services/bot-runner", requiredness: "deferred" },
    { path: "/services/control-plane", requiredness: "required_now" },
    { path: "/local", requiredness: "required_for_local_dev" },
    { path: "/local/control-plane", requiredness: "required_for_local_dev" },
  ],

  secrets: [
    {
      path: "/services/api",
      key: "CONTROL_PLANE_DATABASE_URL",
      requiredness: "required_now",
      validate: isPostgresUrl,
    },
    {
      path: "/services/api",
      key: "ALTCHA_HMAC_SECRET",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "ALTCHA_HMAC_KEY_SECRET",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "CREDENTIAL_WRAP_KEY",
      requiredness: "required_now",
      validate: is64CharHex,
    },
    {
      path: "/services/api",
      key: "AUTH_UPSTREAM_JWT_SHARED_SECRET",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "PIRATE_APP_JWT_PRIVATE_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "PIRATE_APP_JWT_PUBLIC_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "PRIVY_APP_SECRET",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "PRIVY_JWT_VERIFICATION_KEY",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "SPACES_VERIFIER_AUTH_TOKEN",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "HNS_VERIFIER_AUTH_TOKEN",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "FILEBASE_S3_ACCESS_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "FILEBASE_S3_SECRET_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "SWARM_BEE_API_URL",
      requiredness: "deferred",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "SWARM_POSTAGE_BATCH_ID",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "SWARM_FEED_PRIVATE_KEY",
      requiredness: "deferred",
      validate: isEvmPrivateKey,
    },
    {
      path: "/services/api",
      key: "SWARM_FEED_TOPIC_NAMESPACE",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "ACRCLOUD_ACCESS_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "ACRCLOUD_ACCESS_SECRET",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "ACRCLOUD_PERSONAL_ACCESS_TOKEN",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "SONG_PREVIEW_SHARED_SECRET",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "ELEVENLABS_API_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "AGORA_APP_CERTIFICATE",
      requiredness: "required_for_staging",
      validate: is32CharHex,
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_BASE_URL",
      requiredness: "deferred",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_CUSTOMER_KEY",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_CUSTOMER_SECRET",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_STORAGE_VENDOR",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_STORAGE_REGION",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_STORAGE_BUCKET",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_STORAGE_ACCESS_KEY",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_STORAGE_SECRET_KEY",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_STORAGE_FILE_PREFIX",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_RESOURCE_EXPIRED_HOURS",
      requiredness: "deferred",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_CAPTURE_S3_ENDPOINT",
      requiredness: "required_for_staging",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "AGORA_CLOUD_RECORDING_CAPTURE_S3_REGION",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "PIRATE_ADMIN_TOKEN",
      requiredness: "required_for_production",
    },
    {
      path: "/services/api",
      key: "ANALYTICS_ENABLED",
      requiredness: "required_for_production",
    },
    {
      path: "/services/api",
      key: "ANALYTICS_HMAC_SECRET",
      requiredness: "required_for_production",
    },
    {
      path: "/services/api",
      key: "TINYBIRD_INGEST_TOKEN",
      requiredness: "required_for_production",
    },
    {
      path: "/services/api",
      key: "TINYBIRD_READ_TOKEN",
      requiredness: "required_for_production",
    },
    {
      path: "/services/api",
      key: "TINYBIRD_TOKEN",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "TINYBIRD_URL",
      requiredness: "deferred",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "TINYBIRD_HOST",
      requiredness: "deferred",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "TINYBIRD_EVENTS_DATASOURCE",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "OPENROUTER_API_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "SONG_STUDY_GENERATION_TARGET_LANGUAGE_LIMIT",
      requiredness: "deferred",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "OPENAI_API_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "PASSPORT_API_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "JINA_API_KEY",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "FIRECRAWL_API_KEY",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "STORY_OPERATOR_PRIVATE_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "STORY_OPERATOR_PKP_ADDRESS",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_ENTITLEMENT_CLASS_CONFIGURER_PRIVATE_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "STORY_ENTITLEMENT_CLASS_CONFIGURER_ADDRESS",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_CDR_WRITER_PKP_ADDRESS",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_ACCESS_CONTROLLER_PKP_ADDRESS",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "MUSIC_PURCHASE_STORY_SETTLEMENT_PKP_ADDRESS",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_COORDINATOR_SIGNER_PRIVATE_KEY",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "STORY_COORDINATOR_SIGNER_ADDRESS",
      requiredness: "deferred",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_ROYALTY_SPG_NFT_CONTRACT",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_ROYALTY_COMMERCIAL_REV_SHARE_PCT",
      requiredness: "required_for_hosted",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "STORY_ROYALTY_DEFAULT_MINTING_FEE_WEI",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "STORY_ROYALTY_MAX_LICENSE_TOKENS",
      requiredness: "deferred",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "STORY_ROYALTY_POLICY_LAP_ADDRESS",
      requiredness: "deferred",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_CDR_WRITER_PRIVATE_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "STORY_COMPOSITE_READ_CONDITION_ADDRESS",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "STORY_ACCESS_CONTROLLER_PRIVATE_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "PIRATE_CHECKOUT_OPERATOR_PRIVATE_KEY",
      requiredness: "required_for_hosted",
    },
    {
      path: "/services/api",
      key: "PIRATE_CHECKOUT_OPERATOR_ADDRESS",
      requiredness: "deferred",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "PIRATE_CHECKOUT_RPC_URL",
      requiredness: "required_for_hosted",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "PIRATE_CHECKOUT_SOURCE_CHAIN_ID",
      requiredness: "required_for_hosted",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "PIRATE_CHECKOUT_USDC_TOKEN_ADDRESS",
      requiredness: "required_for_hosted",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "PIRATE_CHECKOUT_TX_WAIT_TIMEOUT_MS",
      requiredness: "deferred",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "PIRATE_CHECKOUT_SMOKE_BUYER_PRIVATE_KEY",
      requiredness: "required_for_staging",
      validate: isEvmPrivateKey,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_CHAIN_ID",
      requiredness: "required_for_staging",
      validate: isRewardCampaignChainId,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_USDC_TOKEN_ADDRESS",
      requiredness: "required_for_staging",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_TREASURY_ADDRESS",
      requiredness: "required_for_staging",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_RPC_URL",
      requiredness: "required_for_staging",
      validate: isHttpsUrl,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_ALERT_OWNER",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_ALERT_DESTINATION",
      requiredness: "required_for_staging",
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_QUOTE_TTL_SECONDS",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_MIN_BUDGET_CENTS",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_MAX_BUDGET_CENTS",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_MAX_REWARD_CENTS",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_MIN_DURATION_SECONDS",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "REWARDS_CAMPAIGN_MAX_DURATION_SECONDS",
      requiredness: "required_for_staging",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "PIRATE_REWARD_CAMPAIGN_OPERATOR_CREDENTIAL",
      requiredness: "required_for_staging",
      validate: isOperatorCredential,
    },
    {
      path: "/services/api",
      key: "BASE_MAINNET_RPC_URL",
      requiredness: "deferred",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "BASE_SEPOLIA_RPC_URL",
      requiredness: "deferred",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "ENDAOMENT_REGISTRY_ADDRESS",
      requiredness: "deferred",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "ENDAOMENT_PAYOUT_PRIVATE_KEY",
      requiredness: "deferred",
    },
    {
      path: "/services/api",
      key: "ENDAOMENT_RPC_URL",
      requiredness: "deferred",
      validate: isHttpUrl,
    },
    {
      path: "/services/api",
      key: "ENDAOMENT_CHAIN_ID",
      requiredness: "deferred",
      validate: isPositiveInteger,
    },
    {
      path: "/services/api",
      key: "ENDAOMENT_USDC_TOKEN_ADDRESS",
      requiredness: "deferred",
      validate: isEvmAddress,
    },
    {
      path: "/services/api",
      key: "ENDAOMENT_TX_WAIT_TIMEOUT_MS",
      requiredness: "deferred",
      validate: isPositiveInteger,
    },
    {
      path: "/services/bot-runner",
      key: "BOT_WALLET_MASTER_SECRET",
      requiredness: "deferred",
      validate: is64CharHex,
    },
    {
      path: "/services/bot-runner",
      key: "BOT_XMTP_DB_ENCRYPTION_SECRET",
      requiredness: "deferred",
      validate: is64CharHex,
    },
    {
      path: "/services/bot-runner",
      key: "PIRATE_ADMIN_TOKEN",
      requiredness: "deferred",
    },
    {
      path: "/services/bot-runner",
      key: "OPENROUTER_API_KEY",
      requiredness: "deferred",
    },
    {
      path: "/services/control-plane",
      key: "CONTROL_PLANE_MIGRATOR_DATABASE_URL",
      requiredness: "required_now",
      validate: isPostgresUrl,
    },
    {
      path: "/local/control-plane",
      key: "CONTROL_PLANE_OWNER_DATABASE_URL",
      requiredness: "required_for_local_dev",
      validate: isPostgresUrl,
    },
  ],

  crossPathChecks: [
    {
      description: "Reward campaign guardrails must be internally consistent",
      check: (secrets) => {
        const value = (key: string): number | null => {
          const secret = secrets.get(`${key}__/services/api`);
          if (!secret || secret.value === null || !/^[1-9][0-9]*$/.test(secret.value)) return null;
          return Number(secret.value);
        };
        const quoteTtl = value("REWARDS_CAMPAIGN_QUOTE_TTL_SECONDS");
        const minBudget = value("REWARDS_CAMPAIGN_MIN_BUDGET_CENTS");
        const maxBudget = value("REWARDS_CAMPAIGN_MAX_BUDGET_CENTS");
        const minDuration = value("REWARDS_CAMPAIGN_MIN_DURATION_SECONDS");
        const maxDuration = value("REWARDS_CAMPAIGN_MAX_DURATION_SECONDS");
        if ([quoteTtl, minBudget, maxBudget, minDuration, maxDuration].some((item) => item === null)) {
          return { status: "skip", message: "one or more reward campaign guardrails missing or invalid" };
        }
        if (quoteTtl! > 86_400) return { status: "fail", message: "quote TTL exceeds 86400 seconds" };
        if (minBudget! > maxBudget!) return { status: "fail", message: "minimum budget exceeds maximum" };
        if (minDuration! > maxDuration!) return { status: "fail", message: "minimum duration exceeds maximum" };
        return { status: "ok" };
      },
    },
    {
      description: "Runtime and migrator URLs must point at the same database host",
      check: (secrets) => {
        const runtime = secrets.get("CONTROL_PLANE_DATABASE_URL__/services/api");
        const migrator = secrets.get("CONTROL_PLANE_MIGRATOR_DATABASE_URL__/services/control-plane");
        if (!runtime || !migrator || runtime.value === null || migrator.value === null) {
          return { status: "skip", message: "one or both values missing" };
        }
        try {
          const runtimeHost = new URL(runtime.value).hostname;
          const migratorHost = new URL(migrator.value).hostname;
          if (runtimeHost !== migratorHost) {
            return { status: "fail", message: `runtime=${runtimeHost}, migrator=${migratorHost}` };
          }
        } catch {
          return { status: "fail", message: "could not parse database URLs" };
        }
        return { status: "ok" };
      },
    },
    {
      description: "Runtime and migrator URLs must use different roles",
      check: (secrets) => {
        const runtime = secrets.get("CONTROL_PLANE_DATABASE_URL__/services/api");
        const migrator = secrets.get("CONTROL_PLANE_MIGRATOR_DATABASE_URL__/services/control-plane");
        if (!runtime || !migrator || runtime.value === null || migrator.value === null) {
          return { status: "skip", message: "one or both values missing" };
        }
        try {
          const runtimeUser = new URL(runtime.value).username;
          const migratorUser = new URL(migrator.value).username;
          if (runtimeUser === migratorUser) {
            return { status: "fail", message: `both use ${runtimeUser}` };
          }
        } catch {
          return { status: "fail", message: "could not parse database URLs" };
        }
        return { status: "ok" };
      },
    },
    {
      description: "Owner URL must point at the same database host as runtime",
      check: (secrets) => {
        const runtime = secrets.get("CONTROL_PLANE_DATABASE_URL__/services/api");
        const owner = secrets.get("CONTROL_PLANE_OWNER_DATABASE_URL__/local/control-plane");
        if (!runtime || !owner || runtime.value === null || owner.value === null) {
          return { status: "skip", message: "one or both values missing" };
        }
        try {
          const runtimeHost = new URL(runtime.value).hostname;
          const ownerHost = new URL(owner.value).hostname;
          if (runtimeHost !== ownerHost) {
            return { status: "fail", message: `runtime=${runtimeHost}, owner=${ownerHost}` };
          }
        } catch {
          return { status: "fail", message: "could not parse database URLs" };
        }
        return { status: "ok" };
      },
    },
    {
      description: "Owner URL must use a different role than runtime and migrator",
      check: (secrets) => {
        const runtime = secrets.get("CONTROL_PLANE_DATABASE_URL__/services/api");
        const migrator = secrets.get("CONTROL_PLANE_MIGRATOR_DATABASE_URL__/services/control-plane");
        const owner = secrets.get("CONTROL_PLANE_OWNER_DATABASE_URL__/local/control-plane");
        if (!owner || owner.value === null) {
          return { status: "skip", message: "owner value missing" };
        }
        try {
          const ownerUser = new URL(owner.value).username;
          if (runtime && runtime.value !== null) {
            const runtimeUser = new URL(runtime.value).username;
            if (ownerUser === runtimeUser) {
              return { status: "fail", message: `owner and runtime both use ${ownerUser}` };
            }
          }
          if (migrator && migrator.value !== null) {
            const migratorUser = new URL(migrator.value).username;
            if (ownerUser === migratorUser) {
              return { status: "fail", message: `owner and migrator both use ${ownerUser}` };
            }
          }
        } catch {
          return { status: "fail", message: "could not parse database URLs" };
        }
        return { status: "ok" };
      },
    },
  ],
};

export function isSecretProfile(value: string | undefined): value is SecretProfile {
  return value === "all"
    || value === "core"
    || value === "happy-path"
    || value === "commerce";
}

export function secretId(path: string, key: string): string {
  return `${key}__${path}`;
}

export const CORE_SECRET_IDS = [
  "CONTROL_PLANE_DATABASE_URL__/services/api",
  "CREDENTIAL_WRAP_KEY__/services/api",
  "AUTH_UPSTREAM_JWT_SHARED_SECRET__/services/api",
  "PIRATE_APP_JWT_PRIVATE_KEY__/services/api",
  "PIRATE_APP_JWT_PUBLIC_KEY__/services/api",
  "PRIVY_APP_SECRET__/services/api",
  "OPENAI_API_KEY__/services/api",
  "PASSPORT_API_KEY__/services/api",
  "PIRATE_ADMIN_TOKEN__/services/api",
  "CONTROL_PLANE_MIGRATOR_DATABASE_URL__/services/control-plane",
  "ALTCHA_HMAC_SECRET__/services/api",
  "ALTCHA_HMAC_KEY_SECRET__/services/api",
] as const;

export const HAPPY_PATH_SECRET_IDS = [
  "SPACES_VERIFIER_AUTH_TOKEN__/services/api",
  "HNS_VERIFIER_AUTH_TOKEN__/services/api",
] as const;

export const COMMERCE_SECRET_IDS = [
  "FILEBASE_S3_ACCESS_KEY__/services/api",
  "FILEBASE_S3_SECRET_KEY__/services/api",
  "ACRCLOUD_ACCESS_KEY__/services/api",
  "ACRCLOUD_ACCESS_SECRET__/services/api",
  "ACRCLOUD_PERSONAL_ACCESS_TOKEN__/services/api",
  "SONG_PREVIEW_SHARED_SECRET__/services/api",
  "ELEVENLABS_API_KEY__/services/api",
  "AGORA_APP_CERTIFICATE__/services/api",
  "AGORA_CLOUD_RECORDING_CUSTOMER_KEY__/services/api",
  "AGORA_CLOUD_RECORDING_CUSTOMER_SECRET__/services/api",
  "AGORA_CLOUD_RECORDING_STORAGE_VENDOR__/services/api",
  "AGORA_CLOUD_RECORDING_STORAGE_REGION__/services/api",
  "AGORA_CLOUD_RECORDING_STORAGE_BUCKET__/services/api",
  "AGORA_CLOUD_RECORDING_STORAGE_ACCESS_KEY__/services/api",
  "AGORA_CLOUD_RECORDING_STORAGE_SECRET_KEY__/services/api",
  "AGORA_CLOUD_RECORDING_CAPTURE_S3_ENDPOINT__/services/api",
  "AGORA_CLOUD_RECORDING_CAPTURE_S3_REGION__/services/api",
  "OPENROUTER_API_KEY__/services/api",
  "STORY_OPERATOR_PRIVATE_KEY__/services/api",
  "STORY_OPERATOR_PKP_ADDRESS__/services/api",
  "STORY_ENTITLEMENT_CLASS_CONFIGURER_PRIVATE_KEY__/services/api",
  "STORY_ENTITLEMENT_CLASS_CONFIGURER_ADDRESS__/services/api",
  "STORY_ROYALTY_SPG_NFT_CONTRACT__/services/api",
  "STORY_ROYALTY_COMMERCIAL_REV_SHARE_PCT__/services/api",
  "STORY_CDR_WRITER_PRIVATE_KEY__/services/api",
  "STORY_CDR_WRITER_PKP_ADDRESS__/services/api",
  "STORY_COMPOSITE_READ_CONDITION_ADDRESS__/services/api",
  "STORY_ACCESS_CONTROLLER_PRIVATE_KEY__/services/api",
  "STORY_ACCESS_CONTROLLER_PKP_ADDRESS__/services/api",
  "MUSIC_PURCHASE_STORY_SETTLEMENT_PRIVATE_KEY__/services/api",
  "MUSIC_PURCHASE_STORY_SETTLEMENT_PKP_ADDRESS__/services/api",
  "STORY_COORDINATOR_SIGNER_PRIVATE_KEY__/services/api",
  "STORY_COORDINATOR_SIGNER_ADDRESS__/services/api",
  "PIRATE_CHECKOUT_OPERATOR_PRIVATE_KEY__/services/api",
  "PIRATE_CHECKOUT_RPC_URL__/services/api",
  "PIRATE_CHECKOUT_SOURCE_CHAIN_ID__/services/api",
  "PIRATE_CHECKOUT_USDC_TOKEN_ADDRESS__/services/api",
  "PIRATE_CHECKOUT_SMOKE_BUYER_PRIVATE_KEY__/services/api",
  "REWARDS_CAMPAIGN_CHAIN_ID__/services/api",
  "REWARDS_CAMPAIGN_USDC_TOKEN_ADDRESS__/services/api",
  "REWARDS_CAMPAIGN_TREASURY_ADDRESS__/services/api",
  "REWARDS_CAMPAIGN_RPC_URL__/services/api",
  "REWARDS_CAMPAIGN_ALERT_OWNER__/services/api",
  "REWARDS_CAMPAIGN_ALERT_DESTINATION__/services/api",
  "REWARDS_CAMPAIGN_QUOTE_TTL_SECONDS__/services/api",
  "REWARDS_CAMPAIGN_MIN_BUDGET_CENTS__/services/api",
  "REWARDS_CAMPAIGN_MAX_BUDGET_CENTS__/services/api",
  "REWARDS_CAMPAIGN_MAX_REWARD_CENTS__/services/api",
  "REWARDS_CAMPAIGN_MIN_DURATION_SECONDS__/services/api",
  "REWARDS_CAMPAIGN_MAX_DURATION_SECONDS__/services/api",
  "PIRATE_REWARD_CAMPAIGN_OPERATOR_CREDENTIAL__/services/api",
] as const;

const NON_WRANGLER_API_SECRET_NAMES = new Set([
  "TINYBIRD_TOKEN",
  "TINYBIRD_URL",
  "PIRATE_CHECKOUT_SMOKE_BUYER_PRIVATE_KEY",
  "PIRATE_REWARD_CAMPAIGN_OPERATOR_CREDENTIAL",
]);

export function profileSecretIds(profile: SecretProfile): Set<string> | null {
  if (profile === "all") return null;

  const ids = new Set<string>(CORE_SECRET_IDS);
  if (profile === "happy-path" || profile === "commerce") {
    for (const id of HAPPY_PATH_SECRET_IDS) ids.add(id);
  }
  if (profile === "commerce") {
    for (const id of COMMERCE_SECRET_IDS) ids.add(id);
  }
  return ids;
}

export function wranglerApiRequiredSecretNames(profile: Exclude<SecretProfile, "all">): string[] {
  const selectedSecretIds = profileSecretIds(profile);
  if (!selectedSecretIds) return [];

  return ENV_CONTRACT.secrets
    .filter((spec) => spec.path === "/services/api" && selectedSecretIds.has(secretId(spec.path, spec.key)))
    .filter((spec) => !NON_WRANGLER_API_SECRET_NAMES.has(spec.key))
    .map((spec) => spec.key);
}

export function wranglerApiOptionalSecretNames(profile: Exclude<SecretProfile, "all">): string[] {
  const requiredNames = new Set(wranglerApiRequiredSecretNames(profile));

  return ENV_CONTRACT.secrets
    .filter((spec) => spec.path === "/services/api")
    .filter((spec) => spec.requiredness === "deferred")
    .map((spec) => spec.key)
    .filter((key) => !NON_WRANGLER_API_SECRET_NAMES.has(key))
    .filter((key) => !requiredNames.has(key));
}

export const WRANGLER_MANAGED_CONFIG_NAMES = [
  "AUTH_UPSTREAM_JWT_ENABLED",
  "AUTH_UPSTREAM_JWT_ISSUER",
  "AUTH_UPSTREAM_JWT_AUDIENCE",
  "PIRATE_APP_JWT_ISSUER",
  "PIRATE_APP_JWT_AUDIENCE",
  "PIRATE_APP_JWT_TTL_SECONDS",
  "PRIVY_APP_ID",
  "PRIVY_API_URL",
  "VERY_APP_ID",
  "VERY_API_URL",
  "VERY_VERIFY_URL",
  "AGORA_APP_ID",
  "FILEBASE_MEDIA_BUCKET",
  "FILEBASE_S3_ENDPOINT",
  "FILEBASE_S3_REGION",
  "OPENAI_MODERATION_BASE_URL",
  "OPENAI_MODERATION_MODEL",
  "OPENAI_MODERATION_SEXUAL_MINORS_BLOCK_THRESHOLD",
  "OPENAI_MODERATION_TIMEOUT_MS",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_LINK_SUMMARY_MODEL",
  "OPENROUTER_LINK_SUMMARY_TIMEOUT_MS",
  "OPENROUTER_MODEL",
  "PASSPORT_API_URL",
  "PASSPORT_SCORER_ID",
  "ACRCLOUD_HOST",
  "ACRCLOUD_IDENTIFY_PATH",
  "ACRCLOUD_BUCKET_ID",
  "ACRCLOUD_CONSOLE_BASE_URL",
  "ELEVENLABS_FORCE_ALIGNMENT_URL",
  "STORY_RPC_URL",
  "STORY_RPC_FALLBACK_URLS",
  "STORY_RUNTIME_SIGNER_MIN_BALANCE_WEI",
  "STORY_RUNTIME_SIGNER_TARGET_BALANCE_WEI",
  "IPFS_GATEWAY_URL",
  "REGISTRY_PUBLISHER_URL",
  "REGISTRY_PUBLISHER_TIMEOUT_MS",
  "DEV_MEMORY_STORE_ENABLED",
  "ENVIRONMENT",
  "COMMUNITY_PROVISION_EXPECTED_ORGANIZATION_SLUG",
] as const;

export function requirednessApplies(requiredness: Requiredness, env: string): boolean {
  const isProduction = env === "production" || env === "prod";

  switch (requiredness) {
    case "required_now":
      return true;
    case "required_for_local_dev":
      return env === "dev";
    case "required_for_hosted":
      return env === "staging" || isProduction;
    case "required_for_staging":
      return env === "staging";
    case "required_for_production":
      return isProduction;
    case "deferred":
      return false;
  }
}

export function requirednessLabel(requiredness: Requiredness): string {
  switch (requiredness) {
    case "required_now":
      return "required";
    case "required_for_local_dev":
      return "required (local dev)";
    case "required_for_hosted":
      return "required (hosted)";
    case "required_for_staging":
      return "required (staging)";
    case "required_for_production":
      return "required (production)";
    case "deferred":
      return "deferred";
  }
}
