import assert from "node:assert/strict"
import test from "node:test"

import { inspectEmail } from "./inspect-eml.mjs"

const completeSignature = [
  "v=1",
  "a=rsa-sha256",
  "c=relaxed/relaxed",
  "d=example.com",
  "s=selector1",
  "t=1000",
  "x=4600",
  "h=From:To:Subject:Date:From",
  "bh=synthetic-body-hash",
  "b=synthetic-signature",
].join("; ")

test("reports an aligned work-to-personal structurally complete signature", () => {
  const result = inspectEmail([
    "From: Test User <case-sensitive@example.com>",
    "To: personal@example.net",
    "Subject: pirate-verify:synthetic",
    `DKIM-Signature: ${completeSignature}`,
    "",
    "",
  ].join("\r\n"), "synthetic-work-personal")

  assert.equal(result.has_structurally_complete_dkim, true)
  assert.equal(result.to_equals_from, false)
  assert.equal(result.signatures[0].strict_from_alignment, true)
  assert.equal(result.signatures[0].canonicalization, "relaxed/relaxed")
  assert.equal(result.signatures[0].header_canonicalization, "relaxed")
  assert.equal(result.signatures[0].body_canonicalization, "relaxed")
  assert.equal(result.signatures[0].draft_regex_header_assumption_met, true)
  assert.equal(result.signatures[0].signature_timestamp, 1000)
  assert.equal(result.signatures[0].signature_expiration, 4600)
  assert.equal(result.signatures[0].signature_validity_seconds, 3600)
  assert.deepEqual(result.signatures[0].required_headers_signed, {
    from: true,
    subject: true,
  })
  assert.equal(result.signatures[0].from_oversigned, true)
  assert.equal(JSON.stringify(result).includes("case-sensitive"), false)
})

test("reports the internal-delivery gap without exposing message content", () => {
  const result = inspectEmail([
    "From: private@example.com",
    "To: private@example.com",
    "Subject: private subject",
    "",
    "private body",
  ].join("\n"), "synthetic-no-dkim")

  assert.equal(result.dkim_signature_count, 0)
  assert.equal(result.has_structurally_complete_dkim, false)
  assert.equal(JSON.stringify(result).includes("private"), false)
})

test("requires byte-exact local parts for self-send equality", () => {
  const result = inspectEmail([
    "From: WORKSPACE_OWNER@example.com",
    "To: workspace_owner@example.com",
    "Subject: pirate-verify:synthetic",
    `DKIM-Signature: ${completeSignature}`,
    "",
    "",
  ].join("\r\n"), "synthetic-case")

  assert.equal(result.to_equals_from, false)
})

test("records simple canonicalization as outside the draft regex assumption", () => {
  const signature = completeSignature.replace("c=relaxed/relaxed; ", "")
  const result = inspectEmail([
    "From: employee@example.com",
    "To: personal@example.net",
    "Subject: pirate-verify:synthetic",
    `DKIM-Signature: ${signature}`,
    "",
    "",
  ].join("\r\n"), "synthetic-simple-canonicalization")

  assert.equal(result.signatures[0].canonicalization, "simple/simple")
  assert.equal(result.signatures[0].header_canonicalization, "simple")
  assert.equal(result.signatures[0].body_canonicalization, "simple")
  assert.equal(result.signatures[0].draft_regex_header_assumption_met, false)
})
