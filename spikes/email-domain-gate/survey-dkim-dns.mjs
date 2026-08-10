#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises"
import { resolveCname, resolveTxt } from "node:dns/promises"
import { domainToASCII, pathToFileURL } from "node:url"

const LABEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ABSENT_DNS_CODES = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"])

function normalizeDomain(value) {
  if (typeof value !== "string") throw new Error("target domain must be a string")
  const ascii = domainToASCII(value.trim().replace(/\.$/, "")).toLowerCase()
  const labels = ascii.split(".")
  if (
    !ascii
    || ascii.length > 253
    || !ascii.includes(".")
    || labels.some((label) => (
      label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    ))
  ) {
    throw new Error("target domain is invalid")
  }
  return ascii
}

function normalizeTargets(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("input must be a non-empty JSON array")
  }
  const labels = new Set()
  return input.map((target) => {
    if (!target || !LABEL_PATTERN.test(target.label ?? "")) {
      throw new Error("each target needs a non-identifying label of 1-64 characters")
    }
    if (labels.has(target.label)) throw new Error("target labels must be unique")
    labels.add(target.label)
    return { label: target.label, domain: normalizeDomain(target.domain) }
  })
}

function dnsErrorStatus(error) {
  return ABSENT_DNS_CODES.has(error?.code) ? "absent" : "query-error"
}

async function probeTxt(name, validator, resolver) {
  try {
    const records = await resolver(name)
    const present = records.some((chunks) => validator(chunks.join("")))
    return present ? "present" : "absent"
  } catch (error) {
    return dnsErrorStatus(error)
  }
}

async function probeCname(name, resolver) {
  try {
    const records = await resolver(name)
    return records.length > 0 ? "present" : "absent"
  } catch (error) {
    return dnsErrorStatus(error)
  }
}

function combineDnsStatuses(...statuses) {
  if (statuses.includes("present")) return "present"
  if (statuses.includes("query-error")) return "query-error"
  return "absent"
}

async function probeDkimName(name, resolvers) {
  const [txt, cname] = await Promise.all([
    probeTxt(name, (value) => /(?:^|;)\s*(?:v\s*=\s*DKIM1\s*;)?[^;]*p\s*=/i.test(value), resolvers.resolveTxt),
    probeCname(name, resolvers.resolveCname),
  ])
  return combineDnsStatuses(txt, cname)
}

async function probeTarget(target, resolvers) {
  const workspaceName = `google._domainkey.${target.domain}`
  const m365Selector1Name = `selector1._domainkey.${target.domain}`
  const m365Selector2Name = `selector2._domainkey.${target.domain}`
  const dmarcName = `_dmarc.${target.domain}`
  const [workspace, m365Selector1, m365Selector2, dmarc] = await Promise.all([
    probeDkimName(workspaceName, resolvers),
    probeDkimName(m365Selector1Name, resolvers),
    probeDkimName(m365Selector2Name, resolvers),
    probeTxt(dmarcName, (value) => /^\s*v\s*=\s*DMARC1(?:\s*;|\s*$)/i.test(value), resolvers.resolveTxt),
  ])
  return {
    label: target.label,
    workspace_default_selector: workspace,
    m365_selector1: m365Selector1,
    m365_selector2: m365Selector2,
    m365_any_selector: combineDnsStatuses(m365Selector1, m365Selector2),
    dmarc,
  }
}

function countStatus(targets, field, status) {
  return targets.filter((target) => target[field] === status).length
}

export async function surveyDkimDns(input, options = {}) {
  const targets = normalizeTargets(input)
  const resolvers = {
    resolveTxt: options.resolveTxt ?? resolveTxt,
    resolveCname: options.resolveCname ?? resolveCname,
  }
  const observations = await Promise.all(
    targets.map((target) => probeTarget(target, resolvers)),
  )
  const fields = ["workspace_default_selector", "m365_any_selector", "dmarc"]
  const aggregate = Object.fromEntries(fields.map((field) => [field, {
    present: countStatus(observations, field, "present"),
    absent: countStatus(observations, field, "absent"),
    query_error: countStatus(observations, field, "query-error"),
  }]))

  return {
    schema_version: 1,
    observed_at: options.observedAt ?? new Date().toISOString(),
    target_count: observations.length,
    targets: observations,
    aggregate,
    interpretation: {
      workspace_default_selector: "Positive fingerprint only; custom selectors create false negatives and stale/inactive records create false positives.",
      m365_selectors: "Known selector fingerprint only; DNS presence does not prove the active outbound path or strict alignment.",
      dmarc: "Policy publication only; DMARC may pass through SPF and does not prove aligned DKIM.",
      compatibility: "Actual gate compatibility still requires a cryptographically verified signed message.",
    },
    privacy: "Output contains non-identifying labels and booleans only; input domains are not emitted.",
  }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("usage: survey-dkim-dns.mjs --file <targets.json> [--out <result.json>]")
    }
    values.set(key.slice(2), value)
  }
  if (!values.get("file")) {
    throw new Error("usage: survey-dkim-dns.mjs --file <targets.json> [--out <result.json>]")
  }
  return values
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const input = JSON.parse(await readFile(args.get("file"), "utf8"))
  const output = `${JSON.stringify(await surveyDkimDns(input), null, 2)}\n`
  if (args.get("out")) {
    await writeFile(args.get("out"), output, { encoding: "utf8", mode: 0o600 })
    await chmod(args.get("out"), 0o600)
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
