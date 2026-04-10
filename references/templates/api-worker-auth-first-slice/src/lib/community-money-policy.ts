import type { CommunityMoneyPolicy, UpdateCommunityMoneyPolicyRequest } from "../types/api";
import type { CommunityMoneyPolicyRow, CommunityRow } from "../types/db";
import { eligibilityFailed, notFoundError } from "./errors";

type MoneyAssetRef = CommunityMoneyPolicy["accepted_funding_assets"][number];
type MoneyChainRef = CommunityMoneyPolicy["accepted_source_chains"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw eligibilityFailed(`${fieldName} is required`);
  }
}

function assertNullableString(value: unknown, fieldName: string): asserts value is string | null | undefined {
  if (value != null && typeof value !== "string") {
    throw eligibilityFailed(`${fieldName} must be a string or null`);
  }
}

function assertMoneyAssetRef(value: unknown, fieldName: string): asserts value is MoneyAssetRef {
  if (!isRecord(value)) {
    throw eligibilityFailed(`${fieldName} must be an object`);
  }

  assertNonEmptyString(value.asset_symbol, `${fieldName}.asset_symbol`);
  assertNullableString(value.chain_namespace, `${fieldName}.chain_namespace`);
  if (value.chain_id != null && (!Number.isInteger(value.chain_id) || (value.chain_id as number) < 0)) {
    throw eligibilityFailed(`${fieldName}.chain_id must be a non-negative integer or null`);
  }
  assertNullableString(value.display_name, `${fieldName}.display_name`);
}

function assertMoneyChainRef(value: unknown, fieldName: string): asserts value is MoneyChainRef {
  if (!isRecord(value)) {
    throw eligibilityFailed(`${fieldName} must be an object`);
  }

  assertNonEmptyString(value.chain_namespace, `${fieldName}.chain_namespace`);
  if (value.chain_id != null && (!Number.isInteger(value.chain_id) || (value.chain_id as number) < 0)) {
    throw eligibilityFailed(`${fieldName}.chain_id must be a non-negative integer or null`);
  }
  assertNullableString(value.display_name, `${fieldName}.display_name`);
}

function parseJsonArray<T>(value: string, fieldName: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw eligibilityFailed(`${fieldName} stored value is invalid`);
  }

  if (!Array.isArray(parsed)) {
    throw eligibilityFailed(`${fieldName} stored value must be an array`);
  }

  return parsed as T[];
}

function parseJsonObject<T>(value: string, fieldName: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw eligibilityFailed(`${fieldName} stored value is invalid`);
  }

  if (!isRecord(parsed)) {
    throw eligibilityFailed(`${fieldName} stored value must be an object`);
  }

  return parsed as T;
}

export function resolveDefaultCommunityMoneyPolicy(community: CommunityRow): CommunityMoneyPolicy {
  return {
    community_id: community.community_id,
    policy_origin: "default",
    funding_preference: "USD",
    accepted_funding_assets: [],
    accepted_source_chains: [],
    approved_route_providers: null,
    destination_settlement_chain: {
      chain_namespace: "eip155",
      chain_id: null,
      display_name: "Story",
    },
    destination_settlement_token: "WIP",
    treasury_denomination: "WIP",
    max_slippage_bps: 0,
    quote_ttl_seconds: 300,
    route_required: false,
    route_status_policy: "fail",
    route_hop_tolerance: 0,
    updated_at: community.updated_at,
  };
}

