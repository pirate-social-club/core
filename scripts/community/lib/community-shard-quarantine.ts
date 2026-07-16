import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

export type FleetEnvironment = "production" | "staging"

export type ShardQuarantine = {
  binding: string
  reason_code: string
  approved_at: string
  review_after: string
  expires_at: string
}

type Registry = {
  version: 1
  production: ShardQuarantine[]
  staging: ShardQuarantine[]
}

export type QuarantinePartition = {
  live: string[]
  quarantined: ShardQuarantine[]
  registryChecksum: string
}

function instant(value: unknown, field: string, binding: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`quarantine ${binding}: ${field} must be an ISO-8601 timestamp`)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`quarantine ${binding}: ${field} is invalid`)
  return parsed
}

/**
 * Partition the pool-authoritative fleet through a reviewed, expiring overlay.
 * Invalid policy is blocking: quarantine must never become a silent skip list.
 */
export async function partitionQuarantinedBindings(
  registryPath: string,
  environment: FleetEnvironment,
  poolBindings: readonly string[],
  configuredBindings: ReadonlySet<string>,
  now = Date.now(),
): Promise<QuarantinePartition> {
  const bytes = await readFile(registryPath, "utf8")
  const registry = JSON.parse(bytes) as Partial<Registry>
  if (registry.version !== 1 || !Array.isArray(registry.production) || !Array.isArray(registry.staging)) {
    throw new Error(`${registryPath}: expected quarantine registry version 1 with production and staging arrays`)
  }

  const entries = registry[environment]!
  const pool = new Set(poolBindings)
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry.binding !== "string" || !entry.binding.startsWith("DB_CMTY")) {
      throw new Error(`${registryPath}: every quarantine requires a DB_CMTY binding`)
    }
    if (seen.has(entry.binding)) throw new Error(`${registryPath}: duplicate quarantine ${entry.binding}`)
    seen.add(entry.binding)
    if (!pool.has(entry.binding)) throw new Error(`${registryPath}: quarantined binding ${entry.binding} is not allocated+loaded in the pool`)
    if (!configuredBindings.has(entry.binding)) throw new Error(`${registryPath}: quarantined binding ${entry.binding} is absent from shard config`)
    if (typeof entry.reason_code !== "string" || !/^[a-z0-9_]{3,64}$/.test(entry.reason_code)) {
      throw new Error(`quarantine ${entry.binding}: reason_code must be a stable lowercase identifier`)
    }
    const approved = instant(entry.approved_at, "approved_at", entry.binding)
    const review = instant(entry.review_after, "review_after", entry.binding)
    const expires = instant(entry.expires_at, "expires_at", entry.binding)
    if (!(approved <= review && review < expires)) {
      throw new Error(`quarantine ${entry.binding}: require approved_at <= review_after < expires_at`)
    }
    if (expires <= now) throw new Error(`quarantine ${entry.binding}: expired at ${entry.expires_at}; renew or remove it explicitly`)
  }

  return {
    live: poolBindings.filter((binding) => !seen.has(binding)),
    quarantined: entries,
    registryChecksum: createHash("sha256").update(bytes).digest("hex"),
  }
}
