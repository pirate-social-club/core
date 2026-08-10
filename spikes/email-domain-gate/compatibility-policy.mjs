const DEFAULT_POLICY = Object.freeze({
  requiredSignedHeaders: Object.freeze(["from", "subject"]),
  supportedAlgorithms: Object.freeze(["rsa-sha256"]),
  supportedHeaderCanonicalizations: Object.freeze(["relaxed"]),
  signerTimePolicy: "record-only",
})

const CONTEXTS = new Set([
  "gate-configuration",
  "advisory-preflight",
  "fresh-preproof",
  "postproof",
])
const CONFIDENCE_LEVELS = new Set([
  "representative-domain-path",
  "same-mailbox-external-path",
  "other-domain-mailbox",
  "actual-ceremony-message",
  "verified-proof",
  "unspecified",
])

function canonicalDomain(value) {
  if (typeof value !== "string" || !value.trim()) return null
  const candidate = value.trim().replace(/\.$/, "")
  if (/[\s/@\\:?#]/.test(candidate)) return null
  try {
    const hostname = new URL(`http://${candidate}`).hostname
      .replace(/\.$/, "")
      .toLowerCase()
    const labels = hostname.split(".")
    if (
      !hostname.includes(".")
      || hostname.length > 253
      || labels.some((label) => (
        label.length > 63
        || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      ))
    ) {
      return null
    }
    return hostname
  } catch {
    return null
  }
}

function normalizedStrings(values) {
  if (!Array.isArray(values)) return []
  return values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function evaluateSignature(signature, policy) {
  const failures = []
  const signingDomain = canonicalDomain(signature.signing_domain)
  const fromDomain = canonicalDomain(signature.from_domain)
  const signedHeaders = new Set(normalizedStrings(signature.signed_headers))
  const algorithm = typeof signature.algorithm === "string"
    ? signature.algorithm.trim().toLowerCase()
    : null
  const headerCanonicalization = typeof signature.header_canonicalization === "string"
    ? signature.header_canonicalization.trim().toLowerCase()
    : null

  if (signingDomain === null || fromDomain === null || signingDomain !== fromDomain) {
    failures.push("strict_alignment_failed")
  }
  if (policy.expectedDomain !== null && fromDomain !== policy.expectedDomain) {
    failures.push("configured_domain_mismatch")
  }
  for (const requiredHeader of policy.requiredSignedHeaders) {
    if (!signedHeaders.has(requiredHeader)) {
      failures.push(`required_header_missing:${requiredHeader}`)
    }
  }
  if (!policy.supportedAlgorithms.includes(algorithm)) {
    failures.push("algorithm_unsupported")
  }
  if (!policy.supportedHeaderCanonicalizations.includes(headerCanonicalization)) {
    failures.push("header_canonicalization_unsupported")
  }

  const warnings = []
  if (signature.signature_expiration_status === "expired") {
    warnings.push("signer_expiration_ignored")
  }
  if (signature.body_hash_verified === false) {
    warnings.push("body_hash_mismatch_ignored")
  }

  return {
    index: Number.isInteger(signature.index) ? signature.index : 0,
    headerSignatureVerified: signature.header_signature_verified === true,
    failures,
    warnings,
  }
}

function compareSignatureIndex(left, right) {
  return left.index - right.index
}

export function evaluateCompatibility(evidence, options = {}) {
  const context = options.context ?? "advisory-preflight"
  const confidence = options.confidence ?? "unspecified"
  if (!CONTEXTS.has(context)) throw new Error("unsupported compatibility context")
  if (!CONFIDENCE_LEVELS.has(confidence)) throw new Error("unsupported confidence level")

  const policy = {
    expectedDomain: options.policy?.expectedDomain === undefined
      ? null
      : canonicalDomain(options.policy.expectedDomain),
    requiredSignedHeaders: normalizedStrings(
      options.policy?.requiredSignedHeaders ?? DEFAULT_POLICY.requiredSignedHeaders,
    ),
    supportedAlgorithms: normalizedStrings(
      options.policy?.supportedAlgorithms ?? DEFAULT_POLICY.supportedAlgorithms,
    ),
    supportedHeaderCanonicalizations: normalizedStrings(
      options.policy?.supportedHeaderCanonicalizations
        ?? DEFAULT_POLICY.supportedHeaderCanonicalizations,
    ),
    signerTimePolicy: options.policy?.signerTimePolicy ?? DEFAULT_POLICY.signerTimePolicy,
  }
  if (options.policy?.expectedDomain !== undefined && policy.expectedDomain === null) {
    throw new Error("expected domain is invalid")
  }
  if (policy.signerTimePolicy !== "record-only") {
    throw new Error("only the committed record-only signer-time policy is supported")
  }

  const signatures = Array.isArray(evidence?.signatures) ? evidence.signatures : []
  if (signatures.length === 0) {
    return {
      verdict: "inconclusive",
      context,
      confidence,
      selected_signature_index: null,
      reason_codes: ["no_dkim_signature"],
      warning_codes: [],
    }
  }

  const evaluated = signatures.map((signature) => evaluateSignature(signature, policy))
    .sort(compareSignatureIndex)
  const compatible = evaluated.find(
    (signature) => signature.headerSignatureVerified && signature.failures.length === 0,
  )
  if (compatible) {
    return {
      verdict: "compatible",
      context,
      confidence,
      selected_signature_index: compatible.index,
      reason_codes: [],
      warning_codes: compatible.warnings,
    }
  }

  const verified = evaluated.find((signature) => signature.headerSignatureVerified)
  if (verified) {
    return {
      verdict: "incompatible",
      context,
      confidence,
      selected_signature_index: verified.index,
      reason_codes: verified.failures,
      warning_codes: verified.warnings,
    }
  }

  return {
    verdict: "inconclusive",
    context,
    confidence,
    selected_signature_index: null,
    reason_codes: ["no_verified_header_signature"],
    warning_codes: [],
  }
}

export function evidenceFromVerifierResult(result) {
  if (result?.signature_time_policy !== "record-only") {
    throw new Error("verifier evidence must use record-only signature-time policy")
  }
  return {
    signatures: (result.signatures ?? []).map((signature) => ({
      index: signature.index,
      header_signature_verified:
        signature.header_signature_only_verified ?? signature.verified === true,
      body_hash_verified:
        signature.verified === true
          ? true
          : signature.failure_code === "body_hash_mismatch"
            ? false
            : null,
      signing_domain: signature.signing_domain,
      from_domain: result.from_domain,
      signed_headers: signature.signed_headers,
      algorithm: signature.algorithm,
      header_canonicalization: signature.header_canonicalization,
      signature_expiration_status: signature.signature_expiration_status,
    })),
  }
}

export function evidenceFromPostProof(input) {
  if (input.proof_verified !== true || input.pinned_key_matched !== true) {
    throw new Error("post-proof evidence requires a verified proof and pinned-key match")
  }
  return {
    signatures: [{
      index: input.signature_index ?? 0,
      header_signature_verified: true,
      body_hash_verified: null,
      signing_domain: input.signing_domain,
      from_domain: input.from_domain,
      signed_headers: input.signed_headers,
      algorithm: input.algorithm,
      header_canonicalization: input.header_canonicalization,
      signature_expiration_status: input.signature_expiration_status ?? "not-declared",
    }],
  }
}

export { DEFAULT_POLICY }
