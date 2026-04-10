import type { Env } from "../types/env";

export type CreateCommunityAttemptInput = {
  actor_user_id: string;
  actor_primary_wallet_snapshot: string | null;
  actor_governance_address_snapshot: string | null;
  namespace_verification_id: string;
  normalized_root_label: string;
  created_at: string;
};

export type CreateCommunityAttemptResult = {
  registry_attempt_id: string;
  attempts_table: string;
  result_ref: string;
};

export type PublishCommunityCreateInput = {
  registry_attempt_id: string;
  community_id: string;
  created_at: string;
  existing_table_refs?: {
    club_registry_table?: string | null;
    club_namespace_table?: string | null;
  };
  canonical_seed: {
    registry: {
      display_name: string;
      description: string | null;
      avatar_ref: string | null;
      cover_ref: string | null;
      status: string;
      governance_mode: string;
      governance_chain_id: number | null;
      governance_contract_address: string | null;
      governance_treasury_address: string | null;
      observed_owner_set_json: string | null;
      observed_owner_set_observed_at: string | null;
      governance_verification_state: string | null;
      governance_last_verified_at: string | null;
      donation_policy_mode: string | null;
      donation_partner_status: string | null;
      handle_policy_template: string | null;
      handle_pricing_model: string | null;
      handle_claims_enabled: number;
      handle_premium_enabled: number;
      handle_auction_enabled: number;
      updated_at: string;
    };
    namespace_summary: {
      namespace_id: string;
      display_label: string;
      normalized_label: string;
      route_family: string;
      namespace_role: string;
      status: string;
      root_proof_status: string;
      delegation_status: string;
      last_verified_at: string | null;
      updated_at: string;
    };
  };
};

export type PublishCommunityCreateResult = {
  status: "published";
  registry_published_at: string;
  attempts_table: string;
  club_registry_table: string;
  club_namespace_table: string;
  result_ref: string;
};

export class RegistryPublisherError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly retryable: boolean,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

function parseTimeout(rawValue: string | undefined, fallbackMs: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return parsed;
}

async function postJson(input: {
  env: Env;
  path: string;
  body: unknown;
  timeoutMs: number;
}): Promise<unknown> {
  const baseUrl = input.env.REGISTRY_PUBLISHER_BASE_URL;
  if (!baseUrl) {
    throw new RegistryPublisherError(
      "Registry publisher is not configured",
      "publisher_unconfigured",
      false,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), input.timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${input.path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.env.REGISTRY_PUBLISHER_AUTH_TOKEN
          ? { authorization: `Bearer ${input.env.REGISTRY_PUBLISHER_AUTH_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });

    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new RegistryPublisherError(
        String(payload.message || payload.error || "Registry publisher request failed"),
        String(payload.error_code || "publisher_http_error"),
        response.status >= 500,
        payload,
      );
    }

    if (payload.ok === false) {
      throw new RegistryPublisherError(
        String(payload.error_code || "Registry publisher returned an error"),
        String(payload.error_code || "publisher_error"),
        true,
        payload,
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof RegistryPublisherError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new RegistryPublisherError(
        "Registry publisher request timed out",
        "publisher_timeout_indeterminate",
        true,
      );
    }

    throw new RegistryPublisherError(
      error instanceof Error ? error.message : "Registry publisher request failed",
      "publisher_request_failed",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export class RegistryPublisherClient {
  constructor(private readonly env: Env) {}

  async createCommunityAttempt(
    input: CreateCommunityAttemptInput,
  ): Promise<CreateCommunityAttemptResult> {
    const payload = (await postJson({
      env: this.env,
      path: "/internal/v0/create-community-attempt",
      body: input,
      timeoutMs: parseTimeout(this.env.REGISTRY_PUBLISHER_ATTEMPT_TIMEOUT_MS, 8000),
    })) as Record<string, unknown>;

    return {
      registry_attempt_id: String(payload.registry_attempt_id),
      attempts_table: String(payload.attempts_table || ""),
      result_ref: String(payload.result_ref || ""),
    };
  }

  async publishCommunityCreate(
    input: PublishCommunityCreateInput,
  ): Promise<PublishCommunityCreateResult> {
    const payload = (await postJson({
      env: this.env,
      path: "/internal/v0/publish-community-create",
      body: input,
      timeoutMs: parseTimeout(this.env.REGISTRY_PUBLISHER_PUBLISH_TIMEOUT_MS, 90000),
    })) as Record<string, unknown>;

    const tableRefs = (payload.table_refs ?? {}) as Record<string, unknown>;
    return {
      status: "published",
      registry_published_at: String(payload.registry_published_at),
      attempts_table: String(tableRefs.attempts_table || ""),
      club_registry_table: String(tableRefs.club_registry_table || ""),
      club_namespace_table: String(tableRefs.club_namespace_table || ""),
      result_ref: String(payload.result_ref || ""),
    };
  }
}
