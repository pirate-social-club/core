import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { domainToASCII } from "node:url";

export const GOOGLE_DISCOVERY_URL =
  "https://accounts.google.com/.well-known/openid-configuration";

const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);
const CANONICAL_GOOGLE_ISSUER = "https://accounts.google.com";
const DIRECT_IDENTITY_CLAIMS = new Set([
  "email",
  "family_name",
  "given_name",
  "name",
  "picture",
  "profile",
]);
const CLOCK_SKEW_SECONDS = 60;

export class OidcSpikeError extends Error {
  constructor(code) {
    super(code);
    this.name = "OidcSpikeError";
    this.code = code;
  }
}

export function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function sha256Base64url(input) {
  return createHash("sha256").update(input).digest("base64url");
}

export function normalizeDomain(value) {
  if (typeof value !== "string") {
    throw new OidcSpikeError("invalid_expected_domain");
  }

  const withoutDot = value.trim().replace(/\.$/, "").toLowerCase();
  const ascii = domainToASCII(withoutDot);
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii.split(".").some((label) => !label || label.length > 63) ||
    !/^[a-z0-9.-]+$/.test(ascii)
  ) {
    throw new OidcSpikeError("invalid_expected_domain");
  }
  return ascii;
}

export function createAuthorizationAttempt({
  authorizationEndpoint,
  clientId,
  redirectUri,
  accountCase,
}) {
  if (accountCase !== "organization" && accountCase !== "consumer") {
    throw new OidcSpikeError("invalid_account_case");
  }

  const state = base64url(randomBytes(32));
  const nonce = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(64));
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", sha256Base64url(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "consent select_account");
  if (accountCase === "organization") {
    url.searchParams.set("hd", "*");
  }

  return {
    accountCase,
    authorizationUrl: url.toString(),
    codeVerifier,
    nonce,
    state,
  };
}

export function validateDiscovery(document) {
  if (
    !document ||
    document.issuer !== "https://accounts.google.com" ||
    !isHttpsUrl(document.authorization_endpoint) ||
    !isHttpsUrl(document.token_endpoint) ||
    !isHttpsUrl(document.jwks_uri) ||
    !isHttpsUrl(document.revocation_endpoint)
  ) {
    throw new OidcSpikeError("invalid_google_discovery_document");
  }
  return document;
}

export function validateGoogleIdToken({
  idToken,
  jwks,
  clientId,
  nonce,
  expectedDomain,
  hmacSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const { header, payload, signingInput, signature } = parseJwt(idToken);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new OidcSpikeError("unsupported_id_token_signing_key");
  }

  const matchingKeys = Array.isArray(jwks?.keys)
    ? jwks.keys.filter(
        (key) =>
          key.kid === header.kid &&
          key.kty === "RSA" &&
          (!key.alg || key.alg === "RS256") &&
          (!key.use || key.use === "sig"),
      )
    : [];
  if (matchingKeys.length !== 1) {
    throw new OidcSpikeError("unknown_id_token_signing_key");
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: matchingKeys[0], format: "jwk" });
  } catch {
    throw new OidcSpikeError("invalid_id_token_signing_key");
  }
  const verified = verifySignature(
    "RSA-SHA256",
    Buffer.from(signingInput),
    publicKey,
    signature,
  );
  if (!verified) {
    throw new OidcSpikeError("invalid_id_token_signature");
  }

  validateClaims({ payload, clientId, nonce, nowSeconds });
  const normalizedExpectedDomain = normalizeDomain(expectedDomain);
  const normalizedHostedDomain =
    typeof payload.hd === "string" ? normalizeDomain(payload.hd) : null;
  const claimNames = Object.keys(payload).sort();
  const directIdentityClaimsPresent = claimNames.filter((name) =>
    DIRECT_IDENTITY_CLAIMS.has(name),
  );
  const subjectHmac = createHmac("sha256", hmacSecret)
    .update(`${CANONICAL_GOOGLE_ISSUER}\0${payload.sub}`)
    .digest();

  return {
    evidence: {
      claim_names: claimNames,
      direct_identity_claims_present: directIdentityClaimsPresent,
      email_claim_present: claimNames.includes("email"),
      hosted_domain_claim_present: normalizedHostedDomain !== null,
      hosted_domain_matches_expected:
        normalizedHostedDomain === normalizedExpectedDomain,
      profile_disclosure_result:
        directIdentityClaimsPresent.length === 0
          ? "no_direct_identity_claims_observed"
          : "direct_identity_claims_observed",
      stable_subject_claim_present: true,
      token_validation: "passed",
    },
    subjectHmac,
  };
}

export function equalSecretValues(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right)) return false;
  return left.length === right.length && timingSafeEqual(left, right);
}

function validateClaims({ payload, clientId, nonce, nowSeconds }) {
  if (!payload || typeof payload !== "object") {
    throw new OidcSpikeError("invalid_id_token_payload");
  }
  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new OidcSpikeError("invalid_id_token_issuer");
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) {
    throw new OidcSpikeError("invalid_id_token_audience");
  }
  if (
    (audiences.length > 1 || payload.azp !== undefined) &&
    payload.azp !== clientId
  ) {
    throw new OidcSpikeError("invalid_id_token_authorized_party");
  }
  if (
    typeof payload.nonce !== "string" ||
    !safeStringEqual(payload.nonce, nonce)
  ) {
    throw new OidcSpikeError("invalid_id_token_nonce");
  }
  if (
    !Number.isInteger(payload.iat) ||
    payload.iat > nowSeconds + CLOCK_SKEW_SECONDS
  ) {
    throw new OidcSpikeError("invalid_id_token_issued_at");
  }
  if (
    !Number.isInteger(payload.exp) ||
    payload.exp <= nowSeconds - CLOCK_SKEW_SECONDS
  ) {
    throw new OidcSpikeError("expired_id_token");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new OidcSpikeError("missing_id_token_subject");
  }
}

function parseJwt(token) {
  if (typeof token !== "string" || token.length > 32_768) {
    throw new OidcSpikeError("invalid_id_token_format");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new OidcSpikeError("invalid_id_token_format");
  }

  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
      signature: Buffer.from(parts[2], "base64url"),
      signingInput: `${parts[0]}.${parts[1]}`,
    };
  } catch {
    throw new OidcSpikeError("invalid_id_token_format");
  }
}

function safeStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
