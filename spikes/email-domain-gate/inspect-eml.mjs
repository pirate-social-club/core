#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { pathToFileURL } from "node:url"

const REQUIRED_SIGNED_HEADERS = ["from", "to", "subject"]

function unfoldHeaderLines(rawHeader) {
  return rawHeader.replace(/\r?\n[\t ]+/g, " ").split(/\r?\n/)
}

export function parseHeaders(rawEmail) {
  const boundary = rawEmail.search(/\r?\n\r?\n/)
  const rawHeader = boundary === -1 ? rawEmail : rawEmail.slice(0, boundary)
  const headers = new Map()

  for (const line of unfoldHeaderLines(rawHeader)) {
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    const values = headers.get(name) ?? []
    values.push(value)
    headers.set(name, values)
  }

  return headers
}

function parseTagList(value) {
  const tags = new Map()
  for (const item of value.split(";")) {
    const separator = item.indexOf("=")
    if (separator <= 0) continue
    tags.set(item.slice(0, separator).trim().toLowerCase(), item.slice(separator + 1).trim())
  }
  return tags
}

function canonicalDomain(value) {
  if (!value) return null
  const candidate = value.trim().replace(/\.$/, "").toLowerCase()
  try {
    const hostname = new URL(`http://${candidate}`).hostname.replace(/\.$/, "").toLowerCase()
    return hostname || null
  } catch {
    return null
  }
}

function parseSingleMailbox(value) {
  if (!value || value.includes(",")) return null
  const angleMatch = value.match(/<([^<>]+)>/)
  const candidate = (angleMatch?.[1] ?? value).trim()
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(candidate)) return null
  const separator = candidate.lastIndexOf("@")
  const localPart = candidate.slice(0, separator)
  const domain = canonicalDomain(candidate.slice(separator + 1))
  return domain ? { localPart, domain } : null
}

function sameMailbox(left, right) {
  return left !== null
    && right !== null
    && left.localPart === right.localPart
    && left.domain === right.domain
}

export function inspectEmail(rawEmail, label) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(label)) {
    throw new Error("label must be a non-identifying slug of 1-64 characters")
  }

  const headers = parseHeaders(rawEmail)
  const fromValues = headers.get("from") ?? []
  const toValues = headers.get("to") ?? []
  const from = fromValues.length === 1 ? parseSingleMailbox(fromValues[0]) : null
  const to = toValues.length === 1 ? parseSingleMailbox(toValues[0]) : null
  const signatures = (headers.get("dkim-signature") ?? []).map((value, index) => {
    const tags = parseTagList(value)
    const signedHeaders = (tags.get("h") ?? "")
      .split(":")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    const signingDomain = canonicalDomain(tags.get("d"))

    return {
      index,
      signing_domain: signingDomain,
      selector: tags.get("s") || null,
      algorithm: tags.get("a") || null,
      canonicalization: tags.get("c") || "simple/simple",
      signed_headers: signedHeaders,
      required_headers_signed: Object.fromEntries(
        REQUIRED_SIGNED_HEADERS.map((name) => [name, signedHeaders.includes(name)]),
      ),
      strict_from_alignment: signingDomain !== null && from !== null && signingDomain === from.domain,
      structurally_complete: Boolean(tags.get("b") && tags.get("bh") && tags.get("d") && tags.get("s")),
    }
  })

  return {
    schema_version: 1,
    label,
    dkim_signature_count: signatures.length,
    has_structurally_complete_dkim: signatures.some((signature) => signature.structurally_complete),
    exactly_one_from_mailbox: fromValues.length === 1 && from !== null,
    exactly_one_to_mailbox: toValues.length === 1 && to !== null,
    to_equals_from: sameMailbox(to, from),
    signatures,
    note: "Structural inspection only; cryptographic DKIM verification is not yet implemented.",
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("usage: inspect-eml.mjs --label <slug> --file <path> [--out <path>]")
    }
    values.set(key.slice(2), value)
  }
  if (!values.get("label") || !values.get("file")) {
    throw new Error("usage: inspect-eml.mjs --label <slug> --file <path> [--out <path>]")
  }
  return values
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const rawEmail = await readFile(args.get("file"), "utf8")
  const output = `${JSON.stringify(inspectEmail(rawEmail, args.get("label")), null, 2)}\n`
  if (args.get("out")) {
    await mkdir(dirname(args.get("out")), { recursive: true })
    await writeFile(args.get("out"), output, { encoding: "utf8", mode: 0o600 })
  } else {
    process.stdout.write(output)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
