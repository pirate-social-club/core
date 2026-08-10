import assert from "node:assert/strict"
import test from "node:test"

import {
  createDohTxtResolver,
  evidenceFromRawEmail,
  parseDkimHeaderFacts,
} from "./browser-evidence-adapter.mjs"

const SYNTHETIC_HEADER = [
  "From: employee@company.example",
  "Subject: Account verification code: synthetic",
  "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;",
  " d=company.example; s=test; t=1000; x=4600;",
  " h=From:Subject:Date; bh=synthetic; b=synthetic",
  "",
  "body",
].join("\r\n")

test("extracts policy facts without exposing message content", () => {
  const facts = parseDkimHeaderFacts(SYNTHETIC_HEADER, 5000)
  assert.equal(facts.length, 1)
  assert.equal(facts[0].signing_domain, "company.example")
  assert.equal(facts[0].algorithm, "rsa-sha256")
  assert.equal(facts[0].header_canonicalization, "relaxed")
  assert.deepEqual(facts[0].signed_headers, ["from", "subject", "date"])
  assert.equal(facts[0].signature_expiration_status, "expired")
  assert.equal(JSON.stringify(facts).includes("verification code"), false)
})

test("requires resolver injection even though no-signature mail needs no lookup", async () => {
  await assert.rejects(
    evidenceFromRawEmail(SYNTHETIC_HEADER),
    /explicit DKIM TXT resolver/,
  )
  assert.deepEqual(
    await evidenceFromRawEmail("From: employee@company.example\r\n\r\nbody", {
      resolver: async () => [],
    }),
    { signatures: [] },
  )
})

test("builds one explicit HTTPS DoH query and returns TXT values", async () => {
  const requests = []
  const resolver = createDohTxtResolver("https://resolver.example/dns-query", {
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), accept: init.headers.accept })
      return {
        ok: true,
        async json() {
          return {
            Status: 0,
            Answer: [{ type: 16, data: "\"v=DKIM1; p=synthetic\"" }],
          }
        },
      }
    },
  })
  assert.deepEqual(await resolver("test._domainkey.company.example", "TXT"), [
    "v=DKIM1; p=synthetic",
  ])
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /^https:\/\/resolver\.example\/dns-query\?/)
  assert.equal(requests[0].accept, "application/dns-json")
})

test("rejects unsafe endpoints and non-TXT queries", async () => {
  assert.throws(() => createDohTxtResolver("http://resolver.example"), /clean HTTPS/)
  assert.throws(() => createDohTxtResolver("https://resolver.example/?token=value"), /clean HTTPS/)
  const resolver = createDohTxtResolver("https://resolver.example/dns-query", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ Status: 0, Answer: [] }) }),
  })
  await assert.rejects(resolver("company.example", "A"), /only TXT/)
})
