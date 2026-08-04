/**
 * origin/main provenance for fleet rollouts.
 *
 * Why this exists
 * ---------------
 * The 2026-08-03 incident review established that fleet-affecting state was
 * twice built from non-main refs: live shard ledgers carry a migration (1097)
 * that never existed on main, and two production shards were provisioned from an
 * unmerged-branch template bundle. The set-closure audit makes such residue
 * visible; THIS module is the prevention side: an operator must not be able to
 * EXECUTE a fleet rollout from a checkout whose HEAD is not contained in the
 * local origin/main ref.
 *
 * The git probing (probeRolloutProvenance) is deliberately separate from the
 * decision (decideRolloutProvenance) so the policy is unit-testable without git.
 *
 * Both sides of the seam
 * ----------------------
 * The shard/wrangler config a run consumes lives in the API repo — a second
 * checkout with its own HEAD. A fleet tool once read its shard config from a
 * STALE api checkout and confidently inventoried 26 of ~205 bindings. So fleet
 * tooling attests BOTH repos: probeConfigRepoProvenance resolves the config
 * path's containing repo (git rev-parse --show-toplevel) and probes it with the
 * same rigor; decideFleetProvenance composes the two sides — refuse --execute
 * unless both are main-contained and clean, one --allow-non-main covering
 * whichever side(s) failed, recorded per side. A config path that is not inside
 * a git repository fails closed for execute with a clear message.
 *
 * Semantics
 * ---------
 * - Refuse only when: execute && NOT (onMain && clean) && !allowNonMain.
 * - "onMain" means HEAD is an ancestor of (or equal to) the LOCAL
 *   refs/remotes/origin/main — being BEHIND main is fine, being on a side ref
 *   is not. A detached HEAD at a main-contained sha is acceptable (verification
 *   worktrees do this).
 * - A missing/unresolvable origin/main ref (shallow clone, never fetched) fails
 *   CLOSED for execute, with a message telling the operator to fetch. Anything
 *   git cannot answer is treated as "not proven", never as "probably fine".
 * - Read-only passes never block; the caller still records the provenance.
 */

import { execFileSync } from "node:child_process"
import { dirname, resolve } from "node:path"

export type RolloutProvenanceProbe = {
  /** HEAD sha, null when git itself failed (not a git repository). */
  headSha: string | null
  /** Branch name, null when HEAD is detached. */
  branch: string | null
  detached: boolean
  /** Local refs/remotes/origin/main sha, null when that ref cannot be resolved. */
  originMainSha: string | null
  /** HEAD is an ancestor of (or equal to) origin/main; null when undecidable. */
  onMain: boolean | null
  /** Working tree has uncommitted/untracked changes; null when undecidable. */
  dirty: boolean | null
  /** Set when git probing itself failed; everything else may be null. */
  gitError?: string
}

/** The record embedded in run manifests: which git state built this run. */
export type RolloutProvenanceRecord = {
  headSha: string | null
  /** Branch name, or "(detached)". */
  branch: string
  onMain: boolean | null
  dirty: boolean | null
  overrideUsed: boolean
}

export type RolloutProvenanceDecision = {
  allow: boolean
  reason: string
  /** The specific provenance failure, null when the side is fully proven. */
  failure: string | null
  provenance: RolloutProvenanceRecord
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; error?: string } {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, stdout: "", error: message.split("\n")[0] }
  }
}

/**
 * Gather the provenance facts for the checkout at `cwd` via git
 * (execFileSync, no shell). Never throws: any git failure is captured in the
 * probe and left for the decision to fail closed on.
 */
