import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  decideRolloutProvenance,
  probeRolloutProvenance,
  type RolloutProvenanceProbe,
} from "./rollout-provenance"

/** A fabricated clean-on-main probe; tests override one fact at a time. */
function fabricatedProbe(overrides: Partial<RolloutProvenanceProbe> = {}): RolloutProvenanceProbe {
  return {
    headSha: "a".repeat(40),
    branch: "main",
    detached: false,
    originMainSha: "b".repeat(40),
    onMain: true,
    dirty: false,
    ...overrides,
  }
}

describe("decideRolloutProvenance — the decision matrix", () => {
  test("execute from a clean on-main checkout: allow, no override", () => {
    const decision = decideRolloutProvenance(fabricatedProbe(), { execute: true, allowNonMain: false })
    expect(decision.allow).toBe(true)
    expect(decision.reason).toContain("contained in origin/main")
    expect(decision.provenance).toEqual({
      headSha: "a".repeat(40),
      branch: "main",
      onMain: true,
      dirty: false,
      overrideUsed: false,
    })
  })

  test("execute with a dirty tree: refuse", () => {
    const decision = decideRolloutProvenance(fabricatedProbe({ dirty: true }), {
      execute: true,
      allowNonMain: false,
    })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toContain("dirty")
    expect(decision.provenance.overrideUsed).toBe(false)
  })

  test("execute from a side branch: refuse, pointing at origin/main and the break-glass flag", () => {
    const decision = decideRolloutProvenance(
      fabricatedProbe({ branch: "feat/some-side-branch", onMain: false }),
      { execute: true, allowNonMain: false },
    )
    expect(decision.allow).toBe(false)
    expect(decision.reason).toContain("not contained in origin/main")
    expect(decision.reason).toContain("--allow-non-main")
  })

  test("execute from a detached HEAD at a main-contained sha: allow", () => {
    const decision = decideRolloutProvenance(
      fabricatedProbe({ branch: null, detached: true }),
      { execute: true, allowNonMain: false },
    )
    expect(decision.allow).toBe(true)
    expect(decision.provenance.branch).toBe("(detached)")
  })

  test("execute with a missing origin/main ref: fail closed, telling the operator to fetch", () => {
    const decision = decideRolloutProvenance(
      fabricatedProbe({ originMainSha: null, onMain: null }),
      { execute: true, allowNonMain: false },
    )
    expect(decision.allow).toBe(false)
    expect(decision.reason).toContain("git fetch origin main")
  })

  test("execute when git itself failed: fail closed", () => {
    const decision = decideRolloutProvenance(
      fabricatedProbe({
        headSha: null,
        branch: null,
        originMainSha: null,
        onMain: null,
        dirty: null,
        gitError: "fatal: not a git repository",
      }),
      { execute: true, allowNonMain: false },
    )
    expect(decision.allow).toBe(false)
    expect(decision.reason).toContain("cannot determine git provenance")
  })

  test("execute off-main with --allow-non-main: allow, recorded as an override", () => {
    const decision = decideRolloutProvenance(
      fabricatedProbe({ branch: "feat/side", onMain: false }),
      { execute: true, allowNonMain: true },
    )
    expect(decision.allow).toBe(true)
    expect(decision.reason).toContain("break-glass")
    expect(decision.provenance.overrideUsed).toBe(true)
    expect(decision.provenance.onMain).toBe(false)
  })

  test("execute dirty with --allow-non-main: allow, recorded as an override", () => {
    const decision = decideRolloutProvenance(fabricatedProbe({ dirty: true }), {
      execute: true,
      allowNonMain: true,
    })
    expect(decision.allow).toBe(true)
    expect(decision.provenance.overrideUsed).toBe(true)
  })

  test("execute with a missing origin/main ref and --allow-non-main: allow, recorded", () => {
    const decision = decideRolloutProvenance(
      fabricatedProbe({ originMainSha: null, onMain: null }),
      { execute: true, allowNonMain: true },
    )
    expect(decision.allow).toBe(true)
    expect(decision.provenance.overrideUsed).toBe(true)
  })

  test("read-only passes never block — even off-main and dirty — but carry the facts", () => {
    const decision = decideRolloutProvenance(
      fabricatedProbe({ branch: "feat/side", onMain: false, dirty: true }),
      { execute: false, allowNonMain: false },
    )
    expect(decision.allow).toBe(true)
    expect(decision.reason).toContain("read-only")
    expect(decision.reason).toContain("would refuse")
    expect(decision.provenance.onMain).toBe(false)
    expect(decision.provenance.dirty).toBe(true)
    expect(decision.provenance.overrideUsed).toBe(false)
  })

  test("read-only from a clean on-main checkout: allow, plain reason", () => {
    const decision = decideRolloutProvenance(fabricatedProbe(), { execute: false, allowNonMain: false })
    expect(decision.allow).toBe(true)
    expect(decision.reason).toContain("contained in origin/main")
  })
})

