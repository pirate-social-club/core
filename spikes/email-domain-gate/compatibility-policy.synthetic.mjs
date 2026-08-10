#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
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

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--python" || !argv[1]) {
    throw new Error("usage: compatibility-policy.synthetic.mjs --python <venv-python>")
  }
  return { python: argv[1] }
}

const { python } = parseArguments(process.argv.slice(2))
const temporaryDirectory = await mkdtemp(join(tmpdir(), "email-domain-synthetic-"))
await chmod(temporaryDirectory, 0o700)

try {
  const emailPath = join(temporaryDirectory, "synthetic.eml")
  const evidencePath = join(temporaryDirectory, "synthetic.crypto.json")
  const dnsPath = join(temporaryDirectory, "synthetic.dns.json")
  try {
    await execFileAsync(python, [
      join(spikeDirectory, "synthetic-adapter-evidence.py"),
      "--email-out", emailPath,
      "--evidence-out", evidencePath,
      "--dns-out", dnsPath,
    ], { maxBuffer: 1024 * 1024 })
  } catch {
    throw new Error("synthetic Python evidence generation failed")
  }

  const rawEmail = await readFile(emailPath)
  const verifierResult = JSON.parse(await readFile(evidencePath, "utf8"))
  const { record } = JSON.parse(await readFile(dnsPath, "utf8"))
  const pythonEvidence = evidenceFromVerifierResult(verifierResult)
  const browserEvidence = await evidenceFromRawEmail(rawEmail, {
    observedAt: verifierResult.observed_at_unix,
    resolver: async (_name, type) => {
      if (type !== "TXT") throw new Error("only TXT lookups are supported")
      return [record]
    },
  })
  assert.deepEqual(browserEvidence, pythonEvidence, "synthetic evidence adapters drifted")

  const result = evaluateCompatibility(browserEvidence, {
    context: "advisory-preflight",
    confidence: "same-mailbox-external-path",
  })
  assert.equal(result.verdict, "compatible")
  assert.ok(result.warning_codes.includes("signer_expiration_ignored"))

  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    fixture: "generated-synthetic-expired-signature",
    evidence_adapters_equal: true,
    verdict: result.verdict,
    reason_codes: result.reason_codes,
    warning_codes: result.warning_codes,
  }, null, 2)}\n`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
