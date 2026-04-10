import type { Env } from "../types/env";
import { authError } from "./errors";
import { assertStandardClaims, decodeJwt, verifyEs256 } from "./jwt-codec";

export type PrivyWalletClaim = {
  chainNamespace: string;
  walletAddressNormalized: string;
  walletAddressDisplay: string;
};

export type VerifiedPrivyAccessToken = {
  userId: string;
  sessionId: string | null;
  issuer: string;
  appId: string;
  issuedAt: number | null;
  expiration: number;
};

type LinkedAccountClaim = {
  type?: unknown;
  address?: unknown;
  chain_type?: unknown;
};

function requirePrivyConfig(env: Env): {
  issuer: string;
  appId: string;
  publicKeyPem: string;
} {
  if (!env.PRIVY_APP_ID || !env.PRIVY_JWT_VERIFICATION_KEY) {
    throw authError();
  }

  return {
    issuer: env.PRIVY_ISSUER ?? "privy.io",
    appId: env.PRIVY_APP_ID,
    publicKeyPem: env.PRIVY_JWT_VERIFICATION_KEY,
  };
}

async function verifyPrivyJwt(token: string, env: Env) {
  if (!token || typeof token !== "string" || token.split(".").length !== 3) {
    throw authError();
  }

  const config = requirePrivyConfig(env);
  const decoded = decodeJwt(token);
  if (decoded.header.alg !== "ES256") {
    throw authError();
  }

  const signatureValid = await verifyEs256({
    signingInput: decoded.signingInput,
    publicKeyPem: config.publicKeyPem,
    signature: decoded.signature,
  });

  if (!signatureValid) {
    throw authError();
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  assertStandardClaims({
    payload: decoded.payload,
    issuer: config.issuer,
    audience: config.appId,
    nowSeconds,
  });

  return decoded.payload;
}

function normalizeWalletAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address.trim();
}

function mapLinkedAccountToWallet(account: LinkedAccountClaim): PrivyWalletClaim | null {
  if (typeof account.address !== "string" || account.address.length === 0) {
    return null;
  }

  const address = account.address.trim();
  if (address.length === 0) {
    return null;
  }

  const type = typeof account.type === "string" ? account.type.toLowerCase() : "";
  const chainType = typeof account.chain_type === "string" ? account.chain_type.toLowerCase() : "";

  let chainNamespace: string | null = null;
  if (type.includes("solana") || chainType === "solana") {
    chainNamespace = "solana";
  } else if (address.startsWith("0x")) {
    chainNamespace = "eip155:1";
  }

  if (!chainNamespace) {
    return null;
  }

  return {
    chainNamespace,
    walletAddressNormalized: normalizeWalletAddress(address),
    walletAddressDisplay: address,
  };
}

export async function verifyPrivyAccessToken(token: string, env: Env): Promise<VerifiedPrivyAccessToken> {
  const payload = await verifyPrivyJwt(token, env);

  return {
    userId: payload.sub as string,
    sessionId: typeof payload.sid === "string" ? payload.sid : null,
    issuer: payload.iss as string,
    appId: Array.isArray(payload.aud) ? String(payload.aud[0] ?? "") : String(payload.aud ?? ""),
    issuedAt: typeof payload.iat === "number" ? payload.iat : null,
    expiration: payload.exp as number,
  };
}

export async function verifyPrivyIdentityToken(input: {
  token: string;
  env: Env;
  expectedUserId: string;
}): Promise<PrivyWalletClaim[]> {
  const payload = await verifyPrivyJwt(input.token, input.env);
  if (payload.sub !== input.expectedUserId) {
    throw authError();
  }

  const linkedAccounts = payload.linked_accounts;
  if (!Array.isArray(linkedAccounts)) {
    return [];
  }

  const deduped = new Map<string, PrivyWalletClaim>();
  for (const account of linkedAccounts) {
    const wallet = mapLinkedAccountToWallet(account as LinkedAccountClaim);
    if (!wallet) {
      continue;
    }

    deduped.set(`${wallet.chainNamespace}:${wallet.walletAddressNormalized}`, wallet);
  }

  return Array.from(deduped.values());
}
