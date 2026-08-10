import { DkimVerifier } from "@zk-email/helpers/dist/lib/mailauth/dkim-verifier.js"
import { Buffer } from "buffer"

globalThis.Buffer ??= Buffer

function rawEmailText(rawEmail) {
  if (typeof rawEmail === "string") return rawEmail
  if (rawEmail instanceof Uint8Array) return new TextDecoder("latin1").decode(rawEmail)
  throw new Error("raw email must be a string or Uint8Array")
}

function headerRows(rawEmail) {
  const header = rawEmailText(rawEmail).split(/\r?\n\r?\n/, 1)[0]
  const rows = []
  for (const line of header.split(/\r?\n/)) {
    if (/^[\t ]/.test(line) && rows.length > 0) {
      rows[rows.length - 1] += `\r\n${line}`
    } else {
      rows.push(line)
    }
  }
  return rows
}

function tagMap(value) {
  return new Map(value.split(";").flatMap((part) => {
    const separator = part.indexOf("=")
    if (separator <= 0) return []
    return [[
      part.slice(0, separator).trim().toLowerCase(),
      part.slice(separator + 1).trim().replace(/\r?\n[\t ]*/g, ""),
    ]]
  }))
}

function unixTag(value) {
  if (!/^\d+$/.test(value ?? "")) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function expirationStatus(tags, observedAt) {
  if (!tags.has("x")) return "not-declared"
  const expiration = unixTag(tags.get("x"))
  if (expiration === null) return "invalid"
  return expiration < observedAt ? "expired" : "unexpired"
}

export function parseDkimHeaderFacts(rawEmail, observedAt = Math.floor(Date.now() / 1000)) {
  return headerRows(rawEmail).flatMap((row, index) => {
    const separator = row.indexOf(":")
    if (separator <= 0 || row.slice(0, separator).trim().toLowerCase() !== "dkim-signature") {
      return []
    }
    const tags = tagMap(row.slice(separator + 1))
    const [headerCanonicalization = "simple"] = (tags.get("c") ?? "simple/simple")
      .toLowerCase()
      .split("/", 2)
    return [{
      source_index: index,
      signing_domain: tags.get("d") ?? null,
      selector: tags.get("s") ?? null,
      signed_headers: (tags.get("h") ?? "")
        .split(":")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      algorithm: tags.get("a")?.toLowerCase() ?? null,
      header_canonicalization: headerCanonicalization,
      signature_expiration_status: expirationStatus(tags, observedAt),
    }]
  }).map((fact, index) => ({ ...fact, index }))
}

function fromDomain(verifier) {
  if (!Array.isArray(verifier.headerFrom) || verifier.headerFrom.length !== 1) return null
  const mailbox = verifier.headerFrom[0]
  const separator = mailbox.lastIndexOf("@")
  return separator > 0 ? mailbox.slice(separator + 1) : null
}

function cachedResolver(resolver) {
  const cache = new Map()
  return (name, type) => {
    const key = `${type}:${name}`
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => resolver(name, type)))
    return cache.get(key)
  }
}

async function runVerifier(rawEmail, resolver, skipBodyHash, onStage = () => {}) {
  onStage(skipBodyHash ? "header-verifier-created" : "full-verifier-created")
  const verifier = new DkimVerifier({ resolver, skipBodyHash })
  const input = Buffer.isBuffer(rawEmail) ? rawEmail : Buffer.from(rawEmail)
  onStage(skipBodyHash ? "header-parser-started" : "full-parser-started")
  await verifier.writeAsync(input)
  await verifier.finish()
  onStage(skipBodyHash ? "header-parser-finished" : "full-parser-finished")
  return verifier
}

function bodyHashVerified(result) {
  if (result?.status?.result === "pass") return true
  const comment = String(result?.status?.comment ?? "").toLowerCase()
  if (comment.includes("body hash") || comment.includes("invalid body length")) return false
  return null
}

export async function evidenceFromRawEmail(rawEmail, options = {}) {
  if (typeof options.resolver !== "function") {
    throw new Error("an explicit DKIM TXT resolver is required")
  }
  const observedAt = options.observedAt ?? Math.floor(Date.now() / 1000)
  const facts = parseDkimHeaderFacts(rawEmail, observedAt)
  if (facts.length === 0) return { signatures: [] }

  const resolver = cachedResolver(options.resolver)
  const onStage = typeof options.onStage === "function" ? options.onStage : () => {}
  const [headerVerifier, fullVerifier] = await Promise.all([
    runVerifier(rawEmail, resolver, true, onStage),
    runVerifier(rawEmail, resolver, false, onStage),
  ])
  if (
    headerVerifier.results.length !== facts.length
    || fullVerifier.results.length !== facts.length
  ) {
    throw new Error("DKIM evidence count mismatch")
  }
  const parsedFromDomain = fromDomain(headerVerifier)

  return {
    signatures: facts.map((fact, index) => ({
      index,
      header_signature_verified: headerVerifier.results[index]?.status?.result === "pass",
      body_hash_verified: bodyHashVerified(fullVerifier.results[index]),
      signing_domain: fact.signing_domain,
      from_domain: parsedFromDomain,
      signed_headers: fact.signed_headers,
      algorithm: fact.algorithm,
      header_canonicalization: fact.header_canonicalization,
      signature_expiration_status: fact.signature_expiration_status,
    })),
  }
}

export function createDohTxtResolver(endpoint, options = {}) {
  const endpointUrl = new URL(endpoint)
  if (
    endpointUrl.protocol !== "https:"
    || endpointUrl.username
    || endpointUrl.password
    || endpointUrl.search
    || endpointUrl.hash
  ) {
    throw new Error("DoH endpoint must be a clean HTTPS URL")
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable")

  return async (name, type) => {
    if (type !== "TXT") throw new Error("only TXT lookups are supported")
    const query = new URL(endpointUrl)
    query.searchParams.set("name", name)
    query.searchParams.set("type", "16")
    const response = await fetchImpl(query, {
      headers: { accept: "application/dns-json" },
    })
    if (!response.ok) throw new Error("DoH lookup failed")
    const payload = await response.json()
    const answers = payload?.Status === 0 && Array.isArray(payload.Answer)
      ? payload.Answer
      : []
    const records = answers
      .filter((answer) => answer?.type === 16 && typeof answer.data === "string")
      .map((answer) => answer.data.replace(/"/g, ""))
    if (records.length === 0) {
      const error = new Error("DKIM TXT record not found")
      error.code = "ENODATA"
      throw error
    }
    return records
  }
}
