import assert from "node:assert/strict"
import test from "node:test"

import { surveyDkimDns } from "./survey-dkim-dns.mjs"

function missing() {
  const error = new Error("not found")
  error.code = "ENOTFOUND"
  throw error
}

test("reports known selector fingerprints without emitting domains", async () => {
  const txt = new Map([
    ["google._domainkey.alpha.example", [["v=DKIM1; k=rsa; p=synthetic"]]],
    ["_dmarc.alpha.example", [["v=DMARC1; p=reject"]]],
  ])
  const cname = new Map([
    ["selector1._domainkey.beta.example", ["synthetic.invalid"]],
  ])
  const result = await surveyDkimDns([
    { label: "target-001", domain: "alpha.example" },
    { label: "target-002", domain: "beta.example" },
  ], {
    observedAt: "2026-08-10T00:00:00.000Z",
    resolveTxt: async (name) => txt.get(name) ?? missing(),
    resolveCname: async (name) => cname.get(name) ?? missing(),
  })

  assert.equal(result.targets[0].workspace_default_selector, "present")
  assert.equal(result.targets[0].dmarc, "present")
  assert.equal(result.targets[1].m365_any_selector, "present")
  assert.equal(result.aggregate.workspace_default_selector.present, 1)
  assert.equal(result.aggregate.m365_any_selector.present, 1)
  assert.equal(JSON.stringify(result).includes("alpha.example"), false)
  assert.equal(JSON.stringify(result).includes("beta.example"), false)
})

test("distinguishes negative answers from resolver errors", async () => {
  const result = await surveyDkimDns([
    { label: "target-001", domain: "alpha.example" },
  ], {
    resolveTxt: async () => missing(),
    resolveCname: async () => {
      const error = new Error("temporary failure")
      error.code = "EAI_AGAIN"
      throw error
    },
  })

  assert.equal(result.targets[0].workspace_default_selector, "query-error")
  assert.equal(result.targets[0].m365_any_selector, "query-error")
  assert.equal(result.targets[0].dmarc, "absent")
})

test("rejects duplicate or malformed labels", async () => {
  await assert.rejects(
    surveyDkimDns([
      { label: "target-001", domain: "alpha.example" },
      { label: "target-001", domain: "beta.example" },
    ]),
    /unique/,
  )
  await assert.rejects(
    surveyDkimDns([{ label: "Target 1", domain: "alpha.example" }]),
    /non-identifying label/,
  )
  await assert.rejects(
    surveyDkimDns([{ label: "target-001", domain: "invalid_label.example" }]),
    /domain is invalid/,
  )
})
