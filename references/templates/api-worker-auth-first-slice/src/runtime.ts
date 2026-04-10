import type { AuthBootstrapStore } from "./lib/db";
import { createBunTransactionalSqlExecutor } from "./lib/bun-sql-executor";
import { SqlAuthBootstrapStore } from "./lib/sql-auth-bootstrap-store";
import type { Env } from "./types/env";
import { getUsersMe } from "./routes/users";
import { postAuthSessionExchange } from "./routes/auth";
import { getLatestRedditImport, getOnboardingStatus, postRedditImport, postRedditVerification } from "./routes/onboarding";
import { getProfilesMe, patchProfilesMe } from "./routes/profiles";
import {
  getAuthDeviceSessionsById,
  getAuthDeviceSessionsByDeviceCode,
  postAuthDeviceSessions,
  postAuthDeviceSessionsByIdAuthorize,
  postAuthDeviceSessionsByDeviceCodeClaim,
} from "./routes/device-sessions";
import {
  getCommunityById,
  getInternalCommunityGateRules,
  getCommunityMembershipRequests,
  getCommunityMoneyPolicyById,
  patchCommunityMoneyPolicyById,
  postCommunityMembershipRequestReview,
  postInternalCommunityGateRules,
  postCommunityJoin,
  postCommunities,
} from "./routes/communities";
import { getJobById } from "./routes/jobs";
import {
  getNamespaceVerificationSessionsById,
  getVerificationSessionsById,
  postNamespaceVerificationSessions,
  postNamespaceVerificationSessionsByIdComplete,
  postVerificationSessionsByIdCallback,
  postVerificationSessions,
  postVerificationSessionsByIdComplete,
} from "./routes/verification";

