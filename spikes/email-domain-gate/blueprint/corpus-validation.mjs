import { readFile } from "node:fs/promises"

import { testBlueprint } from "@zk-email/sdk"

const draft = JSON.parse(
  await readFile(new URL("./draft-blueprint.json", import.meta.url), "utf8"),
)
const corpusUrl = new URL("../corpus/", import.meta.url)

async function readSample(name) {
  return readFile(new URL(name, corpusUrl), "utf8")
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

const primary = await readSample("proton-to-gmail.eml")
const primaryOutputs = await testBlueprint(primary, draft, false)
requireCondition(primaryOutputs.length === 3, "unexpected extraction count")
requireCondition(
  primaryOutputs.every((value) => value.length > 0),
  "one or more extraction outputs were empty",
)

let substitutedDomainRejected = false
try {
  await testBlueprint(primary, { ...draft, senderDomain: "example.invalid" }, false)
} catch (error) {
  substitutedDomainRejected = String(error).includes("senderDomain")
}
requireCondition(substitutedDomainRejected, "senderDomain substitution was accepted")

const canonicalOutputs = await testBlueprint(
  await readSample("proton-from-canonical.eml"),
  draft,
  false,
)
const variantOutputs = await testBlueprint(
  await readSample("proton-from-variant.eml"),
  draft,
  false,
)

const duplicateFrom = primary.replace(
  /(^|\r?\n)(From:)/,
  "$1From: attacker@evil.invalid\r\n$2",
)
let duplicateFromRejectedByParser = false
try {
  await testBlueprint(duplicateFrom, draft, false)
} catch (error) {
  duplicateFromRejectedByParser = String(error).includes(
    "From header contains multiple addresses",
  )
}
requireCondition(
  duplicateFromRejectedByParser,
  "duplicate From was not rejected by the SDK parser",
)

console.log(
  JSON.stringify({
    schema_version: 2,
    primary_sample_valid: true,
    extraction_count: primaryOutputs.length,
    to_extracted: false,
    substituted_domain_rejected_by_sdk_test: substitutedDomainRejected,
    presentation_pair_digest_equal:
      JSON.stringify(canonicalOutputs[0]) === JSON.stringify(variantOutputs[0]),
    presentation_pair_domain_equal:
      JSON.stringify(canonicalOutputs[1]) === JSON.stringify(variantOutputs[1]),
    presentation_pair_nonce_different:
      JSON.stringify(canonicalOutputs[2]) !== JSON.stringify(variantOutputs[2]),
    duplicate_from_rejected_by_sdk_parser: duplicateFromRejectedByParser,
    generated_circuit_signed_sequence_binding_verified: false,
    dynamic_verifier_wrapper_verified: false,
  }),
)
