import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import { authError } from "../lib/errors";
import { verifyPirateAccessToken } from "../lib/pirate-session-jwt";
import { serializeUser } from "../lib/user-serializer";
import type { JsonResponse, RequestLike } from "./http";
import { ok, requireBearerToken, toErrorResponse } from "./http";

export async function getUsersMe(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const userRow = await input.store.getUser(session.userId);
    if (!userRow) {
      throw authError();
    }
    return ok(serializeUser(userRow));
  } catch (error) {
    return toErrorResponse(error);
  }
}
