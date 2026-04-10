import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import {
  assertCommunityCreator,
  assertUpdateCommunityMoneyPolicyRequest,
  requireCommunity,
  serializeCommunityMoneyPolicy,
} from "../lib/community-money-policy";
import { listCommunityGateRules, upsertCommunityGateRule } from "../lib/community-gate-rules-service";
import { joinCommunity } from "../lib/community-join-service";
import {
  listPendingCommunityMembershipRequests,
  reviewCommunityMembershipRequest,
} from "../lib/community-membership-requests-service";
import { createCommunity, type CreateCommunityRequestBody } from "../lib/community-create-service";
import { badRequestError, notFoundError } from "../lib/errors";
import { verifyPirateAccessToken } from "../lib/pirate-session-jwt";
import { serializeCommunity } from "../lib/community-serializer";
import type { JsonResponse, RequestLike } from "./http";
import { ok, requireBearerToken, requireSharedSecretBearerToken, toErrorResponse } from "./http";

export async function postCommunities(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const body = (await input.request.json()) as CreateCommunityRequestBody;
    const response = await createCommunity({
      requestBody: body,
      bearerToken: token,
      env: input.env,
      store: input.store,
    });

    return {
      status: 202,
      body: response,
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getCommunityById(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    await verifyPirateAccessToken(token, input.env);
    const row = requireCommunity(await input.store.getCommunityById(input.communityId));

    return ok(serializeCommunity(row));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postCommunityJoin(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const community = requireCommunity(await input.store.getCommunityById(input.communityId));
    const user = await input.store.getUser(session.userId);
    if (!user) {
      throw notFoundError("Authenticated user not found");
    }

    const walletAttachments = await input.store.listActiveWalletAttachments(session.userId);
    return ok(
      await joinCommunity({
        community,
        user,
        env: input.env,
        store: input.store,
        walletAttachments,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getInternalCommunityGateRules(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    requireSharedSecretBearerToken(input.request, input.env.COMMUNITY_GATE_OPERATOR_AUTH_TOKEN);
    return ok(
      await listCommunityGateRules({
        communityId: input.communityId,
        store: input.store,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getCommunityMembershipRequests(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    return ok(
      await listPendingCommunityMembershipRequests({
        communityId: input.communityId,
        actorUserId: session.userId,
        store: input.store,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postCommunityMembershipRequestReview(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
  membershipRequestId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const body = (await input.request.json()) as {
      decision?: "approve" | "reject";
      review_reason?: string | null;
    };
    if (body.decision !== "approve" && body.decision !== "reject") {
      throw badRequestError("decision must be approve or reject");
    }

    return ok(
      await reviewCommunityMembershipRequest({
        communityId: input.communityId,
        membershipRequestId: input.membershipRequestId,
        actorUserId: session.userId,
        decision: body.decision,
        reviewReason: body.review_reason ?? null,
        store: input.store,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postInternalCommunityGateRules(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    requireSharedSecretBearerToken(input.request, input.env.COMMUNITY_GATE_OPERATOR_AUTH_TOKEN);
    const body = (await input.request.json()) as {
      gate_rule_id?: string;
      scope?: "membership" | "viewer" | "posting";
      gate_family?: "token_holding" | "identity_proof";
      gate_type?:
        | "erc721_holding"
        | "erc1155_holding"
        | "erc20_balance"
        | "solana_nft_holding"
        | "unique_human"
        | "age_over_18"
        | "nationality"
        | "gender"
        | "sanctions_clear"
        | "wallet_score";
      proof_requirements?: unknown[] | null;
      chain_namespace?: string | null;
      gate_config?: Record<string, unknown> | null;
      status?: "active" | "disabled";
    };

    return ok(
      await upsertCommunityGateRule({
        communityId: input.communityId,
        requestBody: body,
        store: input.store,
        env: input.env,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getCommunityMoneyPolicyById(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    await verifyPirateAccessToken(token, input.env);
    const community = requireCommunity(await input.store.getCommunityById(input.communityId));
    const moneyPolicy = await input.store.getCommunityMoneyPolicyByCommunityId(input.communityId);

    return ok(serializeCommunityMoneyPolicy(community, moneyPolicy));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function patchCommunityMoneyPolicyById(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  communityId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const body = await input.request.json();
    assertUpdateCommunityMoneyPolicyRequest(body);

    const updated = await input.store.withTransaction(async (tx) => {
      const community = requireCommunity(await tx.getCommunityById(input.communityId));
      assertCommunityCreator(community, session.userId);

      await tx.upsertCommunityMoneyPolicy({
        community_id: community.community_id,
        funding_preference: body.funding_preference,
        accepted_funding_assets_json: JSON.stringify(body.accepted_funding_assets),
        accepted_source_chains_json: JSON.stringify(body.accepted_source_chains),
        approved_route_providers_json:
          body.approved_route_providers == null ? null : JSON.stringify(body.approved_route_providers),
        destination_settlement_chain_json: JSON.stringify(body.destination_settlement_chain),
        destination_settlement_token: body.destination_settlement_token,
        treasury_denomination: body.treasury_denomination ?? null,
        max_slippage_bps: body.max_slippage_bps,
        quote_ttl_seconds: body.quote_ttl_seconds,
        route_required: body.route_required ? 1 : 0,
        route_status_policy: body.route_status_policy,
        route_hop_tolerance: body.route_hop_tolerance,
        updated_at: new Date().toISOString(),
      });

      const policy = await tx.getCommunityMoneyPolicyByCommunityId(community.community_id);
      if (!policy) {
        throw notFoundError("Failed to load updated community money policy");
      }

      return serializeCommunityMoneyPolicy(community, policy);
    });

    return ok(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
