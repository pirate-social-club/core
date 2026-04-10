import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import {
  authorizeDeviceSession,
  claimDeviceSession,
  createDeviceSession,
  getDeviceSession,
  getDeviceSessionByDeviceCode,
} from "../lib/device-session-service";
import type { JsonResponse, RequestLike } from "./http";
import { requireBearerToken, toErrorResponse } from "./http";

export async function postAuthDeviceSessions(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    return {
      status: 201,
      body: await createDeviceSession({
        requestBody: await input.request.json() as Record<string, unknown>,
        requestOrigin: new URL(input.request.url).origin,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getAuthDeviceSessionsById(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  deviceSessionId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    return {
      status: 200,
      body: await getDeviceSession({
        deviceSessionId: input.deviceSessionId,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function getAuthDeviceSessionsByDeviceCode(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  deviceCode: string;
}): Promise<JsonResponse<unknown>> {
  try {
    return {
      status: 200,
      body: await getDeviceSessionByDeviceCode({
        deviceCode: input.deviceCode,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postAuthDeviceSessionsByDeviceCodeClaim(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  deviceCode: string;
}): Promise<JsonResponse<unknown>> {
  try {
    return {
      status: 200,
      body: await claimDeviceSession({
        deviceCode: input.deviceCode,
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function postAuthDeviceSessionsByIdAuthorize(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
  deviceSessionId: string;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const body = await input.request.json() as { user_code?: string };
    return {
      status: 200,
      body: await authorizeDeviceSession({
        bearerToken: token,
        deviceSessionId: input.deviceSessionId,
        userCode: body.user_code ?? "",
        env: input.env,
        store: input.store,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}
