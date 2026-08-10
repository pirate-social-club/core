#!/usr/bin/env node

import { createReadStream } from "node:fs"
import { chmod, opendir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { domainToASCII, pathToFileURL } from "node:url"

const CATEGORY_PRIORITY = new Map([
  ["no_trusted_authentication_results", 0],
  ["no_dkim_result", 1],
  ["dkim_not_passed", 2],
  ["unrelated_signing_domain", 3],
  ["from_subdomain_of_signer", 4],
  ["signer_subdomain_of_from", 5],
  ["workspace_provider_fallback", 6],
  ["aligned_compatible", 7],
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
  if (passing.some((result) => result.signingDomain?.endsWith(`.${fromDomain}`))) {
    return "signer_subdomain_of_from"
  }
  if (passing.some((result) => fromDomain.endsWith(`.${result.signingDomain}`))) {
    return "from_subdomain_of_signer"
  }
  if (passing.length > 0) return "unrelated_signing_domain"
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

async function readEmlHeader(path) {
  let buffered = Buffer.alloc(0)
  for await (const chunk of createReadStream(path)) {
    buffered = Buffer.concat([buffered, chunk])
    const text = buffered.toString("latin1")
    const separator = text.search(/\r?\n\r?\n/)
    if (separator >= 0) return buffered.subarray(0, separator + (text[separator] === "\r" ? 4 : 2))
    if (buffered.length > 1024 * 1024) throw new Error("message header exceeds limit")
  }
  throw new Error("message header is incomplete")
}

async function protonExcludedLabelIds(root) {
  const excludedNames = new Set(["sent", "all sent", "drafts", "all drafts", "spam", "trash"])
  async function findMapping(directory) {
    const entries = await opendir(directory)
    for await (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        const nested = await findMapping(path)
        if (nested) return nested
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        try {
          const parsed = JSON.parse(await readFile(path, "utf8"))
          if (Array.isArray(parsed.Payload)) return parsed.Payload
        } catch {
          // Ignore non-JSON or per-message metadata here.
        }
      }
    }
    return null
  }
  const labels = await findMapping(root)
  if (!labels) throw new Error("Proton label metadata is missing")
  return new Set(labels
    .filter((label) => excludedNames.has(String(label.Name ?? "").trim().toLowerCase()))
    .map((label) => label.ID))
}

export async function* readEmlDirectoryHeaders(root) {
  const excludedLabelIds = await protonExcludedLabelIds(root)
  async function* walk(directory) {
    const entries = await opendir(directory)
    for await (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) yield* walk(path)
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".eml")) {
        const metadataPath = `${path.slice(0, -4)}.metadata.json`
        let metadata
        try {
          metadata = JSON.parse(await readFile(metadataPath, "utf8"))?.Payload
        } catch {
          metadata = null
        }
        yield {
          rawHeader: await readEmlHeader(path),
          sourceFolderExcluded: Array.isArray(metadata?.LabelIDs)
            ? metadata.LabelIDs.some((id) => excludedLabelIds.has(id))
            : null,
          sourceRepliedTo: metadata?.IsReplied === 1 || metadata?.IsRepliedAll === 1,
        }
      }
    }
  }
  yield* walk(root)
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
    + domainCategories.signer_subdomain_of_from
    + domainCategories.from_subdomain_of_signer
    + domainCategories.unrelated_signing_domain
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
  const repliedDomains = new Map()
  const excluded = {}
  let messagesScanned = 0
  let allReceivedMessages = 0
  let humanCandidateMessages = 0
  let repliedToMessages = 0

  for await (const rawHeader of messages) {
    messagesScanned += 1
    const message = Buffer.isBuffer(rawHeader) ? { rawHeader } : rawHeader
    const headerBytes = message.rawHeader
    if (!Buffer.isBuffer(headerBytes)) {
      excluded.invalid_source_record = (excluded.invalid_source_record ?? 0) + 1
      continue
    }
    if (message.sourceFolderExcluded === true) {
      excluded.non_inbox_folder = (excluded.non_inbox_folder ?? 0) + 1
      continue
    }
    if (message.sourceFolderExcluded === null) {
      excluded.missing_source_folder_metadata =
        (excluded.missing_source_folder_metadata ?? 0) + 1
      continue
    }
    const headers = headerMap(headerBytes)
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

    const bulkReason = bulkExclusionReason(headerBytes)
    if (bulkReason) {
      excluded[bulkReason] = (excluded[bulkReason] ?? 0) + 1
      continue
    }
    humanCandidateMessages += 1
    recordBest(humanDomains, domain, category)
    if (message.sourceRepliedTo === true) {
      repliedToMessages += 1
      recordBest(repliedDomains, domain, category)
    }
  }

  return {
    schema_version: 4,
    evidence_source: "trusted_recipient_authentication_results",
    trusted_authserv_id: authservId,
    observed_at: new Date(observedAt * 1000).toISOString(),
    since: new Date(sinceUnix * 1000).toISOString(),
    messages_scanned: messagesScanned,
    populations: {
      all_received: summarize(allDomains, allReceivedMessages),
      header_filtered_candidate: summarize(humanDomains, humanCandidateMessages),
      replied_to_candidate: summarize(repliedDomains, repliedToMessages),
    },
    excluded_messages: Object.fromEntries(Object.entries(excluded).sort()),
    network_requests: 0,
    privacy: "Aggregate counts only. No sender domain, address, subject, message identifier, path, or raw header value is emitted; the explicitly configured receiving authserv-id is recorded.",
    methodology: {
      unit: "One best observed verdict per From domain, so frequent correspondents do not dominate.",
      delivery_evidence: `Only Authentication-Results whose authserv-id exactly equals ${authservId} are trusted; this is coverage evidence, never authorization evidence.`,
      header_filter: "The header-filtered population excludes List-Unsubscribe/List-Id, bulk/list/junk Precedence, non-no Auto-Submitted, and source Sent/Draft/Spam/Trash labels. Feedback-ID is not an exclusion because a measured human-composed message carried it. This is a loose heuristic, not a human-authorship proof.",
      replied_filter: "For Proton EML exports, replied_to_candidate further requires sidecar IsReplied or IsRepliedAll. This is higher precision for human correspondence but lower recall and biased toward conversations the mailbox owner answered.",
      comparison: "all_received includes bulk/automated mail after the shared date/folder/From filters; header_filtered_candidate excludes it so hygiene inflation is visible.",
      alignment_relationships: "Non-exact DKIM pass domains are split observationally into signer-subdomain-of-From, From-subdomain-of-signer, Workspace fallback, and unrelated categories. These categories do not relax the gate's exact-alignment authorization rule.",
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
  const sources = [values.get("mbox"), values.get("eml-dir")].filter(Boolean)
  if (sources.length !== 1 || !values.get("since") || !values.get("authserv-id")) {
    throw new Error("required arguments are missing")
  }
  const since = `${values.get("since")}T00:00:00Z`
  const sinceUnix = Math.floor(Date.parse(since) / 1000)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.get("since")) || !Number.isFinite(sinceUnix)) {
    throw new Error("invalid date")
  }
  return {
    mbox: values.get("mbox"),
    emlDirectory: values.get("eml-dir"),
    sinceUnix,
    authservId: values.get("authserv-id"),
    output: values.get("out"),
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const messages = args.mbox
    ? readMboxHeaders(args.mbox)
    : readEmlDirectoryHeaders(args.emlDirectory)
  const output = `${JSON.stringify(await surveyArchive(messages, {
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