function jsonResponse(input: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(input.body), {
    status: input.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function methodNotAllowed(): Response {
  return jsonResponse({
    status: 405,
    body: {
      code: "method_not_allowed",
      message: "Method not allowed",
      retryable: false,
    },
  });
}

function notFound(): Response {
  return jsonResponse({
    status: 404,
    body: {
      code: "not_found",
      message: "Not found",
      retryable: false,
    },
  });
}

function matchPath(pathname: string, pattern: RegExp): string[] | null {
  const match = pathname.match(pattern);
  if (!match) {
    return null;
  }

  return match.slice(1).map((value) => decodeURIComponent(value));
}

export function createRuntimeStore(env: Env): AuthBootstrapStore {
  return new SqlAuthBootstrapStore(createBunTransactionalSqlExecutor(env.CONTROL_PLANE_DATABASE_URL));
}

export function createFetchHandler(input: {
  env: Env;
  store: AuthBootstrapStore;
}): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        status: 200,
        body: {
          ok: true,
        },
      });
    }

    if (url.pathname === "/auth/session/exchange") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postAuthSessionExchange({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    if (url.pathname === "/auth/device-sessions") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postAuthDeviceSessions({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    const authorizeDeviceSessionMatch = matchPath(
      url.pathname,
      /^\/auth\/device-sessions\/([^/]+)\/authorize$/,
    );
    if (authorizeDeviceSessionMatch) {
      const [deviceSessionId] = authorizeDeviceSessionMatch;

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postAuthDeviceSessionsByIdAuthorize({
          request,
          env: input.env,
          store: input.store,
          deviceSessionId,
        }),
      );
    }

    const claimByDeviceCodeMatch = matchPath(
      url.pathname,
      /^\/auth\/device-sessions\/by-device-code\/([^/]+)\/claim$/,
    );
    if (claimByDeviceCodeMatch) {
      const [deviceCode] = claimByDeviceCodeMatch;

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postAuthDeviceSessionsByDeviceCodeClaim({
          request,
          env: input.env,
          store: input.store,
          deviceCode,
        }),
      );
    }

    const deviceSessionByCodeMatch = matchPath(
      url.pathname,
      /^\/auth\/device-sessions\/by-device-code\/([^/]+)$/,
    );
    if (deviceSessionByCodeMatch) {
      const [deviceCode] = deviceSessionByCodeMatch;

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getAuthDeviceSessionsByDeviceCode({
          request,
          env: input.env,
          store: input.store,
          deviceCode,
        }),
      );
    }

    const deviceSessionMatch = matchPath(url.pathname, /^\/auth\/device-sessions\/([^/]+)$/);
    if (deviceSessionMatch) {
      const [deviceSessionId] = deviceSessionMatch;

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getAuthDeviceSessionsById({
          request,
          env: input.env,
          store: input.store,
          deviceSessionId,
        }),
      );
    }

    if (url.pathname === "/users/me") {
      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getUsersMe({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    if (url.pathname === "/onboarding/status") {
      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getOnboardingStatus({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    if (url.pathname === "/profiles/me") {
      if (request.method === "GET") {
        return jsonResponse(
          await getProfilesMe({
            request,
            env: input.env,
            store: input.store,
          }),
        );
      }

      if (request.method === "PATCH") {
        return jsonResponse(
          await patchProfilesMe({
            request,
            env: input.env,
            store: input.store,
          }),
        );
      }

      return methodNotAllowed();
    }

    if (url.pathname === "/verification-sessions") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postVerificationSessions({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    const verificationSessionCompleteMatch = matchPath(
      url.pathname,
      /^\/verification-sessions\/([^/]+)\/complete$/,
    );
    if (verificationSessionCompleteMatch) {
      const [verificationSessionId] = verificationSessionCompleteMatch;

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postVerificationSessionsByIdComplete({
          request,
          env: input.env,
          store: input.store,
          verificationSessionId,
        }),
      );
    }

    const verificationSessionCallbackMatch = matchPath(
      url.pathname,
      /^\/verification-sessions\/([^/]+)\/callback$/,
    );
    if (verificationSessionCallbackMatch) {
      const [verificationSessionId] = verificationSessionCallbackMatch;

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postVerificationSessionsByIdCallback({
          request,
          env: input.env,
          store: input.store,
          verificationSessionId,
        }),
      );
    }

    const verificationSessionMatch = matchPath(url.pathname, /^\/verification-sessions\/([^/]+)$/);
    if (verificationSessionMatch) {
      const [verificationSessionId] = verificationSessionMatch;

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getVerificationSessionsById({
          request,
          env: input.env,
          store: input.store,
          verificationSessionId,
        }),
      );
    }

    if (url.pathname === "/namespace-verification-sessions") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postNamespaceVerificationSessions({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    const namespaceVerificationSessionCompleteMatch = matchPath(
      url.pathname,
      /^\/namespace-verification-sessions\/([^/]+)\/complete$/,
    );
    if (namespaceVerificationSessionCompleteMatch) {
      const [namespaceVerificationSessionId] = namespaceVerificationSessionCompleteMatch;

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postNamespaceVerificationSessionsByIdComplete({
          request,
          env: input.env,
          store: input.store,
          namespaceVerificationSessionId,
        }),
      );
    }

    const namespaceVerificationSessionMatch = matchPath(
      url.pathname,
      /^\/namespace-verification-sessions\/([^/]+)$/,
    );
    if (namespaceVerificationSessionMatch) {
      const [namespaceVerificationSessionId] = namespaceVerificationSessionMatch;

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getNamespaceVerificationSessionsById({
          request,
          env: input.env,
          store: input.store,
          namespaceVerificationSessionId,
        }),
      );
    }

    if (url.pathname === "/onboarding/reddit-verification") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postRedditVerification({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    if (url.pathname === "/onboarding/reddit-imports") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postRedditImport({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    if (url.pathname === "/onboarding/reddit-imports/latest") {
      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getLatestRedditImport({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    if (url.pathname === "/communities") {
      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postCommunities({
          request,
          env: input.env,
          store: input.store,
        }),
      );
    }

    const communityMoneyPolicyMatch = matchPath(
      url.pathname,
      /^\/communities\/([^/]+)\/money-policy$/,
    );
    if (communityMoneyPolicyMatch) {
      const [communityId] = communityMoneyPolicyMatch;

      if (request.method === "GET") {
        return jsonResponse(
          await getCommunityMoneyPolicyById({
            request,
            env: input.env,
            store: input.store,
            communityId,
          }),
        );
      }

      if (request.method === "PATCH") {
        return jsonResponse(
          await patchCommunityMoneyPolicyById({
            request,
            env: input.env,
            store: input.store,
            communityId,
          }),
        );
      }

      return methodNotAllowed();
    }

    const communityJoinMatch = matchPath(url.pathname, /^\/communities\/([^/]+)\/join$/);
    if (communityJoinMatch) {
      const [communityId] = communityJoinMatch;

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postCommunityJoin({
          request,
          env: input.env,
          store: input.store,
          communityId,
        }),
      );
    }

    const communityMembershipRequestReviewMatch = matchPath(
      url.pathname,
      /^\/communities\/([^/]+)\/membership-requests\/([^/]+)\/review$/,
    );
    if (communityMembershipRequestReviewMatch) {
      const [communityId, membershipRequestId] = communityMembershipRequestReviewMatch;

      if (request.method !== "POST") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await postCommunityMembershipRequestReview({
          request,
          env: input.env,
          store: input.store,
          communityId,
          membershipRequestId,
        }),
      );
    }

    const communityMembershipRequestsMatch = matchPath(
      url.pathname,
      /^\/communities\/([^/]+)\/membership-requests$/,
    );
    if (communityMembershipRequestsMatch) {
      const [communityId] = communityMembershipRequestsMatch;

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getCommunityMembershipRequests({
          request,
          env: input.env,
          store: input.store,
          communityId,
        }),
      );
    }

    const internalCommunityGateRulesMatch = matchPath(
      url.pathname,
      /^\/internal\/communities\/([^/]+)\/gate-rules$/,
    );
    if (internalCommunityGateRulesMatch) {
      const [communityId] = internalCommunityGateRulesMatch;

      if (request.method === "GET") {
        return jsonResponse(
          await getInternalCommunityGateRules({
            request,
            env: input.env,
            store: input.store,
            communityId,
          }),
        );
      }

      if (request.method === "POST") {
        return jsonResponse(
          await postInternalCommunityGateRules({
            request,
            env: input.env,
            store: input.store,
            communityId,
          }),
        );
      }

      return methodNotAllowed();
    }

    const communityMatch = matchPath(url.pathname, /^\/communities\/([^/]+)$/);
    if (communityMatch) {
      const [communityId] = communityMatch;

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getCommunityById({
          request,
          env: input.env,
          store: input.store,
          communityId,
        }),
      );
    }

    const jobMatch = matchPath(url.pathname, /^\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const [jobId] = jobMatch;

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      return jsonResponse(
        await getJobById({
          request,
          env: input.env,
          store: input.store,
          jobId,
        }),
      );
    }

    return notFound();
  };
}
