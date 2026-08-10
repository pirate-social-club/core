#!/usr/bin/env node

import { createReadStream } from "node:fs"
import { chmod, writeFile } from "node:fs/promises"
import { resolveTxt } from "node:dns/promises"
import { domainToASCII, pathToFileURL } from "node:url"

import { evidenceFromRawEmail } from "./blueprint/browser-evidence-adapter.mjs"
import { evaluateCompatibility } from "./compatibility-policy.mjs"

const CATEGORY_PRIORITY = new Map([
  ["verification_error", 0],
  ["no_verified_header_signature", 1],
  ["no_dkim_signature", 2],
  ["unaligned_other", 3],
  ["required_header_missing", 4],
  ["unsupported_algorithm", 5],
  ["unsupported_canonicalization", 6],
  ["workspace_provider_fallback", 7],
  ["aligned_compatible", 8],
])

function headerMap(rawHeader) {
  const values = new Map()
  const lines = rawHeader.toString("latin1").split(/\r?\n/)
  let current = null
  for (const line of lines) {
    if (/^[\t ]/.test(line) && current !== null) {
      const existing = values.get(current)
      existing[existing.length - 1] += ` ${line.trim()}`
      continue
    }
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    current = line.slice(0, separator).trim().toLowerCase()
    const list = values.get(current) ?? []
    list.push(line.slice(separator + 1).trim())
    values.set(current, list)
  }
  return values
}

function firstHeader(headers, name) {
  return headers.get(name)?.[0] ?? null
}

function domainFromHeader(rawHeader) {
  const fromValues = headerMap(rawHeader).get("from") ?? []
  if (fromValues.length !== 1) return null
  const matches = [...fromValues[0].matchAll(
    /[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+@([A-Za-z0-9.-]+)/g,
  )]
  if (matches.length !== 1) return null
  const domain = domainToASCII(matches[0][1].replace(/\.$/, "")).toLowerCase()
  return domain && domain.includes(".") ? domain : null
}

export function exclusionReason(rawHeader, sinceUnix = null) {
  const headers = headerMap(rawHeader)
  const labels = (headers.get("x-gmail-labels") ?? []).join(",").toLowerCase()
  if (/(?:^|,)\s*(?:sent|draft|spam|trash)(?:\s*,|$)/.test(labels)) return "non_inbox_folder"
  if (headers.has("list-unsubscribe") || headers.has("list-id")) return "list_or_bulk"
  const precedence = (headers.get("precedence") ?? []).join(" ").toLowerCase()
  if (/\b(?:bulk|list|junk)\b/.test(precedence)) return "list_or_bulk"
  const autoSubmitted = firstHeader(headers, "auto-submitted")
  if (autoSubmitted && !/^no\b/i.test(autoSubmitted)) return "automated"
  if (headers.has("x-auto-response-suppress") || headers.has("feedback-id")) return "automated"
  if (sinceUnix !== null) {
    const timestamp = Date.parse(firstHeader(headers, "date") ?? "")
    if (!Number.isFinite(timestamp)) return "missing_or_invalid_date"
    if (Math.floor(timestamp / 1000) < sinceUnix) return "older_than_window"
  }
  return null
}

function isMboxSeparator(line) {
  return line.length >= 5
    && line[0] === 0x46
    && line[1] === 0x72
    && line[2] === 0x6f
    && line[3] === 0x6d
    && line[4] === 0x20
}

export async function* readMboxHeaders(path) {
  let pending = Buffer.alloc(0)
  let sawSeparator = false
  let collectingHeader = false
  let headerChunks = []

  async function* consumeLine(line) {
    if (isMboxSeparator(line)) {
      if (sawSeparator && headerChunks.length > 0) yield Buffer.concat(headerChunks)
      sawSeparator = true
      collectingHeader = true
      headerChunks = []
      return
    }
    if (!sawSeparator || !collectingHeader) return
    headerChunks.push(line)
    if (/^\r?\n$/.test(line.toString("latin1"))) collectingHeader = false
  }

  for await (const chunk of createReadStream(path)) {
    pending = Buffer.concat([pending, chunk])
    while (true) {
      const newline = pending.indexOf(0x0a)
      if (newline < 0) break
      const line = pending.subarray(0, newline + 1)
      pending = pending.subarray(newline + 1)
      yield* consumeLine(line)
    }
  }
  if (pending.length > 0) yield* consumeLine(pending)
  if (!sawSeparator) throw new Error("input is not an mbox archive")
  if (headerChunks.length > 0) yield Buffer.concat(headerChunks)
}

function classify(evidence, result) {
  if (result.verdict === "compatible") return "aligned_compatible"
  if (result.reason_codes.includes("header_canonicalization_unsupported")) {
    return "unsupported_canonicalization"
  }
  if (result.reason_codes.includes("algorithm_unsupported")) return "unsupported_algorithm"
  if (result.reason_codes.some((code) => code.startsWith("required_header_missing:"))) {
    return "required_header_missing"
  }
  if (result.reason_codes.includes("strict_alignment_failed")) {
    const selected = evidence.signatures.find(
      (signature) => signature.index === result.selected_signature_index,
    )
    return /(?:^|\.)gappssmtp\.com$/i.test(selected?.signing_domain ?? "")
      ? "workspace_provider_fallback"
      : "unaligned_other"
  }
  if (result.reason_codes.includes("no_dkim_signature")) return "no_dkim_signature"
  return "no_verified_header_signature"
}

function domainFromEvidence(evidence) {
  const domains = new Set(evidence.signatures
    .map((signature) => signature.from_domain)
    .filter((value) => typeof value === "string" && value.includes("."))
    .map((value) => value.toLowerCase()))
  return domains.size === 1 ? [...domains][0] : null
}

function cachedSystemResolver() {
  const cache = new Map()
  let queryCount = 0
  return {
    get queryCount() { return queryCount },
    async resolve(name, type) {
      if (type !== "TXT") throw new Error("only TXT lookups are supported")
      const key = name.toLowerCase()
      if (!cache.has(key)) {
        queryCount += 1
        cache.set(key, resolveTxt(name).then((records) => records.map((parts) => parts.join(""))))
      }
      return cache.get(key)
    },
  }
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4))
}

