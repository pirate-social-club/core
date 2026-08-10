#!/usr/bin/env node

import { createReadStream } from "node:fs"
import { chmod, writeFile } from "node:fs/promises"
import { domainToASCII, pathToFileURL } from "node:url"

const CATEGORY_PRIORITY = new Map([
  ["no_trusted_authentication_results", 0],
  ["no_dkim_result", 1],
  ["dkim_not_passed", 2],
  ["unaligned_other", 3],
  ["workspace_provider_fallback", 4],
  ["aligned_compatible", 5],
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

function normalizeDomain(value) {
  if (typeof value !== "string") return null
  const ascii = domainToASCII(value.trim().replace(/^['"]|['"]$/g, "").replace(/\.$/, ""))
    .toLowerCase()
  const labels = ascii.split(".")
  if (
    !ascii.includes(".")
    || ascii.length > 253
    || labels.some((label) => (
      label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    ))
  ) return null
  return ascii
}

function domainFromHeaderMap(headers) {
  const fromValues = headers.get("from") ?? []
  if (fromValues.length !== 1) return null
  const matches = [...fromValues[0].matchAll(
    /[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+@([A-Za-z0-9.-]+)/g,
  )]
  return matches.length === 1 ? normalizeDomain(matches[0][1]) : null
}

function trustedAuthenticationResults(headers, authservId) {
  const trusted = (headers.get("authentication-results") ?? []).filter((value) => {
    const separator = value.indexOf(";")
    return separator > 0 && value.slice(0, separator).trim().toLowerCase() === authservId
  })
  return trusted.slice(0, 1)
}

function dkimResults(values) {
  const results = []
  for (const value of values) {
    for (const match of value.matchAll(/(?:^|;)\s*dkim\s*=\s*([a-z]+)\b([^;]*)/gi)) {
      const properties = match[2]
      const identity = properties.match(/\bheader\.i\s*=\s*([^\s;]+)/i)?.[1]
      const headerDomain = properties.match(/\bheader\.d\s*=\s*([^\s;]+)/i)?.[1]
      const identityDomain = identity?.includes("@")
        ? identity.slice(identity.lastIndexOf("@") + 1)
        : identity
      results.push({
        status: match[1].toLowerCase(),
        signingDomain: normalizeDomain(identityDomain ?? headerDomain),
      })
    }
  }
  return results
}

function classifyDeliveryEvidence(headers, fromDomain, authservId) {
  const trusted = trustedAuthenticationResults(headers, authservId)
  if (trusted.length === 0) return "no_trusted_authentication_results"
  const results = dkimResults(trusted)
  if (results.length === 0) return "no_dkim_result"
  const passing = results.filter((result) => result.status === "pass")
  if (passing.some((result) => result.signingDomain === fromDomain)) {
    return "aligned_compatible"
  }
  if (passing.some((result) => /(?:^|\.)gappssmtp\.com$/.test(result.signingDomain ?? ""))) {
    return "workspace_provider_fallback"
  }
  if (passing.length > 0) return "unaligned_other"
  return "dkim_not_passed"
}

function baseExclusionReason(headers, sinceUnix) {
  const labels = (headers.get("x-gmail-labels") ?? []).join(",").toLowerCase()
  if (/(?:^|,)\s*(?:sent|draft|spam|trash)(?:\s*,|$)/.test(labels)) return "non_inbox_folder"
  const timestamp = Date.parse(firstHeader(headers, "date") ?? "")
  if (!Number.isFinite(timestamp)) return "missing_or_invalid_date"
  if (Math.floor(timestamp / 1000) < sinceUnix) return "older_than_window"
  return null
}

export function bulkExclusionReason(rawHeader) {
  const headers = headerMap(rawHeader)
  if (headers.has("list-unsubscribe") || headers.has("list-id")) return "list_or_bulk"
  const precedence = (headers.get("precedence") ?? []).join(" ").toLowerCase()
  if (/\b(?:bulk|list|junk)\b/.test(precedence)) return "list_or_bulk"
  const autoSubmitted = firstHeader(headers, "auto-submitted")
  if (autoSubmitted && !/^no\b/i.test(autoSubmitted)) return "automated"
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

function recordBest(domainResults, domain, category) {
  const prior = domainResults.get(domain)
  if (!prior || CATEGORY_PRIORITY.get(category) > CATEGORY_PRIORITY.get(prior)) {
    domainResults.set(domain, category)
  }
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4))
}

function summarize(domainResults, messageCount) {
  const domainCategories = Object.fromEntries([...CATEGORY_PRIORITY.keys()].map(
    (category) => [category, [...domainResults.values()].filter((value) => value === category).length],
  ))
  const passDomainCount = domainCategories.aligned_compatible
    + domainCategories.workspace_provider_fallback
    + domainCategories.unaligned_other
  return {
    message_count: messageCount,
    unique_sender_domains: domainResults.size,
    domain_categories: domainCategories,
    aligned_rate_all_domains: rate(domainCategories.aligned_compatible, domainResults.size),
    aligned_rate_among_dkim_pass_domains: rate(domainCategories.aligned_compatible, passDomainCount),
  }
}

export async function surveyArchive(messages, options = {}) {
  const observedAt = options.observedAt ?? Math.floor(Date.now() / 1000)
  const sinceUnix = options.sinceUnix
  const authservId = options.authservId?.trim().toLowerCase()
  if (!Number.isInteger(sinceUnix)) throw new Error("sinceUnix is required")
  if (!authservId || !/^[a-z0-9.-]+$/.test(authservId)) throw new Error("authservId is required")

  const allDomains = new Map()
  const humanDomains = new Map()
  const excluded = {}
  let messagesScanned = 0
  let allReceivedMessages = 0
  let humanCandidateMessages = 0

  for await (const rawHeader of messages) {
    messagesScanned += 1
    const headers = headerMap(rawHeader)
    const baseReason = baseExclusionReason(headers, sinceUnix)
    if (baseReason) {
      excluded[baseReason] = (excluded[baseReason] ?? 0) + 1
      continue
    }
    const domain = domainFromHeaderMap(headers)
    if (domain === null) {
      excluded.missing_or_ambiguous_from_domain =
        (excluded.missing_or_ambiguous_from_domain ?? 0) + 1
      continue
    }
    allReceivedMessages += 1
    const category = classifyDeliveryEvidence(headers, domain, authservId)
    recordBest(allDomains, domain, category)

    const bulkReason = bulkExclusionReason(rawHeader)
    if (bulkReason) {
      excluded[bulkReason] = (excluded[bulkReason] ?? 0) + 1
      continue
    }
    humanCandidateMessages += 1
    recordBest(humanDomains, domain, category)
  }

  return {
    schema_version: 2,
    evidence_source: "trusted_recipient_authentication_results",
    trusted_authserv_id: authservId,
    observed_at: new Date(observedAt * 1000).toISOString(),
    since: new Date(sinceUnix * 1000).toISOString(),
    messages_scanned: messagesScanned,
    populations: {
      all_received: summarize(allDomains, allReceivedMessages),
      human_candidate: summarize(humanDomains, humanCandidateMessages),
    },
    excluded_messages: Object.fromEntries(Object.entries(excluded).sort()),
    network_requests: 0,
    privacy: "Aggregate counts only. No sender domain, address, subject, message identifier, path, or raw header value is emitted; the explicitly configured receiving authserv-id is recorded.",
    methodology: {
      unit: "One best observed verdict per From domain, so frequent correspondents do not dominate.",
      delivery_evidence: `Only Authentication-Results whose authserv-id exactly equals ${authservId} are trusted; this is coverage evidence, never authorization evidence.`,
      human_filter: "The human-candidate population excludes List-Unsubscribe/List-Id, bulk/list/junk Precedence, non-no Auto-Submitted, and Gmail sent/draft/spam/trash labels. Feedback-ID is not an exclusion because a measured human-composed message carried it. This is a heuristic, not a human-authorship proof.",
      comparison: "all_received includes bulk/automated mail after the shared date/folder/From filters; human_candidate excludes it so hygiene inflation is visible.",
      no_network: "No DNS or HTTP lookup is performed. DKIM status is the receiving provider's contemporaneous delivery verdict preserved in the archive.",
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
  if (!values.get("mbox") || !values.get("since") || !values.get("authserv-id")) {
    throw new Error("required arguments are missing")
  }
  const since = `${values.get("since")}T00:00:00Z`
  const sinceUnix = Math.floor(Date.parse(since) / 1000)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.get("since")) || !Number.isFinite(sinceUnix)) {
    throw new Error("invalid date")
  }
  return {
    mbox: values.get("mbox"),
    sinceUnix,
    authservId: values.get("authserv-id"),
    output: values.get("out"),
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const output = `${JSON.stringify(await surveyArchive(readMboxHeaders(args.mbox), {
    sinceUnix: args.sinceUnix,
    authservId: args.authservId,
  }), null, 2)}\n`
  if (args.output) {
    await writeFile(args.output, output, { encoding: "utf8", mode: 0o600 })
    await chmod(args.output, 0o600)
  } else {
    process.stdout.write(output)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("archive survey failed; check arguments and local input\n")
    process.exitCode = 1
  })
}
