#!/usr/bin/env node

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  evidenceFromVerifierResult,
  evaluateCompatibility,
} from "./compatibility-policy.mjs"

const cases = [
  { label: "proton-to-gmail", verdict: "compatible", expired: true },
  { label: "proton-from-canonical", verdict: "compatible", expired: true },
  { label: "proton-from-variant", verdict: "compatible", expired: true },
  {
    label: "workspace-to-gmail",
    verdict: "incompatible",
    reason: "strict_alignment_failed",
  },
  { label: "gmail-to-proton", verdict: "inconclusive" },
  { label: "proton-self", verdict: "inconclusive" },
]

const observations = []
for (const item of cases) {
  const raw = await readFile(new URL(`./results/${item.label}.crypto.json`, import.meta.url), "utf8")
  const verifierResult = JSON.parse(raw)
  const evidence = evidenceFromVerifierResult(verifierResult)
  const result = evaluateCompatibility(evidence, {
    context: "advisory-preflight",
    confidence: "same-mailbox-external-path",
  })
  assert.equal(result.verdict, item.verdict, `${item.label} verdict drifted`)
  if (item.reason) {
    assert.ok(result.reason_codes.includes(item.reason), `${item.label} reason drifted`)
  }
  if (item.expired) {
    assert.ok(
      result.warning_codes.includes("signer_expiration_ignored"),
      `${item.label} expiration policy drifted`,
    )
  }
  observations.push({
    label: item.label,
    verdict: result.verdict,
    reason_codes: result.reason_codes,
    warning_codes: result.warning_codes,
  })
}

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  case_count: observations.length,
  observations,
}, null, 2)}\n`)