export function serializeCommunityMoneyPolicy(
  community: CommunityRow,
  row: CommunityMoneyPolicyRow | null,
): CommunityMoneyPolicy {
  if (!row) {
    return resolveDefaultCommunityMoneyPolicy(community);
  }

  return {
    community_id: community.community_id,
    policy_origin: "explicit",
    funding_preference: row.funding_preference,
    accepted_funding_assets: parseJsonArray<MoneyAssetRef>(
      row.accepted_funding_assets_json,
      "accepted_funding_assets",
    ),
    accepted_source_chains: parseJsonArray<MoneyChainRef>(
      row.accepted_source_chains_json,
      "accepted_source_chains",
    ),
    approved_route_providers:
      row.approved_route_providers_json == null
        ? null
        : parseJsonArray<string>(row.approved_route_providers_json, "approved_route_providers"),
    destination_settlement_chain: parseJsonObject<MoneyChainRef>(
      row.destination_settlement_chain_json,
      "destination_settlement_chain",
    ),
    destination_settlement_token: row.destination_settlement_token,
    treasury_denomination: row.treasury_denomination,
    max_slippage_bps: row.max_slippage_bps,
    quote_ttl_seconds: row.quote_ttl_seconds,
    route_required: row.route_required === 1,
    route_status_policy: row.route_status_policy,
    route_hop_tolerance: row.route_hop_tolerance,
    updated_at: row.updated_at,
  };
}

export function assertUpdateCommunityMoneyPolicyRequest(
  value: unknown,
): asserts value is UpdateCommunityMoneyPolicyRequest {
  if (!isRecord(value)) {
    throw eligibilityFailed("money_policy payload must be an object");
  }

  assertNonEmptyString(value.funding_preference, "funding_preference");
  if (!Array.isArray(value.accepted_funding_assets)) {
    throw eligibilityFailed("accepted_funding_assets must be an array");
  }
  if (!Array.isArray(value.accepted_source_chains)) {
    throw eligibilityFailed("accepted_source_chains must be an array");
  }

  value.accepted_funding_assets.forEach((asset, index) => {
    assertMoneyAssetRef(asset, `accepted_funding_assets[${index}]`);
  });
  value.accepted_source_chains.forEach((chain, index) => {
    assertMoneyChainRef(chain, `accepted_source_chains[${index}]`);
  });

  assertMoneyChainRef(value.destination_settlement_chain, "destination_settlement_chain");
  assertNonEmptyString(value.destination_settlement_token, "destination_settlement_token");
  assertNullableString(value.treasury_denomination, "treasury_denomination");

  if (!Number.isInteger(value.max_slippage_bps) || (value.max_slippage_bps as number) < 0) {
    throw eligibilityFailed("max_slippage_bps must be a non-negative integer");
  }
  if (!Number.isInteger(value.quote_ttl_seconds) || (value.quote_ttl_seconds as number) < 1) {
    throw eligibilityFailed("quote_ttl_seconds must be a positive integer");
  }
  if (typeof value.route_required !== "boolean") {
    throw eligibilityFailed("route_required must be a boolean");
  }
  if (
    value.route_status_policy !== "fail" &&
    value.route_status_policy !== "fallback_display" &&
    value.route_status_policy !== "queue"
  ) {
    throw eligibilityFailed("route_status_policy is invalid");
  }
  if (!Number.isInteger(value.route_hop_tolerance) || (value.route_hop_tolerance as number) < 0) {
    throw eligibilityFailed("route_hop_tolerance must be a non-negative integer");
  }

  if (value.approved_route_providers != null) {
    if (!Array.isArray(value.approved_route_providers)) {
      throw eligibilityFailed("approved_route_providers must be an array or null");
    }
    value.approved_route_providers.forEach((provider, index) => {
      assertNonEmptyString(provider, `approved_route_providers[${index}]`);
    });
  }

  if (value.route_required) {
    if (value.accepted_funding_assets.length === 0) {
      throw eligibilityFailed("route_required communities must define at least one accepted funding asset");
    }
    if (value.accepted_source_chains.length === 0) {
      throw eligibilityFailed("route_required communities must define at least one accepted source chain");
    }
    if ((value.approved_route_providers?.length ?? 0) === 0) {
      throw eligibilityFailed("route_required communities must define at least one approved route provider");
    }
  }
}

export function assertCommunityCreator(community: CommunityRow, userId: string) {
  if (community.creator_user_id !== userId) {
    throw eligibilityFailed("Only the community creator can update the money policy in this stub");
  }
}

export function requireCommunity(row: CommunityRow | null): CommunityRow {
  if (!row) {
    throw notFoundError("Community not found");
  }

  return row;
}
