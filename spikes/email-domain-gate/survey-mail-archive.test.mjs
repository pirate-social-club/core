import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { exclusionReason, readMboxHeaders, surveyArchive } from "./survey-mail-archive.mjs"

function message(domain, marker, extra = []) {
  return Buffer.from([
    `From: employee@${domain}`,
    `Date: Tue, 04 Aug 2026 12:00:00 +0000`,
    `Subject: ${marker}`,
    ...extra,
    "",
    "",
  ].join("\r\n"))
}

function fakeEvidence(rawHeader) {
  const raw = rawHeader.toString("latin1")
  const fromDomain = raw.match(/From: [^@]+@([^\r\n]+)/i)?.[1] ?? null
  const fallback = raw.includes("fallback")
  const noSignature = raw.includes("no-signature")
  return Promise.resolve({
    signatures: noSignature ? [] : [{
      index: 0,
      header_signature_verified: true,
      body_hash_verified: null,
      signing_domain: fallback ? "alpha-example.20260101.gappssmtp.com" : fromDomain,
      from_domain: fromDomain,
      signed_headers: ["from", "subject"],
      algorithm: "rsa-sha256",
      header_canonicalization: "relaxed",
      signature_expiration_status: "not-declared",
    }],
  })
}

test("filters bulk, automated, sent, and old messages before verification", () => {
  const since = Date.parse("2026-01-01T00:00:00Z") / 1000
  assert.equal(exclusionReason(message("alpha.example", "bulk", ["List-Unsubscribe: <x>"]), since), "list_or_bulk")
  assert.equal(exclusionReason(message("alpha.example", "auto", ["Auto-Submitted: auto-generated"]), since), "automated")
  assert.equal(exclusionReason(message("alpha.example", "sent", ["X-Gmail-Labels: Sent"]), since), "non_inbox_folder")
  assert.equal(
    exclusionReason(Buffer.from("From: employee@alpha.example\r\nDate: Tue, 04 Aug 2020 12:00:00 +0000\r\n\r\n"), since),
    "older_than_window",
  )
})

test("emits aggregate domain verdicts without identifiers", async () => {
  const messages = [
    message("alpha.example", "compatible-one"),
    message("alpha.example", "compatible-two"),
    message("beta.example", "fallback"),
    message("gamma.example", "no-signature"),
    message("bulk.example", "bulk", ["Precedence: bulk"]),
  ]
  const result = await surveyArchive(messages, {
    observedAt: Date.parse("2026-08-10T00:00:00Z") / 1000,
    sinceUnix: Date.parse("2026-01-01T00:00:00Z") / 1000,
    resolver: async () => [],
    evidenceAdapter: fakeEvidence,
  })
  assert.equal(result.messages_scanned, 5)
  assert.equal(result.human_candidate_messages, 4)
  assert.equal(result.unique_sender_domains, 3)
  assert.equal(result.domain_categories.aligned_compatible, 1)
  assert.equal(result.domain_categories.workspace_provider_fallback, 1)
  assert.equal(result.domain_categories.no_dkim_signature, 1)
  assert.equal(result.observed_compatible_rate_all_domains, 0.3333)
  assert.equal(result.observed_compatible_rate_definitive_domains, 0.3333)
  assert.equal(result.excluded_messages.list_or_bulk, 1)
  const serialized = JSON.stringify(result)
  for (const identifier of ["alpha.example", "beta.example", "gamma.example", "employee@"]) {
    assert.equal(serialized.includes(identifier), false)
  }
})

test("streams mbox headers without retaining bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mail-archive-survey-test-"))
  try {
    const path = join(directory, "archive.mbox")
    await writeFile(path, [
      "From envelope-one@example.invalid Tue Aug 04 12:00:00 2026\n",
      "From: employee@alpha.example\nSubject: one\n\nsecret body one\n",
      "From envelope-two@example.invalid Tue Aug 04 12:01:00 2026\n",
      "From: employee@beta.example\nSubject: two\n\nsecret body two\n",
    ].join(""))
    const headers = []
    for await (const header of readMboxHeaders(path)) headers.push(header.toString("latin1"))
    assert.equal(headers.length, 2)
    assert.match(headers[0], /alpha\.example/)
    assert.match(headers[1], /beta\.example/)
    assert.equal(headers.some((header) => header.includes("secret body")), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
