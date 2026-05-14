# GitHub Actions Infisical OIDC Delivery

This runbook defines the target model for delivering Pirate CI/CD secrets from
Infisical to GitHub Actions without keeping long-lived Infisical credentials in
GitHub.

## Target Model

- Infisical remains the canonical source for real secrets.
- GitHub Actions fetches secrets at runtime with OIDC and a scoped Infisical
  machine identity.
- GitHub Actions repository secrets are kept only for workflows that have not
  been migrated yet or for GitHub-native tokens.
- Public build configuration stays in GitHub Actions variables.
- AI sessions must not browse Infisical or print secret values. See
  [AI Infisical Boundary](../control-plane/ai-infisical-boundary.md).

Pirate workflows use GitHub OIDC tokens directly and fetch allowed secrets by
name from the Infisical API. The machine identity ID is not a secret and may be
committed, but the identity must be configured in Infisical before any workflow
uses it.

Pirate project config:

- project slug: `pirate-dev-pr33`
- project id: `5acea78e-7813-4d8a-b29c-9b862a0b1c71`
- hosted environment slugs currently used by the repo: `staging`, `prod`

## Human Setup In Infisical

For each repo/workflow boundary that needs runtime secrets, create a separate
machine identity. Start with the narrowest production-secret workflows.

Recommended identities:

| Identity | Identity ID | Repository | Environment | Secret path | Intended workflows |
|---|---|---|---|---|---|
| `github-core-prod-migration-doctor` | `ec0ad659-af1c-4009-a845-9e6092cc062b` | `pirate-social-club/core` | `prod` | `/services/api` | `community-migration-doctor.yml` DB job |
| `github-core-prod-migration-repair` | `3141c3e2-a32c-4299-9382-c2684d11fe06` | `pirate-social-club/core` | `prod` | `/services/api` | `community-migration-repair.yml` DB job |
| `github-core-staging-migration-repair` | `ddbd02c6-359a-42c1-9cb7-d4ed0eb86be7` | `pirate-social-club/core` | `staging` | `/services/api` | `community-migration-repair.yml` DB job |
| `github-web-staging-release` | TBD | `pirate-social-club/web` | `staging` | `/services/api` | release staging smoke and migration steps |

For each identity:

1. Add the machine identity to the Pirate Infisical project.
2. Replace the default auth method with OIDC auth.
3. Configure GitHub as the OIDC provider:
   - discovery URL: `https://token.actions.githubusercontent.com`
   - issuer: `https://token.actions.githubusercontent.com`
   - audience: the GitHub organization URL, for example
     `https://github.com/pirate-social-club`
4. Pin the subject to the exact repository and context. Prefer environment or
   branch-specific subjects over wildcards.
5. Grant read access only to the required environment and path.
6. Record the machine identity ID in the relevant workflow PR. The identity ID
   is public config, not a secret.

Do not give a single identity access to every repo, environment, or path.

## Workflow Pattern

Each workflow that uses OIDC must request an OIDC token:

```yaml
permissions:
  contents: read
  id-token: write
```

Fetch secrets immediately before the step that needs them:

```yaml
- name: Fetch Infisical secrets
  env:
    INFISICAL_IDENTITY_ID: "<machine-identity-id>"
    INFISICAL_PROJECT_ID: 5acea78e-7813-4d8a-b29c-9b862a0b1c71
    INFISICAL_ENV: prod
    INFISICAL_SECRET_PATH: /services/api
    SECRET_NAMES: CONTROL_PLANE_DATABASE_URL TURSO_COMMUNITY_DB_WRAP_KEY
  run: scripts/ci/fetch-infisical-secrets.sh

- name: Run secret-bearing command
  run: |
    test -n "$CONTROL_PLANE_DATABASE_URL"
    test -n "$TURSO_COMMUNITY_DB_WRAP_KEY"
    bun scripts/community/apply-remote-community-migrations.ts
```

Rules:

- Fetch secrets only in the job that needs them.
- Keep dependency install and audit jobs secret-free.
- Keep `npm ci --ignore-scripts` in secret-bearing jobs unless install scripts
  are explicitly required.
- Never print secret values. Use `test -n "$NAME"` checks only.
- Prefer separate identities for doctor, repair, deploy, and release workflows
  when their blast radius differs.
- Use `scripts/ci/fetch-infisical-secrets.sh` for repo-local workflows so OIDC
  login, masking, and `$GITHUB_ENV` export behavior stay consistent.
- The script reads each allowed secret by name with Infisical v4
  `GET /secrets/{secretName}`. That matches `secretName`-scoped identity
  privileges and avoids broad path-list reads.

## Migration Status

`core/.github/workflows/community-migration-doctor.yml` is migrated to Infisical
OIDC for production.

`core/.github/workflows/community-migration-repair.yml` is migrated to Infisical
OIDC for production and staging with separate identities.

The first production migration target was `community-migration-doctor.yml`
because:

- It is read-only.
- It already separates dependency audit from the production-secret DB job.
- The secret surface is small:
  - `CONTROL_PLANE_DATABASE_URL`
  - `TURSO_COMMUNITY_DB_WRAP_KEY`
- It does not need Cloudflare, Apple signing, or browser test credentials.

Next migration candidates:

1. Remove core staging GitHub repository secrets after a successful staging
   repair run proves the runtime fetch works.
2. Migrate web staging release secrets if the workflow remains stable.

## Secret Sync Alternative

If runtime OIDC injection is not operationally ready, use Infisical GitHub
Secret Syncs as an interim control. That keeps GitHub Actions secrets as the
delivery layer, but Infisical pushes updates into GitHub so rotations do not
depend on a manual copy.

Secret Syncs are weaker than runtime OIDC because secrets still exist as GitHub
repository secrets, but they are stronger than manual rotation because Infisical
remains the enforced source of truth.

## Acceptance Criteria

For each migrated workflow:

- The Infisical machine identity subject is pinned to the intended repository
  and branch or environment.
- The workflow has `id-token: write` only where needed.
- The workflow no longer references the migrated `secrets.*` values.
- The secret-bearing job still runs after no-secret dependency gates.
- The workflow has passed end-to-end once.
- The old GitHub repository secrets have been deleted after the successful run.

## References

- Infisical GitHub Actions integration:
  <https://infisical.com/docs/integrations/cicd/githubactions>
