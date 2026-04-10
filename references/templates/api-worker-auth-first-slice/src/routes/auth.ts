import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import { exchangeJwtSession, exchangePrivySession } from "../lib/auth-bootstrap-service";
import { authError } from "../lib/errors";
import type { JsonResponse, RequestLike } from "./http";
import { ok, toErrorResponse } from "./http";

type SessionExchangeRequestBody = {
  proof?: {
    type?: string;
    jwt?: string;
    privy_access_token?: string;
    privy_identity_token?: string | null;
  };
};

export async function postAuthSessionExchange(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    const body = (await input.request.json()) as SessionExchangeRequestBody;

    if (body.proof?.type === "jwt_based_auth" && body.proof.jwt) {
      const response = await exchangeJwtSession({
        upstreamJwt: body.proof.jwt,
        env: input.env,
        store: input.store,
      });

      return ok(response);
    }

    if (body.proof?.type === "privy_access_token" && body.proof.privy_access_token) {
      const response = await exchangePrivySession({
        privyAccessToken: body.proof.privy_access_token,
        privyIdentityToken: body.proof.privy_identity_token ?? null,
        env: input.env,
        store: input.store,
      });

      return ok(response);
    }

    throw authError();
  } catch (error) {
    return toErrorResponse(error);
  }
}
