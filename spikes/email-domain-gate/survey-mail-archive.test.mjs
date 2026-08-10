import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  bulkExclusionReason,
  readEmlDirectoryHeaders,
  readMboxHeaders,
  surveyArchive,
} from "./survey-mail-archive.mjs"

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
    { rawHeader: message("alpha.example"), sourceRepliedTo: true },
    message("alpha.example"),
    message("beta.example", "beta-example.20260101.gappssmtp.com"),
    message("parent.example", "mailer.parent.example"),
    message("staff.parent.example", "parent.example"),
    message("unrelated.example", "sender.other.example"),
    spoofed,
    message("bulk.example", "bulk.example", ["Precedence: bulk"]),
  ]
  const result = await surveyArchive(messages, {
    observedAt: Date.parse("2026-08-10T00:00:00Z") / 1000,
    sinceUnix: Date.parse("2026-01-01T00:00:00Z") / 1000,
    authservId: "mx.google.com",
  })
  assert.equal(result.network_requests, 0)
  assert.equal(result.populations.all_received.unique_sender_domains, 7)
  assert.equal(result.populations.all_received.domain_categories.aligned_compatible, 2)
  assert.equal(result.populations.all_received.domain_categories.signer_subdomain_of_from, 1)
  assert.equal(result.populations.all_received.domain_categories.from_subdomain_of_signer, 1)
  assert.equal(result.populations.all_received.domain_categories.unrelated_signing_domain, 1)
  assert.equal(result.populations.all_received.aligned_rate_all_domains, 0.2857)
  assert.equal(result.populations.all_received.aligned_rate_among_dkim_pass_domains, 0.3333)
  assert.equal(result.populations.header_filtered_candidate.unique_sender_domains, 6)
  assert.equal(result.populations.header_filtered_candidate.domain_categories.aligned_compatible, 1)
  assert.equal(result.populations.header_filtered_candidate.domain_categories.workspace_provider_fallback, 1)
  assert.equal(result.populations.header_filtered_candidate.domain_categories.no_trusted_authentication_results, 1)
  assert.equal(result.populations.header_filtered_candidate.aligned_rate_all_domains, 0.1667)
  assert.equal(result.populations.header_filtered_candidate.aligned_rate_among_dkim_pass_domains, 0.2)
  assert.equal(result.populations.replied_to_candidate.unique_sender_domains, 1)
  assert.equal(result.populations.replied_to_candidate.domain_categories.aligned_compatible, 1)
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
  assert.equal(result.populations.header_filtered_candidate.domain_categories.dkim_not_passed, 1)
  assert.equal(result.populations.header_filtered_candidate.domain_categories.aligned_compatible, 0)
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

test("streams nested EML headers without retaining bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mail-directory-survey-test-"))
  try {
    const nested = join(directory, "nested")
    await mkdir(nested)
    await writeFile(join(directory, "labels.json"), JSON.stringify({
      Version: 1,
      Payload: [{ ID: "sent-id", Name: "Sent" }],
    }))
    await writeFile(join(directory, "one.eml"), "From: employee@alpha.example\r\nSubject: one\r\n\r\nsecret body one")
    await writeFile(join(directory, "one.metadata.json"), JSON.stringify({ Payload: { LabelIDs: [] } }))
    await writeFile(join(nested, "two.EML"), "From: employee@beta.example\nSubject: two\n\nsecret body two")
    await writeFile(join(nested, "two.metadata.json"), JSON.stringify({
      Payload: { LabelIDs: ["sent-id"] },
    }))
    const headers = []
    const folderFlags = []
    for await (const message of readEmlDirectoryHeaders(directory)) {
      headers.push(message.rawHeader.toString("latin1"))
      folderFlags.push(message.sourceFolderExcluded)
    }
    assert.equal(headers.length, 2)
    assert.equal(headers.some((header) => header.includes("secret body")), false)
    assert.deepEqual(folderFlags.sort(), [false, true])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
