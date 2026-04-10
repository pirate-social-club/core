import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import {
  completeNamespaceVerificationSession,
  completeVerificationSessionByCallback,
  completeVerificationSession,
  getNamespaceVerificationSession,
  getVerificationSession,
  startNamespaceVerificationSession,
  startVerificationSession,
} from "../lib/verification-service";
import type { JsonResponse, RequestLike } from "./http";
import { requireBearerToken, toErrorResponse } from "./http";

export async function postVerificationSessions(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    return {
      status: 201,
      body: await startVerificationSession({
        bearerToken: token,
        requestBody: await input.request.json() as Record<string, unknown>,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getVerificationSessionsById(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  verificationSessionId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    return {
      status: 200,
      body: await getVerificationSession({
        bearerToken: token,
        verificationSessionId: input.verificationSessionId,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postVerificationSessionsByIdComplete(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  verificationSessionId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    return {
      status: 200,
      body: await completeVerificationSession({
        bearerToken: token,
        verificationSessionId: input.verificationSessionId,
        requestBody: await input.request.json() as Record<string, unknown>,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postVerificationSessionsByIdCallback(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  verificationSessionId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    return {
      status: 200,
      body: await completeVerificationSessionByCallback({
        verificationSessionId: input.verificationSessionId,
        requestBody: await input.request.json() as Record<string, unknown>,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postNamespaceVerificationSessions(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    return {
      status: 201,
      body: await startNamespaceVerificationSession({
        bearerToken: token,
        requestBody: await input.request.json() as Record<string, unknown>,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getNamespaceVerificationSessionsById(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  namespaceVerificationSessionId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    return {
      status: 200,
      body: await getNamespaceVerificationSession({
        bearerToken: token,
        namespaceVerificationSessionId: input.namespaceVerificationSessionId,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postNamespaceVerificationSessionsByIdComplete(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  namespaceVerificationSessionId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const requestBody = await input.request.json().catch(() => ({})) as Record<string, unknown>;
    return {
      status: 200,
      body: await completeNamespaceVerificationSession({
        bearerToken: token,
        namespaceVerificationSessionId: input.namespaceVerificationSessionId,
        requestBody,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}
