# AI Infisical Boundary

Defines the minimum secret-boundary policy for AI-assisted workflows in the Pirate workspace.

## Rule

AI environments must not have Infisical auth.

Repo-level policy:

- repo root `.infisical.json` is non-prod only (`pirate-dev-staging`)
- production must use a separate human-only project config directory such as `ops/prod`
- AI shells must not use `--project-config-dir=ops/prod`

This includes:

- no Infisical service token in AI runtime env
- no account-scoped Infisical credentials on agent machines by default
- no automatic secret pulls from AI workflows

## Allowed Inputs

AI workflows may operate on:

- version-controlled config
- checked-in public addresses, action CIDs, and RPC URLs
- user-provided environment variables for a specific local session
- redacted logs or redacted config snapshots

## Not Allowed

AI workflows must not:

- fetch secrets directly from Infisical
- persist raw secrets into repo files
- write secret values into machine-readable config inventories
- expand access from one approved secret to broader secret inventory access

## Follow-Up

Later revisions may define tighter rules for:

- human-approved one-shot secret injection
- local development escape hatches
- audit logging for operator-assisted secret use
