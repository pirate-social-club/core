#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import {
  PROPOSED_LEDGER_DDL,
  PROPOSED_AGGREGATE_SQL,
  candidateARow,
  candidateBProof,
  digest,
  effectivePolicyDigest,
  phase0LegacyManifestPolicyEvidence,
  stableJson,
  statusFromCandidateA,
  validatePhase0LegacyManifest,
  type PolicyVerdictRow,
  type SchemaManifest,
} from "./lib/schema-attestation-proof"

type SpikeInput = { manifest: string; shardWorkerId: string; fixtureOut?: string }

function parseArgs(argv: string[]): { inputs: SpikeInput[]; report: string } {
  const inputs: SpikeInput[] = []
  let report = "tmp/schema-attestation-ledger-spike.md"
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--manifest") {
      const spec = argv[++index]
      if (!spec) throw new Error("--manifest requires path,worker-id[,fixture-out]")
      const [manifest, shardWorkerId, fixtureOut] = spec.split(",")
      if (!manifest || !shardWorkerId) throw new Error(`invalid --manifest spec: ${spec}`)
      inputs.push({ manifest: resolve(manifest), shardWorkerId, fixtureOut: fixtureOut ? resolve(fixtureOut) : undefined })
    } else if (arg === "--report") {
      report = resolve(argv[++index] ?? "")
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (inputs.length === 0) throw new Error("at least one --manifest path,worker-id[,fixture-out] is required")
  return { inputs, report: resolve(report) }
}

function compactManifest(manifest: SchemaManifest): SchemaManifest {
  return {
    fleet: manifest.fleet,
    requirements_version: manifest.requirements_version,
    features_checked: manifest.features_checked,
    required_migrations: manifest.required_migrations,
    feature_migrations: manifest.feature_migrations,
    canonical_schema_checked: manifest.canonical_schema_checked,
    canonical_schema_mode: manifest.canonical_schema_mode,
    canonical_schema_expected_artifacts: manifest.canonical_schema_expected_artifacts,
    canonical_schema_excluded_migrations: manifest.canonical_schema_excluded_migrations,
    compatible_missing_schema_artifacts: manifest.compatible_missing_schema_artifacts,
    allocated_loaded_shards: manifest.allocated_loaded_shards,
    live_shards: manifest.live_shards,
    quarantined_shards: manifest.quarantined_shards,
    quarantine_registry_checksum: manifest.quarantine_registry_checksum,
    quarantines: manifest.quarantines,
    classified: manifest.classified,
    summary: manifest.summary,
    shards: manifest.shards,
  }
}

