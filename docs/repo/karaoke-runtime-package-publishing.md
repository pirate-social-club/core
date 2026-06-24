# Proposal: publish `@pirate/karaoke-runtime` as a pinned private package

Status: implementation-ready proposal. **Blocks karaoke persistence** (see
`specs/domain/karaoke-rankings.md` §9a). No persistence work begins until the API consumes
the runtime through the mechanism below.

## Problem

The API depends on the scoring runtime via
`"@pirate/karaoke-runtime": "file:../../../web-karaoke-rel/packages/karaoke-runtime"`.
This is **workstation-layout coupling**: the relative path only resolves when `web-karaoke-rel`
sits as a sibling worktree. A clean checkout or CI runner cannot resolve it, and a dev-box
reinstall does not prove what a production build bundles. While `scoring_version` is meant to
guarantee rank comparability across environments, today nothing guarantees two environments
even built from the same runtime source. This must be fixed before any score is persisted.

## Decision summary

Publish `@pirate/karaoke-runtime` as an **immutable, private, SemVer'd package** from its
**current canonical source** (the `web` repo's `packages/karaoke-runtime`). The API pins an
**exact version with a validated integrity value or a checked-in SHA-256** (§4); builds embed
runtime provenance. **No code is moved between repositories** until package ownership is
formally settled.

---

## 1. Package ownership & canonical repository

- **Canonical source stays put for now:** `web` repo, `packages/karaoke-runtime`. It is today
  the only git-tracked runtime source; relocating it is a separate, larger decision and is
  explicitly **out of scope** until ownership is settled (avoid moving code between repos now).
- **Ownership:** the runtime is a shared contract consumed by `web` and `api`. Assign a single
  owning team and add a `CODEOWNERS` entry for `packages/karaoke-runtime/**` so contract
  changes require owner review. Changes to the public surface (exports, `KaraokeSessionSummary`,
  `KARAOKE_SCORING_VERSION`) are contract changes.
- **Publisher:** the `web` repo publishes the package via CI (below). `web` itself keeps
  consuming the local workspace source (it owns it); only `api` consumes the published artifact.
  This avoids `web` depending on its own published output.
- **Deferred:** a dedicated repo or true shared monorepo location is a later option, revisited
  only after ownership is settled and publishing is proven.

## 2. Registry: GitHub Packages (recommended)

- Publish to **GitHub Packages npm registry**, scope `@pirate` →
  `https://npm.pkg.github.com`. Rationale: the org (`pirate-social-club`) is already on GitHub;
  it reuses GitHub auth/CI — no new registry infra (Verdaccio/Artifactory) to operate.
- **Cost/limits are a precondition, not an assumption.** Before adopting, confirm the org's
  GitHub plan and GitHub Packages **storage and data-transfer quotas/pricing** for private
  packages (these vary by plan and are billable past quota). Record the confirmed plan + limits
  in this doc before first publish.
- **Immutability is not guaranteed by the registry** — GitHub Packages permits version deletion
  and does not hard-block all overwrites. We enforce immutability as **policy** (§3):
  pre-publish existence check + restricted deletion permissions.
- Alternatives considered: npmjs private (extra cost/account), self-hosted (ops burden),
  Cloudflare (no first-class npm registry). GH Packages is lowest-friction for this org.
- "Private" means **registry visibility**, not `package.json`. The manifest **must NOT set
  `"private": true`** (that blocks publishing entirely); access is gated by the registry's
  private visibility + org-membership/tokens (§5).

## 3. Versioning & release workflow

- **SemVer** for the package, independent of the in-code markers (`KARAOKE_SCORING_VERSION`,
  transport/binary protocol versions). Public-surface or scoring change ⇒ at least a minor/major.
- **Immutability is enforced as policy** (the registry does not guarantee it): the publish job
  **queries the registry and fails if the target version already exists** (`npm view
  @pirate/karaoke-runtime@X.Y.Z` returns a version ⇒ abort), and org settings **restrict
  package deletion** to an owner role. Every change bumps; a version is never re-published.
- **Workflow** (`web` repo GH Action, e.g. `publish-karaoke-runtime.yml`) — build, pack, test
  the *artifact*, then publish that exact artifact:
  1. Trigger on a tag `karaoke-runtime-vX.Y.Z` (or a release PR that bumps
     `packages/karaoke-runtime/package.json`).
  2. **Guard:** fail if the tag version ≠ `package.json` version; fail if
     `KARAOKE_SCORING_VERSION` changed without a SemVer bump.
  3. **Existence check:** fail if `X.Y.Z` already exists in the registry.
  4. Build + run the package's own tests; generate provenance into the build output (§6).
  5. **Pack the candidate tarball** (`npm pack` / `bun pm pack`) and record its SHA-256.
  6. **Compatibility job (§7): install *that tarball* into a clean API checkout** and run API
     karaoke tests + typecheck. (You cannot install an unpublished "version" — only the packed
     artifact.)
  7. **Publish the exact tested tarball** (`npm publish <tarball>`), not a re-pack, so the
     published bytes equal the tested bytes. Verify the published tarball's SHA-256 matches the
  packed tarball recorded in §3.5 / §6.
- First publish: `0.1.0` cut from the current source commit
  (`web release/karaoke-web @42fbce9f` — `uncertainLineCount` + `KARAOKE_SCORING_VERSION=1`).

## 4. API lockfile pinning — no ranges

- API `services/api/package.json`: `"@pirate/karaoke-runtime": "0.1.0"` — **exact**, never
  `^`/`~`/`*`/`file:`. Same rule anywhere the package is consumed. CI lint rejects any
  non-exact spec for `@pirate/*`.
- **Lockfile update vs. frozen install are distinct steps.** `bun install --frozen-lockfile`
  cannot create or update the lockfile after a `package.json` change — it only validates.
  Therefore: a version bump is an explicit API PR that runs a **normal `bun install` once** to
  update `bun.lock`, **commits the lockfile**, and only then does **CI use
  `--frozen-lockfile`** (fails on any drift).
- **Integrity must be verified, not assumed.** Confirm whether Bun's `bun.lock` records a
  usable per-package registry **integrity** (SRI) value for GH Packages deps. If it does, CI
  relies on `--frozen-lockfile` integrity enforcement. **If it does not**, record the published
  tarball's **SHA-256** (from §3.5/§6) in a checked-in manifest and add a CI step that
  re-hashes the resolved package and fails on mismatch. (Verification item — settle before
  migration §8.)

## 5. CI authentication & install procedure

- Registry config (committed) — `bunfig.toml` / `.npmrc` in the API repo:
  ```
  [install.scopes]
  "@pirate" = { registry = "https://npm.pkg.github.com", token = "$NPM_GITHUB_TOKEN" }
  ```
  (npm equivalent: `@pirate:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${NPM_GITHUB_TOKEN}`.)
- **Decision — use the per-job Actions `GITHUB_TOKEN` for CI; a fine-grained PAT off-Actions.**
  This is the proven path against the GH Packages **npm** registry and needs no standing secret:
  - **Publish (web Actions):** the workflow's `GITHUB_TOKEN` with `permissions: { contents:
    read, packages: write }`. It is itself the built-in Actions App's short-lived installation
    token, documented to authenticate npm against `npm.pkg.github.com`, auto-rotated per job.
  - **Consume (api Actions):** grant the published package **repository read access to `api`**
    (package settings → repository access); the api workflow's `GITHUB_TOKEN` with
    `permissions: { packages: read }` then resolves it cross-repo. No PAT in CI.
  - **Off-Actions (local dev, cron/headless runners with no `GITHUB_TOKEN`):** a single
    **fine-grained PAT** scoped to `read:packages` on this package, stored as `NPM_GITHUB_TOKEN`,
    documented expiry, **rotation owner = the runtime-owning team** (the CODEOWNERS owner, §1).
- **Custom GitHub App — not adopted as primary (unvalidated for the npm registry).** A custom
  App installation token's support against `npm.pkg.github.com` is not confirmed here (the
  proven installation token for this registry is the Actions one above). **Blocker resolution:**
  do not depend on a custom App. A custom App/token-broker may replace the PAT later *only after
  a spike proves* `bun`/`npm` authenticates to `npm.pkg.github.com` with its installation token
  and `packages` permission; until then the PAT fallback is the selected off-Actions mechanism.
- **Cross-repo read** is solved by the package's repository-access grant (above) + the
  consumer's `GITHUB_TOKEN`, not by a cross-repo token.
- Install: normal `bun install` to (re)generate the lockfile on a bump, then
  `bun install --frozen-lockfile` in CI (§4). Local dev uses the same scope config with a
  developer `read:packages` token (documented in the API README).

## 6. Source commit/version provenance embedded in builds

- **Provenance is a build/pack artifact, not a publish-time source edit.** The **build step**
  emits a generated `build-info.json` (version + `gitSha`) into the dist output (never writing
  into committed `src/`); the package re-exports it as `KARAOKE_RUNTIME_BUILD = { version,
  gitSha }` from the built entry. The **pack/publish job verifies the packed tarball contains**
  `build-info.json` with the expected version+SHA (inspect `npm pack` contents) and **fails if
  absent or mismatched** — so what ships carries provenance.
- The **API build records** the resolved runtime version, the package's `gitSha` (from
  `KARAOKE_RUNTIME_BUILD`), and the validated tarball **SHA-256** (§4), into worker build vars
  alongside the existing `BUILD_GIT_SHA`, surfaced on `/__version` (e.g.
  `karaoke_runtime: { version, gitSha, sha256 }`). A deployed API is then auditable for exactly
  which runtime it bundled — the provenance spec §9a requires.

## 7. Coordinated runtime/API compatibility testing

- **Contract test** (lives with the package or a shared location): asserts the public surface
  the API relies on — presence/types of `KARAOKE_SCORING_VERSION`, `uncertainLineCount` on
  `KaraokeSessionSummary`, `aggregateKaraokeSession`, serialize/deserialize.
- **Pre-publish compatibility job** (web CI, §3.6): install the **packed candidate tarball**
  (not an unpublished "version") into a clean API checkout — installing the API's required
  workspaces too (e.g. `services/shared`, which the karaoke tests transitively need) — then run
  API karaoke tests + typecheck (the manual `42fbce9f` verification, automated). The **exact
  tested tarball is what gets published** (§3.7). Publish is gated on this passing.
- **API-side**: bumping the pinned version is a PR that runs the full API karaoke suite under
  `--frozen-lockfile`. A scoring-version change is called out in the PR for deploy coordination.

## 8. Migration away from the `file:` dependency

1. Land the publish workflow in `web`; cut `@pirate/karaoke-runtime@0.1.0` from the current
   source. Verify the published tarball contains the same surface as `42fbce9f`.
2. In `api`: add the registry config (§5); replace the `file:` spec with exact `"0.1.0"`.
3. Run a **normal `bun install` once** to generate/update `bun.lock` (pins version; records
   integrity per §4), review and **commit the lockfile**. CI thereafter uses
   `--frozen-lockfile`.
4. Run the compatibility checks (§7) + an API prod build; confirm `/__version` reports the
   pinned version/gitSha/sha256.
5. Remove the `file:` path and delete the workstation-layout assumption from docs/CI.
   `web` continues to consume its local workspace source.
6. **Only now** does the spec §9a gate lift and persistence (migration `1101`, DO finalize,
   endpoints) may begin.

## 9. Rollback procedure

- Versions are immutable + pinned, so package rollback is deterministic:
  - **Dependency rollback:** repoint API `package.json` to the previous exact version, run a
    **normal `bun install`** to update `bun.lock` (frozen install can't rewrite it), commit the
    lockfile, then redeploy via the frozen-install CI path. No unpublish/mutate.
  - **Bad published version:** never overwrite; publish a new patch that reverts, then pin to
    it. Deprecate the bad version (do not delete — preserves provenance/repro).
  - **Deploy rollback:** keep the previous API worker version live until the new build's
    `/__version` provenance is verified; revert to it if compatibility checks regress in prod.
- **Package rollback and scoring-version compatibility are separate decisions.** A
  `scoring_version` must map to **exactly one scoring behavior, forever**. Rolling the package
  back to an older SemVer is fine *only if* its scoring behavior is identical to what attempts
  already persisted under that `scoring_version` used. If the rolled-back code would score
  differently from already-persisted attempts, you must **not reuse the old
  `KARAOKE_SCORING_VERSION`** — roll the scoring version *forward* (a new value) so no version
  number ever aliases two behaviors. The rankings query then retires the now-incomparable
  attempts automatically (per the spec). Never let a rollback silently regrade existing
  leaderboards.

## Out of scope (explicit)

- Relocating the runtime source between repositories — deferred until ownership is settled.
- Any persistence/schema/endpoint work — gated on steps §8.1–§8.5 completing in production.
