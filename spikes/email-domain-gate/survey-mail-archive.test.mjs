import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { bulkExclusionReason, readMboxHeaders, surveyArchive } from "./survey-mail-archive.mjs"

function message(domain, dkimIdentity = domain, extra = []) {
  const authentication = dkimIdentity === null
    ? []
    : [`Authentication-Results: mx.google.com; dkim=pass header.i=@${dkimIdentity} header.s=test`]
  return Buffer.from([
    `From: employee@${domain}`,
    "Date: Tue, 04 Aug 2026 12:00:00 +0000",
    "Subject: synthetic",
    ...authentication,
    ...extra,
    "",
    "",
  ].join("\r\n"))
}

test("identifies bulk and automated messages", () => {
  assert.equal(bulkExclusionReason(message("alpha.example", "alpha.example", ["List-Unsubscribe: <x>"])), "list_or_bulk")
  assert.equal(bulkExclusionReason(message("alpha.example", "alpha.example", ["Auto-Submitted: auto-generated"])), "automated")
  assert.equal(bulkExclusionReason(message("alpha.example")), null)
})

test("trusts only the configured receiver and compares filtered populations", async () => {
  const spoofed = Buffer.from([
    "From: employee@gamma.example",
    "Date: Tue, 04 Aug 2026 12:00:00 +0000",
    "Subject: synthetic",
    "Authentication-Results: attacker.example; dkim=pass header.i=@gamma.example",
    "",
    "",
  ].join("\r\n"))
  const messages = [
    message("alpha.example"),
    message("alpha.example"),
    message("beta.example", "beta-example.20260101.gappssmtp.com"),
    spoofed,
    message("bulk.example", "bulk.example", ["Precedence: bulk"]),
  ]
  const result = await surveyArchive(messages, {
    observedAt: Date.parse("2026-08-10T00:00:00Z") / 1000,
    sinceUnix: Date.parse("2026-01-01T00:00:00Z") / 1000,
    authservId: "mx.google.com",
  })
  assert.equal(result.network_requests, 0)
  assert.equal(result.populations.all_received.unique_sender_domains, 4)
  assert.equal(result.populations.all_received.domain_categories.aligned_compatible, 2)
  assert.equal(result.populations.all_received.aligned_rate_all_domains, 0.5)
  assert.equal(result.populations.all_received.aligned_rate_among_dkim_pass_domains, 0.6667)
  assert.equal(result.populations.human_candidate.unique_sender_domains, 3)
  assert.equal(result.populations.human_candidate.domain_categories.aligned_compatible, 1)
  assert.equal(result.populations.human_candidate.domain_categories.workspace_provider_fallback, 1)
  assert.equal(result.populations.human_candidate.domain_categories.no_trusted_authentication_results, 1)
  assert.equal(result.populations.human_candidate.aligned_rate_all_domains, 0.3333)
  assert.equal(result.populations.human_candidate.aligned_rate_among_dkim_pass_domains, 0.5)
  assert.equal(result.excluded_messages.list_or_bulk, 1)
  const serialized = JSON.stringify(result)
  for (const identifier of ["alpha.example", "beta.example", "gamma.example", "employee@"]) {
    assert.equal(serialized.includes(identifier), false)
  }
})

test("uses only the first matching trusted receiver result", async () => {
  const raw = Buffer.from([
    "From: employee@alpha.example",
    "Date: Tue, 04 Aug 2026 12:00:00 +0000",
    "Subject: synthetic",
    "Authentication-Results: mx.google.com; dkim=fail header.i=@alpha.example",
    "Authentication-Results: mx.google.com; dkim=pass header.i=@alpha.example",
    "",
    "",
  ].join("\r\n"))
  const result = await surveyArchive([raw], {
    observedAt: Date.parse("2026-08-10T00:00:00Z") / 1000,
    sinceUnix: Date.parse("2026-01-01T00:00:00Z") / 1000,
    authservId: "mx.google.com",
  })
  assert.equal(result.populations.human_candidate.domain_categories.dkim_not_passed, 1)
  assert.equal(result.populations.human_candidate.domain_categories.aligned_compatible, 0)
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
