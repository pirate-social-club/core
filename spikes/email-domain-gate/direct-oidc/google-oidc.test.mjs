import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  OidcSpikeError,
  base64url,
  createAuthorizationAttempt,
  equalSecretValues,
  normalizeDomain,
  validateDiscovery,
  validateGoogleIdToken,
} from "./google-oidc.mjs";

const clientId = "spike-client.apps.googleusercontent.com";
const nonce = "test-nonce";
const expectedDomain = "example.test";
const nowSeconds = 1_800_000_000;
const hmacSecret = Buffer.alloc(32, 7);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: "jwk" });
const jwks = {
  keys: [{ ...publicJwk, alg: "RS256", kid: "test-key", use: "sig" }],
};

test("organizational authorization requests profile without email", () => {
  const attempt = createAuthorizationAttempt({
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId,
    redirectUri: "http://127.0.0.1:8787/callback",
    accountCase: "organization",
  });
  const url = new URL(attempt.authorizationUrl);

  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.has("email"), false);
  assert.equal(url.searchParams.get("hd"), "*");
  assert.equal(url.searchParams.get("access_type"), "online");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.notEqual(url.searchParams.get("code_challenge"), attempt.codeVerifier);
});

test("consumer control omits the hosted-domain chooser hint", () => {
  const attempt = createAuthorizationAttempt({
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId,
    redirectUri: "http://127.0.0.1:8787/callback",
    accountCase: "consumer",
  });
  assert.equal(new URL(attempt.authorizationUrl).searchParams.has("hd"), false);
});

test("valid organizational token reports names and booleans without values", () => {
  const token = makeToken({
    hd: "Example.Test",
    name: "Test Principal",
    picture: "https://images.invalid/private",
  });
  const result = validateGoogleIdToken({
    idToken: token,
    jwks,
    clientId,
    nonce,
    expectedDomain,
    hmacSecret,
    nowSeconds,
  });
  const serialized = JSON.stringify(result.evidence);

  assert.equal(result.evidence.hosted_domain_matches_expected, true);
  assert.equal(result.evidence.email_claim_present, false);
  assert.deepEqual(result.evidence.direct_identity_claims_present, [
    "name",
    "picture",
  ]);
  assert.equal(serialized.includes("Test Principal"), false);
  assert.equal(serialized.includes("images.invalid"), false);
  assert.equal(serialized.includes("opaque-subject"), false);
  assert.equal(serialized.includes("example.test"), false);
});

test("consumer token is valid but does not satisfy the domain", () => {
  const result = validateGoogleIdToken({
    idToken: makeToken(),
    jwks,
    clientId,
    nonce,
    expectedDomain,
    hmacSecret,
    nowSeconds,
  });
  assert.equal(result.evidence.hosted_domain_claim_present, false);
  assert.equal(result.evidence.hosted_domain_matches_expected, false);
});

test("subject HMAC is stable without exposing the raw subject", () => {
  const first = validateGoogleIdToken({
    idToken: makeToken({ hd: expectedDomain }),
    jwks,
    clientId,
    nonce,
    expectedDomain,
    hmacSecret,
    nowSeconds,
  });
  const second = validateGoogleIdToken({
    idToken: makeToken({ hd: expectedDomain }),
    jwks,
    clientId,
    nonce,
    expectedDomain,
    hmacSecret,
    nowSeconds,
  });
  assert.equal(equalSecretValues(first.subjectHmac, second.subjectHmac), true);
  assert.equal(first.subjectHmac.toString("hex").includes("opaque-subject"), false);
});

test("subject HMAC canonicalizes both accepted Google issuer spellings", () => {
  const first = validateGoogleIdToken({
    idToken: makeToken({ hd: expectedDomain }),
    jwks,
    clientId,
    nonce,
    expectedDomain,
    hmacSecret,
    nowSeconds,
  });
  const second = validateGoogleIdToken({
    idToken: makeToken({ iss: "accounts.google.com", hd: expectedDomain }),
    jwks,
    clientId,
    nonce,
    expectedDomain,
    hmacSecret,
    nowSeconds,
  });
  assert.equal(equalSecretValues(first.subjectHmac, second.subjectHmac), true);
});

for (const [label, override, code] of [
  ["wrong nonce", { nonce: "wrong" }, "invalid_id_token_nonce"],
  ["wrong audience", { aud: "other-client" }, "invalid_id_token_audience"],
  ["expired token", { exp: nowSeconds - 120 }, "expired_id_token"],
]) {
  test(`rejects ${label}`, () => {
    assert.throws(
      () =>
        validateGoogleIdToken({
          idToken: makeToken(override),
          jwks,
          clientId,
          nonce,
          expectedDomain,
          hmacSecret,
          nowSeconds,
        }),
      (error) => error instanceof OidcSpikeError && error.code === code,
    );
  });
}

test("rejects a token whose signed payload was changed", () => {
  const token = makeToken({ hd: expectedDomain });
  const [header, payload, signature] = token.split(".");
  const changedPayload = base64url(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      hd: "attacker.test",
    }),
  );
  assert.throws(
    () =>
      validateGoogleIdToken({
        idToken: `${header}.${changedPayload}.${signature}`,
        jwks,
        clientId,
        nonce,
        expectedDomain,
        hmacSecret,
        nowSeconds,
      }),
    (error) =>
      error instanceof OidcSpikeError &&
      error.code === "invalid_id_token_signature",
  );
});

test("normalizes IDNA and trailing dot for exact domain comparison", () => {
  assert.equal(normalizeDomain("BÜCHER.example."), "xn--bcher-kva.example");
});

test("rejects non-Google discovery metadata", () => {
  assert.throws(
    () =>
      validateDiscovery({
        issuer: "https://attacker.test",
        authorization_endpoint: "https://attacker.test/auth",
        token_endpoint: "https://attacker.test/token",
        jwks_uri: "https://attacker.test/jwks",
        revocation_endpoint: "https://attacker.test/revoke",
      }),
    (error) =>
      error instanceof OidcSpikeError &&
      error.code === "invalid_google_discovery_document",
  );
});

function makeToken(overrides = {}) {
  const header = { alg: "RS256", kid: "test-key", typ: "JWT" };
  const payload = {
    aud: clientId,
    exp: nowSeconds + 600,
    iat: nowSeconds - 5,
    iss: "https://accounts.google.com",
    nonce,
    sub: "opaque-subject",
    ...overrides,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}
