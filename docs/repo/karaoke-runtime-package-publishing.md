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
**exact version with an integrity hash**; builds embed runtime provenance. **No code is moved
between repositories** until package ownership is formally settled.

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
  GH Packages is free for private packages, supports immutable versions, and reuses GitHub
  auth/CI — no new registry infra (Verdaccio/Artifactory) to operate.
- Alternatives considered: npmjs private (extra cost/account), self-hosted (ops burden),
  Cloudflare (no first-class npm registry). GH Packages is lowest-friction for this org.
- The package is `private` and scoped; access is org-membership + token-gated (§5).

## 3. Versioning & release workflow

- **SemVer** for the package, independent of the in-code markers (`KARAOKE_SCORING_VERSION`,
  transport/binary protocol versions). Public-surface or scoring change ⇒ at least a minor/major.
- **Immutable releases:** never republish a version. Every change bumps. GH Packages enforces
  no-overwrite.
- **Workflow** (`web` repo GH Action, e.g. `publish-karaoke-runtime.yml`):
  1. Trigger on a tag `karaoke-runtime-vX.Y.Z` (or a release PR that bumps
     `packages/karaoke-runtime/package.json`).
  2. Build + run the package's own tests (`bun test` in the package).
  3. **Guard:** fail publish if `KARAOKE_SCORING_VERSION` changed without a SemVer bump, and if
     the tag version ≠ `package.json` version.
  4. Run the cross-repo compatibility job (§7) against the API.
  5. `bun publish` (or `npm publish`) to GH Packages.
- First publish: `0.1.0` cut from the current source commit
  (`web release/karaoke-web @42fbce9f` — `uncertainLineCount` + `KARAOKE_SCORING_VERSION=1`).

## 4. API lockfile pinning — no ranges

- API `services/api/package.json`: `"@pirate/karaoke-runtime": "0.1.0"` — **exact**, never
  `^`/`~`/`*`/`file:`. Same rule anywhere the package is consumed.
- `bun.lock` records the resolved version **and integrity hash**; CI installs with
  `bun install --frozen-lockfile` (fails on drift). A version bump is an explicit API PR.
- Add a CI lint that rejects any non-exact spec for `@pirate/*`.

## 5. CI authentication & install procedure

- Registry config (committed) — `bunfig.toml` / `.npmrc` in the API repo:
  ```
  [install.scopes]
  "@pirate" = { registry = "https://npm.pkg.github.com", token = "$NPM_GITHUB_TOKEN" }
  ```
  (npm equivalent: `@pirate:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${NPM_GITHUB_TOKEN}`.)
- **Token:** read access to org packages. In the API repo's own CI, `GITHUB_TOKEN` with
  `packages: read` suffices for same-org packages. For cross-repo/headless (cron) runners, use a
  fine-grained PAT or GitHub App token with `read:packages`, stored as the `NPM_GITHUB_TOKEN`
  secret. Publish job uses a token with `write:packages`.
- Install: `bun install --frozen-lockfile`. Local dev uses the same `.npmrc` with a personal
  `read:packages` token (documented in the API README).

## 6. Source commit/version provenance embedded in builds

- The published package **embeds its source provenance**: the publish job writes the git SHA
  into the package (e.g. `package.json` `gitHead` is automatic for npm, plus an explicit
  exported `export const KARAOKE_RUNTIME_BUILD = { version: "0.1.0", gitSha: "42fbce9f" }`).
- The **API build records** the resolved runtime version + integrity hash (from `bun.lock`) and
  the runtime's `gitSha` into worker build vars alongside the existing `BUILD_GIT_SHA`, and
  surfaces them on `/__version` (e.g. `karaoke_runtime: { version, gitSha, integrity }`). A
  deployed API can then be audited for exactly which runtime it bundled — the provenance the
  spec §9a requires.

## 7. Coordinated runtime/API compatibility testing

- **Contract test** (lives with the package or a shared location): asserts the public surface
  the API relies on — presence/types of `KARAOKE_SCORING_VERSION`, `uncertainLineCount` on
  `KaraokeSessionSummary`, `aggregateKaraokeSession`, serialize/deserialize.
- **Pre-publish compatibility job** (web CI, §3.4): install the candidate version into a clean
  API checkout, run API karaoke tests + typecheck (the manual verification done for
  `42fbce9f`, automated). Publish is gated on it passing.
- **API-side**: bumping the pinned version is a PR that runs the full API karaoke suite under
  `--frozen-lockfile`. A scoring-version change is called out in the PR for deploy coordination.

## 8. Migration away from the `file:` dependency

1. Land the publish workflow in `web`; cut `@pirate/karaoke-runtime@0.1.0` from the current
   source. Verify the published tarball contains the same surface as `42fbce9f`.
2. In `api`: add the registry config (§5); replace the `file:` spec with `"0.1.0"`.
3. `bun install --frozen-lockfile` → lockfile pins version + integrity.
4. Run the compatibility checks (§7) + an API prod build; confirm `/__version` reports the
   pinned version/gitSha/integrity.
5. Remove the `file:` path and delete the workstation-layout assumption from docs/CI.
   `web` continues to consume its local workspace source.
6. **Only now** does the spec §9a gate lift and persistence (migration `1101`, DO finalize,
   endpoints) may begin.

## 9. Rollback procedure

- Versions are immutable + pinned, so rollback is deterministic:
  - **Dependency rollback:** repoint API `package.json` to the previous exact version,
    `bun install --frozen-lockfile`, redeploy. No unpublish/mutate.
  - **Bad published version:** never overwrite; publish a new patch that reverts the change,
    then pin to it. Yank/deprecate the bad version (GH Packages: mark deprecated) but do not
    delete (preserves provenance/repro).
  - **Deploy rollback:** keep the previous API worker version live until the new build's
    `/__version` provenance is verified; revert to it if compatibility checks regress in prod.
- Because `scoring_version` filters rankings, a runtime rollback that changes scores is also a
  `scoring_version` consideration — coordinate per the spec (old version's attempts retire from
  the active board automatically).

## Out of scope (explicit)

- Relocating the runtime source between repositories — deferred until ownership is settled.
- Any persistence/schema/endpoint work — gated on steps §8.1–§8.5 completing in production.
