import type { Env } from "../types/env";
import { authError } from "./errors";
import { assertStandardClaims, decodeJwt, encodeJwt, signRs256, verifyRs256 } from "./jwt-codec";

export const PIRATE_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const PIRATE_ACCESS_TOKEN_ALG = "RS256";

export async function signPirateAccessToken(input: {
  userId: string;
  env: Env;
  now: Date;
}): Promise<string> {
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  const payload = {
    iss: input.env.PIRATE_APP_JWT_ISSUER,
    aud: input.env.PIRATE_APP_JWT_AUDIENCE,
    sub: input.userId,
    iat: issuedAt,
    exp: issuedAt + PIRATE_ACCESS_TOKEN_TTL_SECONDS,
  };
  const header = {
    alg: PIRATE_ACCESS_TOKEN_ALG,
    typ: "JWT",
  };
  const unsigned = encodeJwt({
    header,
    payload,
    signature: new Uint8Array(),
  });
  const signingInput = unsigned.slice(0, unsigned.lastIndexOf("."));
  const signature = await signRs256({
    signingInput,
    privateKeyPem: input.env.PIRATE_APP_JWT_PRIVATE_KEY,
  });

  return encodeJwt({
    header,
    payload,
    signature,
  });
}

export async function verifyPirateAccessToken(token: string, env: Env): Promise<{ userId: string }> {
  const decoded = decodeJwt(token);
  if (decoded.header.alg !== PIRATE_ACCESS_TOKEN_ALG) {
    throw authError();
  }

  const valid = await verifyRs256({
    signingInput: decoded.signingInput,
    publicKeyPem: env.PIRATE_APP_JWT_PUBLIC_KEY,
    signature: decoded.signature,
  });

  if (!valid) {
    throw authError();
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  assertStandardClaims({
    payload: decoded.payload,
    issuer: env.PIRATE_APP_JWT_ISSUER,
    audience: env.PIRATE_APP_JWT_AUDIENCE,
    nowSeconds,
  });

  return {
    userId: decoded.payload.sub as string,
  };
}
