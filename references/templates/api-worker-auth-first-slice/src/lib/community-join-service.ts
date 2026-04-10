import type { CommunityGateRuleRow, CommunityRow, UserRow, WalletAttachmentRow } from "../types/db";
import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "./db";
import { loadCommunityGateRuleBoundary } from "./community-gate-rule-boundary";
import { loadCommunityMembershipBoundary } from "./community-membership-boundary";
import { evaluateErc721GateForWalletAttachments } from "./community-erc721-gate";
import { conflictError, gateFailed } from "./errors";
import { createId } from "./ids";
import { nowIso } from "./time";
import { serializeVerificationCapabilities } from "./verification-serializer";

type MembershipResult = {
  community_id: string;
  status: "joined" | "requested" | "left";
};

function parseGateConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

function evaluateIdentityGate(rule: CommunityGateRuleRow, user: UserRow): { passed: boolean; reason: string } {
  const capabilities = serializeVerificationCapabilities(user.verification_capabilities_json);
  const gateConfig = parseGateConfig(rule.gate_config_json);

  switch (rule.gate_type) {
    case "unique_human":
      return {
        passed: capabilities.unique_human.state === "verified",
        reason: "unique_human verification is required",
      };
    case "age_over_18":
      return {
        passed: capabilities.age_over_18.state === "verified",
        reason: "age_over_18 verification is required",
      };
    case "nationality": {
      const requiredValue = typeof gateConfig?.required_value === "string" ? gateConfig.required_value : null;
      const excludedValues = Array.isArray(gateConfig?.excluded_values)
        ? gateConfig.excluded_values.filter((value): value is string => typeof value === "string")
        : [];
      const value = capabilities.nationality.value ?? user.nationality;
      return {
        passed:
          value != null &&
          (requiredValue == null || value === requiredValue) &&
          !excludedValues.includes(value),
        reason: "nationality requirement is not satisfied",
      };
    }
    case "gender": {
      const requiredValue = typeof gateConfig?.required_value === "string" ? gateConfig.required_value : null;
      return {
        passed: requiredValue != null && capabilities.gender.value === requiredValue,
        reason: "gender requirement is not satisfied",
      };
    }
    case "sanctions_clear":
      return {
        passed: capabilities.sanctions_clear.state === "verified",
        reason: "sanctions_clear verification is required",
      };
    case "wallet_score": {
      const minimumScore =
        typeof gateConfig?.minimum_score === "number" ? gateConfig.minimum_score : null;
      const score = capabilities.wallet_score.score ?? null;
      return {
        passed:
          capabilities.wallet_score.state === "verified" &&
          score != null &&
          (minimumScore == null || score >= minimumScore),
        reason: "wallet score requirement is not satisfied",
      };
    }
    default:
      return {
        passed: false,
        reason: `Unsupported identity gate type ${rule.gate_type}`,
      };
  }
}

type MembershipRuleEvaluation = {
  rule: CommunityGateRuleRow;
  passed: boolean;
  reason: string;
  retryable?: boolean;
};

async function evaluateMembershipRule(input: {
  env: Env;
  rule: CommunityGateRuleRow;
  user: UserRow;
  walletAttachments: WalletAttachmentRow[];
}): Promise<Omit<MembershipRuleEvaluation, "rule">> {
  if (input.rule.gate_family === "identity_proof") {
    return evaluateIdentityGate(input.rule, input.user);
  }

  if (input.rule.gate_type === "erc721_holding") {
    const evaluation = await evaluateErc721GateForWalletAttachments({
      env: input.env,
      walletAttachments: input.walletAttachments,
      rawGateConfig: parseGateConfig(input.rule.gate_config_json),
    });

    return {
      passed: evaluation.status === "passed",
      reason: evaluation.reason,
      retryable: evaluation.status === "unavailable",
    };
  }

  return {
    passed: false,
    reason: `Unsupported token gate type ${input.rule.gate_type}`,
  };
}

function baselineJoinGateStatus(input: {
  user: UserRow;
  evaluations: MembershipRuleEvaluation[];
}):
  | { passed: true }
  | {
      passed: false;
      retryable: boolean;
      reason: string;
    } {
  const capabilities = serializeVerificationCapabilities(input.user.verification_capabilities_json);
  if (capabilities.unique_human.state === "verified") {
    return { passed: true };
  }

  if (capabilities.wallet_score.state === "verified" && capabilities.wallet_score.passing_score === true) {
    return { passed: true };
  }

  let unavailableReason: string | null = null;
  for (const evaluation of input.evaluations) {
    if (evaluation.rule.gate_family !== "token_holding") {
      continue;
    }

    if (evaluation.passed) {
      return { passed: true };
    }

    if (evaluation.retryable && unavailableReason == null) {
      unavailableReason = evaluation.reason;
    }
  }

  if (unavailableReason) {
    return {
      passed: false,
      retryable: true,
      reason: unavailableReason,
    };
  }

  return {
    passed: false,
    retryable: false,
    reason: "A platform baseline trust credential is required to join this community",
  };
}