const tempDirs: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rollout-provenance-"))
  tempDirs.push(dir)
  git(dir, ["init", "-q", "-b", "main"])
  git(dir, ["config", "user.name", "Rollout Provenance Test"])
  git(dir, ["config", "user.email", "rollout-provenance@example.invalid"])
  git(dir, ["config", "commit.gpgsign", "false"])
  writeFileSync(join(dir, "file.txt"), "one\n")
  git(dir, ["add", "."])
  git(dir, ["commit", "-q", "-m", "initial"])
  return dir
}

/** Stand in for a fetched remote-tracking ref without any network. */
function trackOriginMain(dir: string, ref = "HEAD"): void {
  git(dir, ["update-ref", "refs/remotes/origin/main", ref])
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe("probeRolloutProvenance — against real temp git repos (no network)", () => {
  test("a clean main checkout with origin/main tracked: on-main and clean", () => {
    const dir = makeRepo()
    trackOriginMain(dir)
    const probe = probeRolloutProvenance(dir)
    expect(probe.gitError).toBeUndefined()
    expect(probe.headSha).toMatch(/^[0-9a-f]{40}$/u)
    expect(probe.branch).toBe("main")
    expect(probe.detached).toBe(false)
    expect(probe.originMainSha).toBe(probe.headSha)
    expect(probe.onMain).toBe(true)
    expect(probe.dirty).toBe(false)
    expect(decideRolloutProvenance(probe, { execute: true, allowNonMain: false }).allow).toBe(true)
  })

  test("a repo without a local origin/main ref: undecidable, fails closed for execute", () => {
    const dir = makeRepo()
    const probe = probeRolloutProvenance(dir)
    expect(probe.originMainSha).toBeNull()
    expect(probe.onMain).toBeNull()
    const decision = decideRolloutProvenance(probe, { execute: true, allowNonMain: false })
    expect(decision.allow).toBe(false)
    expect(decision.reason).toContain("git fetch origin main")
  })

  test("a side-branch HEAD is not contained in origin/main", () => {
    const dir = makeRepo()
    trackOriginMain(dir)
    git(dir, ["checkout", "-q", "-b", "feat/side"])
    writeFileSync(join(dir, "side.txt"), "side\n")
    git(dir, ["add", "."])
    git(dir, ["commit", "-q", "-m", "side work"])
    const probe = probeRolloutProvenance(dir)
    expect(probe.branch).toBe("feat/side")
    expect(probe.onMain).toBe(false)
    expect(decideRolloutProvenance(probe, { execute: true, allowNonMain: false }).allow).toBe(false)
  })

  test("a detached HEAD at a main-contained sha probes as on-main", () => {
    const dir = makeRepo()
    trackOriginMain(dir)
    git(dir, ["checkout", "-q", "--detach", "HEAD"])
    const probe = probeRolloutProvenance(dir)
    expect(probe.detached).toBe(true)
    expect(probe.branch).toBeNull()
    expect(probe.onMain).toBe(true)
    expect(probe.dirty).toBe(false)
    const decision = decideRolloutProvenance(probe, { execute: true, allowNonMain: false })
    expect(decision.allow).toBe(true)
    expect(decision.provenance.branch).toBe("(detached)")
  })

  test("an uncommitted change and an untracked file both count as dirty", () => {
    const dir = makeRepo()
    trackOriginMain(dir)
    writeFileSync(join(dir, "file.txt"), "modified\n")
    expect(probeRolloutProvenance(dir).dirty).toBe(true)
    git(dir, ["checkout", "-q", "--", "file.txt"])
    expect(probeRolloutProvenance(dir).dirty).toBe(false)
    writeFileSync(join(dir, "untracked.txt"), "new\n")
    expect(probeRolloutProvenance(dir).dirty).toBe(true)
  })

  test("a non-git directory probes as an error, never as a pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "rollout-provenance-nogit-"))
    tempDirs.push(dir)
    const probe = probeRolloutProvenance(dir)
    expect(probe.headSha).toBeNull()
    expect(probe.gitError).toBeDefined()
    expect(decideRolloutProvenance(probe, { execute: true, allowNonMain: false }).allow).toBe(false)
  })
})
