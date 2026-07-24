import { json } from "../../shared/http";

export type HnsVerifierAuth = {
  primaryToken: string | null;
  observerToken: string | null;
};

function normalizeToken(value: string | undefined): string | null {
  return value?.trim() || null;
}

export function resolveHnsVerifierAuth(
  primaryValue: string | undefined,
  observerValue: string | undefined,
): HnsVerifierAuth {
  const primaryToken = normalizeToken(primaryValue);
  const observerToken = normalizeToken(observerValue);

  if (observerToken && !primaryToken) {
    throw new Error("HNS_VERIFIER_OBSERVER_AUTH_TOKEN requires HNS_VERIFIER_AUTH_TOKEN");
  }
  if (observerToken && observerToken === primaryToken) {
    throw new Error("HNS verifier primary and observer auth tokens must be distinct");
  }

  return { primaryToken, observerToken };
}

function isObserverRead(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const pathname = new URL(request.url).pathname;
  return pathname === "/observe-root-parent" || pathname === "/observe-root-authority";
}

export function requireHnsVerifierAuth(request: Request, auth: HnsVerifierAuth): Response | null {
  // Preserve explicitly open local development only when neither credential is
  // configured. Half-open observer configuration is rejected during startup.
  if (!auth.primaryToken) {
    return null;
  }

  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${auth.primaryToken}`) {
    return null;
  }
  if (
    auth.observerToken
    && authorization === `Bearer ${auth.observerToken}`
    && isObserverRead(request)
  ) {
    return null;
  }

  return json({ error: "Unauthorized" }, { status: 401 });
}
