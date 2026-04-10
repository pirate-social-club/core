import type { Env } from "../types/env";
import { authError } from "./errors";
import { assertStandardClaims, decodeJwt, verifyHmacSha256 } from "./jwt-codec";

export type ValidatedUpstreamJwt = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
};

export async function verifyUpstreamJwt(jwt: string, env: Env): Promise<ValidatedUpstreamJwt> {
  if (!jwt || typeof jwt !== "string" || jwt.split(".").length !== 3) {
    throw authError();
  }

  const decoded = decodeJwt(jwt);
  if (decoded.header.alg !== "HS256") {
    throw authError();
  }

  const signatureValid = await verifyHmacSha256({
    signingInput: decoded.signingInput,
    secret: env.AUTH_UPSTREAM_JWT_SHARED_SECRET,
    signature: decoded.signature,
  });

  if (!signatureValid) {
    throw authError();
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  assertStandardClaims({
    payload: decoded.payload,
    issuer: env.AUTH_UPSTREAM_JWT_ISSUER,
    audience: env.AUTH_UPSTREAM_JWT_AUDIENCE,
    nowSeconds,
  });

  return {
    iss: decoded.payload.iss as string,
    sub: decoded.payload.sub as string,
    aud: decoded.payload.aud as string | string[],
    exp: decoded.payload.exp as number,
  };
}
