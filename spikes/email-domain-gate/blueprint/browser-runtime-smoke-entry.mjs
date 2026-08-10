import { evaluateCompatibility } from "../compatibility-policy.mjs"
import { evidenceFromRawEmail } from "./browser-evidence-adapter.mjs"

const fixture = globalThis.__EMAIL_DOMAIN_SMOKE_FIXTURE__
const rawEmail = Uint8Array.from(atob(fixture.email_base64), (character) => character.charCodeAt(0))
document.body.textContent = "started"
let unexpectedFetchCount = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  unexpectedFetchCount += 1
  throw new Error("unexpected network request")
}

try {
  const evidence = await evidenceFromRawEmail(rawEmail, {
    observedAt: fixture.observed_at_unix,
    onStage: (stage) => {
      document.body.textContent = stage
    },
    resolver: async (_name, type) => {
      if (type !== "TXT") throw new Error("only TXT lookups are supported")
      return [fixture.dns_record]
    },
  })
  const result = evaluateCompatibility(evidence, {
    context: "advisory-preflight",
    confidence: "same-mailbox-external-path",
  })
  const passed = result.verdict === "compatible"
    && result.warning_codes.includes("signer_expiration_ignored")
    && unexpectedFetchCount === 0
  document.body.textContent = JSON.stringify({
    status: passed ? "pass" : "fail",
    verdict: result.verdict,
    warning_codes: result.warning_codes,
    unexpected_fetch_count: unexpectedFetchCount,
  })
  document.documentElement.dataset.smoke = passed ? "pass" : "fail"
} catch (error) {
  document.body.textContent = JSON.stringify({
    status: "fail",
    reason: "browser-runtime-exception",
    diagnostic: error instanceof Error ? error.message : "unknown",
    unexpected_fetch_count: unexpectedFetchCount,
  })
  document.documentElement.dataset.smoke = "fail"
} finally {
  globalThis.fetch = originalFetch
}