export async function surveyArchive(messages, options = {}) {
  const observedAt = options.observedAt ?? Math.floor(Date.now() / 1000)
  const sinceUnix = options.sinceUnix ?? null
  const resolverState = options.resolver
    ? { resolve: options.resolver, get queryCount() { return null } }
    : cachedSystemResolver()
  const evidenceAdapter = options.evidenceAdapter ?? evidenceFromRawEmail
  const domainResults = new Map()
  const excluded = {}
  let messagesScanned = 0
  let humanCandidateMessages = 0

  for await (const rawHeader of messages) {
    messagesScanned += 1
    const reason = exclusionReason(rawHeader, sinceUnix)
    if (reason) {
      excluded[reason] = (excluded[reason] ?? 0) + 1
      continue
    }
    humanCandidateMessages += 1
    let evidence
    try {
      evidence = await evidenceAdapter(rawHeader, {
        observedAt,
        resolver: resolverState.resolve.bind(resolverState),
      })
    } catch {
      excluded.verification_error = (excluded.verification_error ?? 0) + 1
      continue
    }
    const headerDomain = domainFromHeader(rawHeader)
    const evidenceDomain = domainFromEvidence(evidence)
    const domain = evidenceDomain ?? headerDomain
    if (domain === null || (evidenceDomain !== null && evidenceDomain !== headerDomain)) {
      excluded.missing_or_ambiguous_from_domain =
        (excluded.missing_or_ambiguous_from_domain ?? 0) + 1
      continue
    }
    const result = evaluateCompatibility(evidence, {
      context: "advisory-preflight",
      confidence: "other-domain-mailbox",
    })
    const category = classify(evidence, result)
    const prior = domainResults.get(domain)
    if (!prior || CATEGORY_PRIORITY.get(category) > CATEGORY_PRIORITY.get(prior)) {
      domainResults.set(domain, category)
    }
  }

  const domainCategories = Object.fromEntries([...CATEGORY_PRIORITY.keys()].map(
    (category) => [category, [...domainResults.values()].filter((value) => value === category).length],
  ))
  const definitiveDomainCount = domainResults.size
    - domainCategories.no_verified_header_signature
    - domainCategories.verification_error
  return {
    schema_version: 1,
    observed_at: new Date(observedAt * 1000).toISOString(),
    since: sinceUnix === null ? null : new Date(sinceUnix * 1000).toISOString(),
    messages_scanned: messagesScanned,
    human_candidate_messages: humanCandidateMessages,
    unique_sender_domains: domainResults.size,
    domain_categories: domainCategories,
    observed_compatible_rate_all_domains: rate(
      domainCategories.aligned_compatible,
      domainResults.size,
    ),
    observed_compatible_rate_definitive_domains: rate(
      domainCategories.aligned_compatible,
      definitiveDomainCount,
    ),
    excluded_messages: Object.fromEntries(Object.entries(excluded).sort()),
    dns_queries: resolverState.queryCount,
    privacy: "Aggregate counts only. No domain, address, subject, message identifier, path, or header value is emitted.",
    methodology: {
      unit: "One best observed verdict per From domain, so frequent correspondents do not dominate.",
      human_filter: "Excludes list headers, bulk/list/junk precedence, common automated-mail headers, and Gmail sent/draft/spam/trash labels. This is a heuristic, not a human-authorship proof.",
      dns_disclosure: "Raw mail stays local, but live DKIM TXT lookups disclose selector/domain queries to the configured DNS path.",
      archive_age: "Rotated or removed DKIM selectors can make old valid mail inconclusive; use a recent explicit --since window.",
      sampling_bias: "The archive reflects this mailbox's correspondents, sectors, and receiving paths; it is not a general census.",
    },
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) throw new Error("invalid arguments")
    values.set(key.slice(2), value)
  }
  if (!values.get("mbox") || !values.get("since")) {
    throw new Error("usage: survey-mail-archive.mjs --mbox <archive.mbox> --since <YYYY-MM-DD> [--out <aggregate.json>]")
  }
  const since = `${values.get("since")}T00:00:00Z`
  const sinceUnix = Math.floor(Date.parse(since) / 1000)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.get("since")) || !Number.isFinite(sinceUnix)) {
    throw new Error("--since must be YYYY-MM-DD")
  }
  return { mbox: values.get("mbox"), sinceUnix, output: values.get("out") }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const output = `${JSON.stringify(await surveyArchive(readMboxHeaders(args.mbox), {
    sinceUnix: args.sinceUnix,
  }), null, 2)}\n`
  if (args.output) {
    await writeFile(args.output, output, { encoding: "utf8", mode: 0o600 })
    await chmod(args.output, 0o600)
  } else {
    process.stdout.write(output)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("archive survey failed; check arguments and local input\n")
    process.exitCode = 1
  })
}
