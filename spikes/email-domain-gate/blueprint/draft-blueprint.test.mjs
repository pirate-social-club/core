import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { Blueprint } from "@zk-email/sdk"

const draft = JSON.parse(
  await readFile(new URL("./draft-blueprint.json", import.meta.url), "utf8"),
)

function combinedRegex(field) {
  return new RegExp(field.parts.map((part) => part.regexDef).join(""), "gm")
}

test("matches the released SDK blueprint schema", () => {
  const parsed = Blueprint.formSchema.safeParse(draft)
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues))
})

test("exposes only the intended three fields and never To", () => {
  assert.deepEqual(
    draft.decomposedRegexes.map((field) => field.name),
    ["fromMailboxDigest", "fromDomain", "sessionNonce"],
  )
  assert.equal(draft.decomposedRegexes[0].isHashed, true)
  assert.equal(JSON.stringify(draft).toLowerCase().includes('"name":"to'), false)
})

test("draft regexes match a canonicalized work-to-personal header", () => {
  const header = [
    "from:Employee <employee@example.test>",
    "to:personal@example.net",
    "subject:pirate-verify:synthetic_nonce-1",
    "",
  ].join("\r\n")

  for (const field of draft.decomposedRegexes) {
    assert.equal([...header.matchAll(combinedRegex(field))].length, 1, field.name)
  }
})

test("duplicate From is a confirmed cardinality gap, not a passing claim", () => {
  const header = [
    "from:attacker@evil.test",
    "from:employee@example.test",
    "subject:pirate-verify:synthetic_nonce-1",
    "",
  ].join("\r\n")
  const fromField = draft.decomposedRegexes[0]

  assert.equal([...header.matchAll(combinedRegex(fromField))].length, 2)
})
