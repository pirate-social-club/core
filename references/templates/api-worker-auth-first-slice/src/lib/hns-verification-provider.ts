import { internalError, notImplementedError } from "./errors";
import type { Env } from "../types/env";

type NamespaceControlClass =
  | "single_holder_root"
  | "multisig_controlled_root"
  | "dao_controlled_root"
  | "burned_or_immutable_root";

type NamespaceOperationClass =
  | "owner_managed_namespace"
  | "routing_only_namespace"
  | "pirate_delegated_namespace";

export type HnsNamespaceObservation = {
  rootExists: boolean;
  authoritativeDnsReady: boolean;
  expiryHorizonSufficient: boolean;
  routingEnabled: boolean;
  pirateDnsAuthorityVerified: boolean;
  challengePresent: boolean | null;
  challengeMatches: boolean | null;
  controlClass: NamespaceControlClass | null;
  operationClass: NamespaceOperationClass | null;
  observationProvider: string;
  evidenceBundleRef: string | null;
  failureReason: string | null;
};

type HnsVerifierResponse = {
  root_exists?: boolean;
  authoritative_dns_ready?: boolean;
  expiry_horizon_sufficient?: boolean;
  routing_enabled?: boolean;
  pirate_dns_authority_verified?: boolean;
  challenge_present?: boolean | null;
  challenge_matches?: boolean | null;
  control_class?: NamespaceControlClass | null;
  operation_class?: NamespaceOperationClass | null;
  observation_provider?: string | null;
  evidence_bundle_ref?: string | null;
  failure_reason?: string | null;
};

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function appendQuery(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

export async function inspectHnsNamespace(input: {
  env: Env;
  normalizedRootLabel: string;
  challengeHost?: string | null;
  challengeTxtValue?: string | null;
}): Promise<HnsNamespaceObservation> {
  if (input.env.ALLOW_STUB_NAMESPACE_VERIFICATION === "true") {
    const challengeRequested = Boolean(input.challengeHost && input.challengeTxtValue);
    return {
      rootExists: true,
      authoritativeDnsReady: true,
      expiryHorizonSufficient: true,
      routingEnabled: false,
      pirateDnsAuthorityVerified: false,
      challengePresent: challengeRequested ? true : null,
      challengeMatches: challengeRequested ? true : null,
      controlClass: "single_holder_root",
      operationClass: "owner_managed_namespace",
      observationProvider: "explicit_stub",
      evidenceBundleRef: null,
      failureReason: null,
    };
  }

  const verifierBaseUrl = input.env.HNS_VERIFIER_BASE_URL?.trim();
  if (!verifierBaseUrl) {
    throw notImplementedError("HNS verifier is not configured");
  }

  let url = appendQuery(verifierBaseUrl, "root_label", input.normalizedRootLabel);
  if (input.challengeHost) {
    url = appendQuery(url, "challenge_host", input.challengeHost);
  }
  if (input.challengeTxtValue) {
    url = appendQuery(url, "challenge_txt_value", input.challengeTxtValue);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(input.env.HNS_VERIFIER_AUTH_TOKEN
          ? {
              authorization: `Bearer ${input.env.HNS_VERIFIER_AUTH_TOKEN}`,
            }
          : {}),
      },
    });
  } catch {
    throw internalError("HNS verifier request failed");
  }

  let body: HnsVerifierResponse | null = null;
  try {
    body = await response.json() as HnsVerifierResponse;
  } catch {
    body = null;
  }

  if (!response.ok || !body) {
    throw internalError("HNS verifier returned an invalid response");
  }

  if (
    !isBoolean(body.root_exists) ||
    !isBoolean(body.authoritative_dns_ready) ||
    !isBoolean(body.expiry_horizon_sufficient) ||
    !isBoolean(body.routing_enabled) ||
    !isBoolean(body.pirate_dns_authority_verified) ||
    typeof body.observation_provider !== "string" ||
    body.observation_provider.trim() === ""
  ) {
    throw internalError("HNS verifier response is incomplete");
  }

  if (input.challengeHost || input.challengeTxtValue) {
    if (
      body.challenge_present !== null &&
      body.challenge_present !== undefined &&
      !isBoolean(body.challenge_present)
    ) {
      throw internalError("HNS verifier challenge_present is invalid");
    }
    if (
      body.challenge_matches !== null &&
      body.challenge_matches !== undefined &&
      !isBoolean(body.challenge_matches)
    ) {
      throw internalError("HNS verifier challenge_matches is invalid");
    }
  }

  return {
    rootExists: body.root_exists,
    authoritativeDnsReady: body.authoritative_dns_ready,
    expiryHorizonSufficient: body.expiry_horizon_sufficient,
    routingEnabled: body.routing_enabled,
    pirateDnsAuthorityVerified: body.pirate_dns_authority_verified,
    challengePresent: body.challenge_present ?? null,
    challengeMatches: body.challenge_matches ?? null,
    controlClass: body.control_class ?? null,
    operationClass: body.operation_class ?? null,
    observationProvider: body.observation_provider,
    evidenceBundleRef: body.evidence_bundle_ref ?? null,
    failureReason: body.failure_reason ?? null,
  };
}