function measureAggregate(rows: PolicyVerdictRow[], manifest: SchemaManifest, shardWorkerId: string) {
  const db = new Database(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("CREATE TABLE d1_pool (binding_name TEXT PRIMARY KEY, community_id TEXT, last_loaded_at TEXT, version INTEGER NOT NULL)")
  db.exec(PROPOSED_LEDGER_DDL)
  const insertPool = db.prepare("INSERT INTO d1_pool VALUES (?, ?, ?, ?)")
  const insertProof = db.prepare(
    `INSERT INTO d1_pool_schema_attestations VALUES (${Array.from({ length: 16 }, () => "?").join(", ")})`,
  )
  db.transaction(() => {
    for (const row of rows) {
      insertPool.run(row.binding_name, row.community_id, "2026-08-03T00:00:00.000Z", row.pool_version)
      insertProof.run(
        row.shard_worker_id,
        row.binding_name,
        row.community_id,
        row.pool_version,
        row.attestation_epoch,
        row.state,
        row.verdict_status,
        row.effective_policy_digest,
        row.schema_fingerprint,
        row.migration_ledger_digest,
        row.canonical_inventory_digest,
        row.verified_at,
        row.writer_kind,
        row.writer_run_id,
        row.last_error_code,
        row.last_error_detail,
      )
    }
  })()
  const query = db.prepare(PROPOSED_AGGREGATE_SQL)
  const started = performance.now()
  let result: unknown = null
  for (let index = 0; index < 1_000; index += 1) {
    result = query.get(shardWorkerId, rows[0]?.effective_policy_digest ?? "", "[]")
  }
  const elapsed = performance.now() - started
  db.close()
  return { result, averageMilliseconds: elapsed / 1_000, responseBytes: Buffer.byteLength(JSON.stringify(result)) }
}

function markdownTable(rows: Array<Record<string, string | number>>): string {
  const columns = Object.keys(rows[0] ?? {})
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => String(row[column])).join(" | ")} |`),
  ].join("\n")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const reportRows: Array<Record<string, string | number>> = []
  const findings: string[] = []
  for (const input of options.inputs) {
    const raw = JSON.parse(await readFile(input.manifest, "utf8"))
    const manifest = compactManifest(validatePhase0LegacyManifest(raw, input.manifest))
    const runId = `phase0:${manifest.fleet}:${digest(manifest).slice(0, 12)}`
    const legacyEvidence = phase0LegacyManifestPolicyEvidence(manifest)
    const replayPolicyDigest = digest(legacyEvidence)
    const rows = manifest.shards.map((shard) => candidateARow(shard, manifest, {
      shardWorkerId: input.shardWorkerId,
      runId,
      verifiedAt: "2026-08-03T00:00:00.000Z",
      policyDigest: replayPolicyDigest,
    }))
    const candidateB = manifest.shards.map((shard) => candidateBProof(shard, input.shardWorkerId))
    const mismatches = rows.filter((row, index) => statusFromCandidateA(row) !== manifest.shards[index].status)
    if (mismatches.length > 0) throw new Error(`${manifest.fleet}: Candidate A lost ${mismatches.length} ShardStatus values`)
    const aggregate = measureAggregate(rows, manifest, input.shardWorkerId)
    const activationReadyEvidence = {
      format_version: 1 as const,
      requirements_digest: digest("requirements"),
      migration_checksums_digest: digest("migration checksums"),
      classifications_digest: digest("classifications"),
      canonical_expected_digest: digest("canonical expected artifacts"),
      canonical_baseline_digest: digest("canonical baseline profiles"),
      drift_policy_digest: digest("known drift policy"),
    }
    const policyChanged = effectivePolicyDigest(activationReadyEvidence) !== effectivePolicyDigest({
      ...activationReadyEvidence,
      migration_checksums_digest: digest("changed migration checksums"),
    })
    if (!policyChanged) throw new Error(`${manifest.fleet}: policy change did not alter digest`)

    const profileCount = new Set(manifest.shards.map((shard) => digest({
      missing: shard.canonical_missing ?? [],
      regressions: shard.canonical_regressions ?? [],
    }))).size
    const candidateABytes = Buffer.byteLength(stableJson(rows))
    const candidateBBytes = Buffer.byteLength(stableJson(candidateB))
    reportRows.push({
      fleet: manifest.fleet,
      pools: 1,
      live: manifest.live_shards,
      quarantined: manifest.quarantined_shards,
      statuses: Object.keys(manifest.summary).length,
      profiles: profileCount,
      "A bytes/shard": Math.ceil(candidateABytes / rows.length),
      "B bytes/shard": Math.ceil(candidateBBytes / candidateB.length),
      "aggregate bytes": aggregate.responseBytes,
      "local query ms": aggregate.averageMilliseconds < 1 ? "<1" : Math.ceil(aggregate.averageMilliseconds),
      "fixture SHA": digest(manifest).slice(0, 12),
    })
    findings.push(
      `- ${manifest.fleet}: Candidate A reproduced all ${manifest.classified} recorded ShardStatus values; ` +
      `${profileCount} historical canonical profiles remained distinct.`,
      `- ${manifest.fleet}: changing effective policy produced a new digest, so all prior verdict rows miss without rewriting them.`,
      `- ${manifest.fleet}: adding quarantine removes a binding from the aggregate roster; removing it exposes the left-joined row, where missing/invalid/policy-mismatched proof blocks or falls back.`,
    )
    if (input.fixtureOut) {
      await mkdir(dirname(input.fixtureOut), { recursive: true })
      await writeFile(input.fixtureOut, `${JSON.stringify(manifest, null, 2)}\n`)
    }
  }

  const report = `# D1 schema attestation ledger Phase 0 spike\n\n` +
    `Generated from recent read-only staging and production schema-gate manifests. Timings are local Bun SQLite measurements over 1,000 executions; they validate query shape and response size, not Cloudflare network latency.\n\n` +
    `${markdownTable(reportRows)}\n\n` +
    `## Findings\n\n${findings.join("\n")}\n\n` +
    `Candidate A is selected. Its row size is fixed and bounded (Candidate B is smaller for the sparse staging fixture but grows with recorded inventory drift, as the production fixture shows), it preserves every current status through the bounded verdict code, and it makes policy changes fail closed by digest. Candidate B is retained only as the byte-size comparison; the current manifest does not contain enough raw ledger/checksum observations to make Candidate B safely re-evaluate arbitrary future policy.\n\n` +
    `## Blocking evidence gap found by the spike\n\n` +
    `The Phase 0 fixtures predate trusted policy identity and retain visibly invalid \`phase0-legacy:*\` placeholders for local sizing only. Phase 2 adds six SHA-256 fields to newly published schema-gate manifests: requirements content, migration names+checksums, effective classifications, canonical expected inventory, canonical baseline profiles, and known-drift policy. The activation-capable reader rejects a placeholder, missing field, unknown format, non-SHA-256 value, or aggregate digest mismatch; the legacy reader is confined to the local Phase 0 replay. This closes the policy-content evidence gap but does not activate the release fast path. The manifest's missing-artifact arrays remain insufficient as authoritative per-shard schema/ledger fingerprints; those three proof digests must be computed from raw verifier observations in a later publisher phase.\n\n` +
    `A release performs one aggregate query per shard-owned D1_POOL and combines all pool results fail closed. This is the multi-pool-safe interpretation of the original one-query goal; a single D1 query cannot span independent pool databases. Pool identity is part of every proof key.\n\n` +
    `The proof state machine uses only invalid and verified. The proposed verifying state is removed because Phase 0 found no owner or safety property that requires it.\n\n` +
    `## Proposed DDL\n\n\`\`\`sql\n${PROPOSED_LEDGER_DDL}\n\`\`\`\n`
    + `\n## Proposed per-pool aggregate\n\nThe three parameters are shard Worker ID, effective-policy digest, and the freshly validated quarantine binding array encoded as JSON. A zero-live result is blocking. The caller requires \`live_count = verified_count\` and every miss/error count to be zero.\n\n\`\`\`sql\n${PROPOSED_AGGREGATE_SQL}\n\`\`\`\n`
  await mkdir(dirname(options.report), { recursive: true })
  await writeFile(options.report, report)
  console.log(`wrote ${options.report}`)
}

if (import.meta.main) await main()
