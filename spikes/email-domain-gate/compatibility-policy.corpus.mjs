#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { resolveTxt } from "node:dns/promises"
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { evidenceFromRawEmail } from "./blueprint/browser-evidence-adapter.mjs"
import {
  evidenceFromVerifierResult,
  evaluateCompatibility,
} from "./compatibility-policy.mjs"

const execFileAsync = promisify(execFile)
const spikeDirectory = fileURLToPath(new URL("./", import.meta.url))

const cases = [
  { label: "proton-to-gmail", expectation: "pass", verdict: "compatible", expired: true },
  { label: "proton-from-canonical", expectation: "pass", verdict: "compatible", expired: true },
  { label: "proton-from-variant", expectation: "pass", verdict: "compatible", expired: true },
  {
    label: "workspace-to-gmail",
    expectation: "fail",
    verdict: "incompatible",
    reason: "strict_alignment_failed",
  },
  { label: "gmail-to-proton", expectation: "fail", verdict: "inconclusive" },
  { label: "proton-self", expectation: "no-signature", verdict: "inconclusive" },
]

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--python" || !argv[1]) {
    throw new Error("usage: compatibility-policy.corpus.mjs --python <venv-python>")
  }
  return { python: argv[1] }
}

async function systemTxtResolver(name, type) {
  if (type !== "TXT") throw new Error("only TXT lookups are supported")
  return (await resolveTxt(name)).map((parts) => parts.join(""))
}

async function regeneratePythonEvidence(item, python, temporaryDirectory) {
  const corpusPath = join(spikeDirectory, "corpus", `${item.label}.eml`)
  const outputPath = join(temporaryDirectory, `${item.label}.crypto.json`)
  try {
    await execFileAsync(python, [
      join(spikeDirectory, "verify-dkim.py"),
      "--label", item.label,
      "--file", corpusPath,
      "--expect", item.expectation,
      "--signature-time-policy", "record-only",
      "--ignore-body-hash",
      "--out", outputPath,
    ], { maxBuffer: 1024 * 1024 })
  } catch {
    throw new Error(`Python verifier regeneration failed for ${item.label}`)
  }
  return {
    rawEmail: await readFile(corpusPath),
    verifierResult: JSON.parse(await readFile(outputPath, "utf8")),
  }
}

const { python } = parseArguments(process.argv.slice(2))
const temporaryDirectory = await mkdtemp(join(tmpdir(), "email-domain-policy-"))
await chmod(temporaryDirectory, 0o700)

try {
  const observations = []
  for (const item of cases) {
    const { rawEmail, verifierResult } = await regeneratePythonEvidence(
      item,
      python,
      temporaryDirectory,
    )
    const pythonEvidence = evidenceFromVerifierResult(verifierResult)
    const browserEvidence = await evidenceFromRawEmail(rawEmail, {
      resolver: systemTxtResolver,
      observedAt: verifierResult.observed_at_unix,
    })
    assert.deepEqual(browserEvidence, pythonEvidence, `${item.label} evidence adapters drifted`)

    const result = evaluateCompatibility(browserEvidence, {
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
      evidence_adapters_equal: true,
      verdict: result.verdict,
      reason_codes: result.reason_codes,
      warning_codes: result.warning_codes,
    })
  }

  process.stdout.write(`${JSON.stringify({
    schema_version: 2,
    evidence_source: "regenerated-not-cached",
    case_count: observations.length,
    observations,
  }, null, 2)}\n`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