export function probeRolloutProvenance(cwd: string): RolloutProvenanceProbe {
  const head = git(cwd, ["rev-parse", "HEAD"])
  if (!head.ok || !/^[0-9a-f]{40}$/u.test(head.stdout)) {
    return {
      headSha: null,
      branch: null,
      detached: false,
      originMainSha: null,
      onMain: null,
      dirty: null,
      gitError: head.error ?? `unexpected rev-parse output: ${head.stdout.slice(0, 80)}`,
    }
  }
  const headSha = head.stdout

  // symbolic-ref exits non-zero on a detached HEAD; that is data, not an error.
  const symbolic = git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"])
  const detached = !symbolic.ok
  const branch = detached ? null : symbolic.stdout

  const originMain = git(cwd, ["rev-parse", "--verify", "refs/remotes/origin/main"])
  const originMainSha = originMain.ok && /^[0-9a-f]{40}$/u.test(originMain.stdout)
    ? originMain.stdout
    : null

  let onMain: boolean | null = null
  if (originMainSha !== null) {
    onMain = git(cwd, ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"]).ok
  }

  const status = git(cwd, ["status", "--porcelain"])
  if (!status.ok) {
    return { headSha, branch, detached, originMainSha, onMain, dirty: null, gitError: status.error }
  }

  return { headSha, branch, detached, originMainSha, onMain, dirty: status.stdout.length > 0 }
}

/** Pure policy over an already-gathered probe. Unit-testable without git. */
export function decideRolloutProvenance(
  probe: RolloutProvenanceProbe,
  options: { execute: boolean; allowNonMain: boolean },
): RolloutProvenanceDecision {
  const provenance: RolloutProvenanceRecord = {
    headSha: probe.headSha,
    branch: probe.branch ?? "(detached)",
    onMain: probe.onMain,
    dirty: probe.dirty,
    overrideUsed: false,
  }

  // Anything not positively proven is a failure reason, never a pass.
  let failure: string | null = null
  if (probe.gitError || probe.headSha === null) {
    failure =
      `cannot determine git provenance (${probe.gitError ?? "no HEAD"}); ` +
      "run the rollout from a clean checkout on origin/main history"
  } else if (probe.originMainSha === null) {
    failure =
      "the local origin/main ref is missing (shallow clone or never fetched): " +
      "run `git fetch origin main` so the rollout can prove it executes from main history"
  } else if (probe.onMain !== true) {
    const where = probe.branch !== null ? `branch ${probe.branch}` : "detached HEAD"
    failure =
      `HEAD ${probe.headSha.slice(0, 12)} (${where}) is not contained in origin/main: ` +
      "rebase or merge the rollout checkout onto origin/main first"
  } else if (probe.dirty !== false) {
    failure = "the working tree is dirty: commit or stash before executing a fleet rollout"
  }

  if (failure === null) {
    return {
      allow: true,
      reason: `HEAD ${probe.headSha?.slice(0, 12)} is contained in origin/main and the working tree is clean`,
      failure: null,
      provenance,
    }
  }
  if (!options.execute) {
    // A read-only pass never blocks — but its log must still carry the facts.
    return {
      allow: true,
      reason: `${failure} — read-only run, not blocking; an --execute run would refuse here`,
      failure,
      provenance,
    }
  }
  if (options.allowNonMain) {
    provenance.overrideUsed = true
    return {
      allow: true,
      reason: `${failure} — overridden by --allow-non-main (break-glass)`,
      failure,
      provenance,
    }
  }
  return {
    allow: false,
    reason:
      `${failure}. Refusing to execute a fleet rollout without origin/main provenance; ` +
      "pass --allow-non-main only for a deliberate, reviewed break-glass run",
    failure,
    provenance,
  }
}

/**
 * The OTHER side of the seam: the shard/wrangler config that tells the fleet
 * machinery which databases exist lives in the api repo, and nothing used to
 * attest that checkout — a fleet tool once resolved its shard config from a
 * STALE api checkout and confidently inventoried 26 of ~205 bindings.
 */
export type ConfigRepoProbe = {
  /** The config path the run was pointed at (e.g. --wrangler-config). */
  configPath: string
  /** Git toplevel containing the config; null when the path is not in a repo. */
  repoPath: string | null
  probe: RolloutProvenanceProbe
}

/**
 * Resolve the git repository containing `configPath` and probe THAT repo with
 * the same rigor as the executing checkout. A config path that is not inside a
 * git repository is not an exception — it is a probe whose gitError the
 * decision fails closed on for --execute (operators sometimes point at plain
 * config dirs; --allow-non-main is the documented way out).
 */
export function probeConfigRepoProvenance(configPath: string): ConfigRepoProbe {
  const top = git(dirname(resolve(configPath)), ["rev-parse", "--show-toplevel"])
  if (!top.ok || !top.stdout) {
    return {
      configPath,
      repoPath: null,
      probe: {
        headSha: null,
        branch: null,
        detached: false,
        originMainSha: null,
        onMain: null,
        dirty: null,
        gitError: "not inside a git repository",
      },
    }
  }
  return { configPath, repoPath: top.stdout, probe: probeRolloutProvenance(top.stdout) }
}

/** Manifest record for the config-side checkout. */
export type ConfigProvenanceRecord = {
  repoPath: string | null
  headSha: string | null
  /** Branch name, or "(detached)". */
  branch: string
  onMain: boolean | null
  dirty: boolean | null
}

/** The composed both-sides decision the fleet machinery enforces. */
export type FleetProvenanceDecision = {
  allow: boolean
  /** Combined message; each side's segment is prefixed with its label. */
  reason: string
  overrideUsed: boolean
  /** Which side(s) the --allow-non-main override actually covered. */
  overriddenSides: Array<"core" | "config">
  /** Manifest record for the executing checkout, with the override detail. */
  coreRecord: RolloutProvenanceRecord & { overriddenSides: Array<"core" | "config"> }
  /** Manifest record for the config checkout. */
  configRecord: ConfigProvenanceRecord
  /** Per-side failures (null when proven); drives read-only loud warnings. */
  coreFailure: string | null
  configFailure: string | null
}

/**
 * Compose both sides: refuse an --execute run unless the core checkout AND the
 * config checkout are each main-contained and clean. A single --allow-non-main
 * covers whichever side(s) failed, recorded per side. Read-only runs always
 * allow; the per-side failure fields let callers warn loudly instead.
 */
export function decideFleetProvenance(input: {
  core: RolloutProvenanceProbe
  config: ConfigRepoProbe
  execute: boolean
  allowNonMain: boolean
}): FleetProvenanceDecision {
  const options = { execute: input.execute, allowNonMain: input.allowNonMain }
  const core = decideRolloutProvenance(input.core, options)
  const config = decideRolloutProvenance(input.config.probe, options)

  const overriddenSides: Array<"core" | "config"> = []
  if (core.provenance.overrideUsed) overriddenSides.push("core")
  if (config.provenance.overrideUsed) overriddenSides.push("config")

  const configLabel = `config checkout (${input.config.repoPath ?? input.config.configPath})`
  return {
    allow: core.allow && config.allow,
    reason: [`core checkout: ${core.reason}`, `${configLabel}: ${config.reason}`].join("\n"),
    overrideUsed: overriddenSides.length > 0,
    overriddenSides,
    coreRecord: { ...core.provenance, overrideUsed: overriddenSides.length > 0, overriddenSides },
    configRecord: {
      repoPath: input.config.repoPath,
      headSha: config.provenance.headSha,
      branch: config.provenance.branch,
      onMain: config.provenance.onMain,
      dirty: config.provenance.dirty,
    },
    coreFailure: core.failure,
    configFailure: config.failure,
  }
}
