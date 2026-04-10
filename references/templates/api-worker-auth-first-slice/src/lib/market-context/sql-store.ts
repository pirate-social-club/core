import type {
  ClaimMarketBinding,
  MarketContextEligiblePost,
  MarketContextStore,
  ReplacePostMarketContextMarketsInput,
  ResolvedMarketContextPolicy,
  UpsertClaimMarketBindingInput,
  UpsertPostMarketContextInput,
} from "./types";

export type SqlParams = Record<string, string | number | null>;

export interface SqlExecutor {
  get<T>(sql: string, params?: SqlParams): Promise<T | null>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  run(sql: string, params?: SqlParams): Promise<void>;
}

type CommunityPolicyRow = {
  mode: "off" | "on";
  enabled_post_types_json: string;
  max_markets_per_post: number;
  provider_set: "platform_default" | "approved_profile";
  market_context_profile_id: string | null;
};

type CommunityPostRow = {
  post_id: string;
  community_id: string;
  post_type: "text" | "image" | "video" | "link" | "song";
  status: "draft" | "published" | "hidden" | "removed" | "deleted";
  parent_post_id: string | null;
  title: string | null;
  link_url: string | null;
};

function parseEnabledPostTypes(value: string): Array<"link" | "image" | "video"> {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return ["link"];
  }

  return parsed.filter(
    (item): item is "link" | "image" | "video" =>
      item === "link" || item === "image" || item === "video",
  );
}

export class SqlMarketContextStore implements MarketContextStore {
  constructor(
    private readonly communityDb: SqlExecutor,
    private readonly controlPlaneDb: SqlExecutor,
    private readonly defaultProviderKeys: string[] = ["kalshi", "polymarket"],
  ) {}

  async getEligiblePost(postId: string): Promise<MarketContextEligiblePost | null> {
    const row = await this.communityDb.get<CommunityPostRow>(
      `SELECT post_id, community_id, post_type, status, parent_post_id, title, link_url
       FROM posts
       WHERE post_id = :post_id`,
      { post_id: postId },
    );

    if (!row) {
      return null;
    }

    return row;
  }

  async getPostMarketContextId(postId: string): Promise<string | null> {
    const row = await this.communityDb.get<{ post_market_context_id: string }>(
      `SELECT post_market_context_id
       FROM post_market_contexts
       WHERE post_id = :post_id`,
      { post_id: postId },
    );

    return row?.post_market_context_id ?? null;
  }

  async getResolvedPolicy(communityId: string): Promise<ResolvedMarketContextPolicy> {
    const row = await this.communityDb.get<CommunityPolicyRow>(
      `SELECT mode, enabled_post_types_json, max_markets_per_post, provider_set, market_context_profile_id
       FROM community_market_context_policies
       WHERE community_id = :community_id`,
      { community_id: communityId },
    );

    if (!row) {
      return {
        mode: "on",
        enabled_post_types: ["link"],
        max_markets_per_post: 2,
        provider_set: "platform_default",
        market_context_profile_id: null,
        provider_keys: this.defaultProviderKeys,
      };
    }

    return {
      mode: row.mode,
      enabled_post_types: parseEnabledPostTypes(row.enabled_post_types_json),
      max_markets_per_post: row.max_markets_per_post,
      provider_set: row.provider_set,
      market_context_profile_id: row.market_context_profile_id,
      provider_keys: this.defaultProviderKeys,
    };
  }

  async getFreshClaimMarketBindings(input: {
    normalized_claim_hash: string;
    min_snapshot_at: string;
  }): Promise<ClaimMarketBinding[]> {
    return this.controlPlaneDb.all<ClaimMarketBinding>(
      `SELECT
         normalized_claim_hash,
         normalized_claim_text,
         provider_key,
         provider_market_id,
         provider_event_id,
         question,
         market_url,
         resolve_date,
         snapshot_payload_json,
         snapshot_at,
         status
       FROM claim_market_bindings
       WHERE normalized_claim_hash = :normalized_claim_hash
         AND status = 'active'
         AND (snapshot_at IS NULL OR snapshot_at >= :min_snapshot_at)`,
      input,
    );
  }

  async upsertPostMarketContext(input: UpsertPostMarketContextInput): Promise<void> {
    await this.communityDb.run(
      `INSERT INTO post_market_contexts (
         post_market_context_id,
         post_id,
         community_id,
         status,
         claim_summary,
         matching_evidence_json,
         snapshot_at,
         created_at,
         updated_at
       ) VALUES (
         :post_market_context_id,
         :post_id,
         :community_id,
         :status,
         :claim_summary,
         :matching_evidence_json,
         :snapshot_at,
         :created_at,
         :updated_at
       )
       ON CONFLICT(post_id) DO UPDATE SET
         status = excluded.status,
         claim_summary = excluded.claim_summary,
         matching_evidence_json = excluded.matching_evidence_json,
         snapshot_at = excluded.snapshot_at,
         updated_at = excluded.updated_at`,
      input,
    );
  }

  async replacePostMarketContextMarkets(input: ReplacePostMarketContextMarketsInput): Promise<void> {
    await this.communityDb.run(
      `DELETE FROM post_market_context_markets
       WHERE post_market_context_id = :post_market_context_id`,
      { post_market_context_id: input.post_market_context_id },
    );

    for (const market of input.markets) {
      await this.communityDb.run(
        `INSERT INTO post_market_context_markets (
           market_context_market_id,
           post_market_context_id,
           provider_key,
           provider_market_id,
           provider_event_id,
           question,
           outcome_yes_price,
           liquidity_score,
           resolve_date,
           market_url,
           match_confidence,
           snapshot_at,
           status,
           created_at,
           updated_at
         ) VALUES (
           :market_context_market_id,
           :post_market_context_id,
           :provider_key,
           :provider_market_id,
           :provider_event_id,
           :question,
           :outcome_yes_price,
           :liquidity_score,
           :resolve_date,
           :market_url,
           :match_confidence,
           :snapshot_at,
           :status,
           :created_at,
           :updated_at
         )`,
        market,
      );
    }
  }

  async upsertClaimMarketBindings(inputs: UpsertClaimMarketBindingInput[]): Promise<void> {
    for (const input of inputs) {
      await this.controlPlaneDb.run(
        `INSERT INTO claim_market_bindings (
           claim_market_binding_id,
           normalized_claim_hash,
           normalized_claim_text,
           provider_key,
           provider_market_id,
           provider_event_id,
           question,
           market_url,
           resolve_date,
           snapshot_payload_json,
           snapshot_at,
           status,
           created_at,
           updated_at
         ) VALUES (
           :claim_market_binding_id,
           :normalized_claim_hash,
           :normalized_claim_text,
           :provider_key,
           :provider_market_id,
           :provider_event_id,
           :question,
           :market_url,
           :resolve_date,
           :snapshot_payload_json,
           :snapshot_at,
           :status,
           :created_at,
           :updated_at
         )
         ON CONFLICT(normalized_claim_hash, provider_key, provider_market_id) DO UPDATE SET
           normalized_claim_text = excluded.normalized_claim_text,
           provider_event_id = excluded.provider_event_id,
           question = excluded.question,
           market_url = excluded.market_url,
           resolve_date = excluded.resolve_date,
           snapshot_payload_json = excluded.snapshot_payload_json,
           snapshot_at = excluded.snapshot_at,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        input,
      );
    }
  }
}
