import assert from "node:assert/strict"
import test from "node:test"

import {
  evidenceFromPostProof,
  evidenceFromVerifierResult,
  evaluateCompatibility,
} from "./compatibility-policy.mjs"

function signature(overrides = {}) {
  return {
    index: 0,
    header_signature_verified: true,
    body_hash_verified: true,
    signing_domain: "company.example",
    from_domain: "company.example",
    signed_headers: ["from", "subject", "date"],
    algorithm: "rsa-sha256",
    header_canonicalization: "relaxed",
    signature_expiration_status: "unexpired",
    ...overrides,
  }
}

function evaluate(signatures, options = {}) {
  return evaluateCompatibility({ signatures }, {
    context: "advisory-preflight",
    confidence: "same-mailbox-external-path",
    ...options,
  })
}

test("classifies aligned supported evidence as compatible", () => {
  const result = evaluate([signature()])
  assert.equal(result.verdict, "compatible")
  assert.equal(result.selected_signature_index, 0)
  assert.deepEqual(result.reason_codes, [])
})

test("uses the first fully compatible signature deterministically", () => {
  const result = evaluate([
    signature({ index: 0, signing_domain: "relay.example" }),
    signature({ index: 1 }),
    signature({ index: 2 }),
  ])
  assert.equal(result.verdict, "compatible")
  assert.equal(result.selected_signature_index, 1)
})

test("rejects verified evidence that violates a policy obligation", () => {
  const result = evaluate([signature({
    signing_domain: "relay.example",
    signed_headers: ["from"],
    algorithm: "ed25519-sha256",
    header_canonicalization: "simple",
  })])
  assert.equal(result.verdict, "incompatible")
  assert.deepEqual(result.reason_codes, [
    "strict_alignment_failed",
    "required_header_missing:subject",
    "algorithm_unsupported",
    "header_canonicalization_unsupported",
  ])
})

test("rejects malformed domains instead of letting URL parsing reinterpret them", () => {
  const result = evaluate([signature({
    signing_domain: "untrusted@company.example",
  })])
  assert.equal(result.verdict, "incompatible")
  assert.ok(result.reason_codes.includes("strict_alignment_failed"))
})

test("treats missing or unverified signatures as inconclusive", () => {
  assert.equal(evaluate([]).verdict, "inconclusive")
  assert.deepEqual(evaluate([]).reason_codes, ["no_dkim_signature"])
  const invalid = evaluate([signature({ header_signature_verified: false })])
  assert.equal(invalid.verdict, "inconclusive")
  assert.deepEqual(invalid.reason_codes, ["no_verified_header_signature"])
})

test("ignores signer expiration and body-only rewriting with warnings", () => {
  const result = evaluate([signature({
    body_hash_verified: false,
    signature_expiration_status: "expired",
  })])
  assert.equal(result.verdict, "compatible")
  assert.deepEqual(result.warning_codes, [
    "signer_expiration_ignored",
    "body_hash_mismatch_ignored",
  ])
})

test("produces the same verdict in all three contexts", () => {
  const evidence = { signatures: [signature()] }
  const verdicts = [
    ["advisory-preflight", "same-mailbox-external-path"],
    ["fresh-preproof", "actual-ceremony-message"],
    ["postproof", "verified-proof"],
  ].map(([context, confidence]) => evaluateCompatibility(evidence, { context, confidence }).verdict)
  assert.deepEqual(verdicts, ["compatible", "compatible", "compatible"])
})

test("adapts verifier output without consulting legacy gate verdict fields", () => {
  const evidence = evidenceFromVerifierResult({
    signature_time_policy: "record-only",
    from_domain: "company.example",
    signatures: [{
      ...signature(),
      verified: false,
      failure_code: "body_hash_mismatch",
      header_signature_only_verified: true,
      gate_usable: false,
    }],
  })
  const result = evaluate(evidence.signatures)
  assert.equal(result.verdict, "compatible")
  assert.deepEqual(result.warning_codes, ["body_hash_mismatch_ignored"])
})

test("adapts post-proof evidence into the same policy shape", () => {
  const evidence = evidenceFromPostProof({
    proof_verified: true,
    pinned_key_matched: true,
    signing_domain: "company.example",
    from_domain: "company.example",
    signed_headers: ["from", "subject"],
    algorithm: "rsa-sha256",
    header_canonicalization: "relaxed",
  })
  const result = evaluateCompatibility(evidence, {
    context: "postproof",
    confidence: "verified-proof",
  })
  assert.equal(result.verdict, "compatible")
  assert.throws(
    () => evidenceFromPostProof({ proof_verified: false, pinned_key_matched: true }),
    /verified proof/,
  )
})

test("fails closed when the signer-time policy drifts", () => {
  assert.throws(
    () => evaluate([signature()], { policy: { signerTimePolicy: "enforce" } }),
    /record-only/,
  )
})