export async function joinCommunity(input: {
  community: CommunityRow;
  user: UserRow;
  env: Env;
  store: AuthBootstrapStore;
  walletAttachments: WalletAttachmentRow[];
  now?: Date;
}): Promise<MembershipResult> {
  const now = input.now ?? new Date();
  const timestamp = nowIso(now);
  const gateRuleBoundary = await loadCommunityGateRuleBoundary(
    input.store,
    input.community.community_id,
  );
  const membershipBoundary = await loadCommunityMembershipBoundary(
    input.store,
    input.community.community_id,
  );
  const existingProjection = await input.store.getCommunityMembershipProjection(
    input.community.community_id,
    input.user.user_id,
  );

  if (membershipBoundary) {
    const activeMember = await membershipBoundary.getActiveMember(
      input.community.community_id,
      input.user.user_id,
    );
    if (activeMember) {
      return {
        community_id: input.community.community_id,
        status: "joined",
      };
    }

    const activeBan = await membershipBoundary.getActiveBan(
      input.community.community_id,
      input.user.user_id,
    );
    if (activeBan) {
      throw gateFailed("Membership is blocked for this community");
    }

    const pendingRequest = await membershipBoundary.getPendingRequest(
      input.community.community_id,
      input.user.user_id,
    );
    if (pendingRequest) {
      return {
        community_id: input.community.community_id,
        status: "requested",
      };
    }
  }

  if (existingProjection?.membership_state === "member") {
    return {
      community_id: input.community.community_id,
      status: "joined",
    };
  }

  // Compatibility path for stale projection rows written before request-mode
  // joins moved to the dedicated membership-request table.
  if (existingProjection?.membership_state === "pending_request") {
    return {
      community_id: input.community.community_id,
      status: "requested",
    };
  }

  if (existingProjection?.membership_state === "banned") {
    throw gateFailed("Membership is blocked for this community");
  }

  if (input.community.status !== "active") {
    throw conflictError("Community is not accepting joins");
  }

  const membershipRules = gateRuleBoundary
    ? await gateRuleBoundary.listActiveRules(input.community.community_id, "membership")
    : await input.store.listActiveCommunityGateRules(
        input.community.community_id,
        "membership",
      );
  const evaluations: MembershipRuleEvaluation[] = [];
  for (const rule of membershipRules) {
    evaluations.push({
      rule,
      ...(await evaluateMembershipRule({
        env: input.env,
        rule,
        user: input.user,
        walletAttachments: input.walletAttachments,
      })),
    });
  }
  const baselineStatus = baselineJoinGateStatus({
    user: input.user,
    evaluations,
  });
  if (!baselineStatus.passed) {
    throw gateFailed(baselineStatus.reason, baselineStatus.retryable);
  }

  for (const evaluation of evaluations) {
    if (!evaluation.passed) {
      throw gateFailed(evaluation.reason, evaluation.retryable ?? false);
    }
  }

  await input.store.withTransaction(async (tx) => {
    if (input.community.membership_mode === "request") {
      if (membershipBoundary) {
        await membershipBoundary.withTransaction(async (communityTx) => {
          const existingRequest = await communityTx.getPendingRequest(
            input.community.community_id,
            input.user.user_id,
          );
          if (!existingRequest) {
            await communityTx.insertPendingRequest({
              communityId: input.community.community_id,
              applicantUserId: input.user.user_id,
              timestamp,
            });
          }
        });
      } else {
        const existingRequest = await tx.getPendingCommunityMembershipRequest(
          input.community.community_id,
          input.user.user_id,
        );
        if (!existingRequest) {
          await tx.insertCommunityMembershipRequest({
            membership_request_id: createId("cmr"),
            community_id: input.community.community_id,
            applicant_user_id: input.user.user_id,
            status: "pending",
            note: null,
            reviewed_by_user_id: null,
            review_reason: null,
            resolved_at: null,
            expires_at: null,
            created_at: timestamp,
            updated_at: timestamp,
          });
        }
      }

      return;
    }

    if (membershipBoundary) {
      await membershipBoundary.withTransaction(async (communityTx) => {
        await communityTx.ensureActiveMember({
          communityId: input.community.community_id,
          userId: input.user.user_id,
          timestamp,
        });
      });
    }

    await tx.upsertCommunityMembershipProjection({
      projection_id: existingProjection?.projection_id ?? createId("cmp"),
      community_id: input.community.community_id,
      user_id: input.user.user_id,
      membership_state: "member",
      role_summary_json: existingProjection?.role_summary_json ?? null,
      source_updated_at: timestamp,
      created_at: existingProjection?.created_at ?? timestamp,
      updated_at: timestamp,
    });
  });

  return {
    community_id: input.community.community_id,
    status: input.community.membership_mode === "request" ? "requested" : "joined",
  };
}
