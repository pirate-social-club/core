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

test("uses alternating visibility and a bounded measured header length", () => {
  assert.equal(draft.emailHeaderMaxLength, 1024)
  for (const field of draft.decomposedRegexes) {
    for (let index = 1; index < field.parts.length; index += 1) {
      assert.notEqual(field.parts[index - 1].isPublic, field.parts[index].isPublic)
    }
  }
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

test("first match follows the order of the authenticated selected sequence", () => {
  const header = [
    "from:employee@example.test",
    "from:forged@evil.test",
    "subject:pirate-verify:synthetic_nonce-1",
    "",
  ].join("\r\n")
  const fromField = draft.decomposedRegexes[0]
  const matches = [...header.matchAll(combinedRegex(fromField))]

  assert.equal(matches.length, 2)
  assert.equal(matches[0][0].includes("employee@example.test"), true)
})
