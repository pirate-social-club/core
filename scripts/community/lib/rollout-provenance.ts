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
      provenance,
    }
  }
  if (!options.execute) {
    // A read-only pass never blocks — but its log must still carry the facts.
    return {
      allow: true,
      reason: `${failure} — read-only run, not blocking; an --execute run would refuse here`,
      provenance,
    }
  }
  if (options.allowNonMain) {
    provenance.overrideUsed = true
    return {
      allow: true,
      reason: `${failure} — overridden by --allow-non-main (break-glass)`,
      provenance,
    }
  }
  return {
    allow: false,
    reason:
      `${failure}. Refusing to execute a fleet rollout without origin/main provenance; ` +
      "pass --allow-non-main only for a deliberate, reviewed break-glass run",
    provenance,
  }
}
