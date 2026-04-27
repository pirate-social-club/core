# AI Infisical Boundary

Defines the minimum secret-boundary policy for AI-assisted workflows in the Pirate workspace.

## Rule

AI environments must not have standing Infisical auth.

Repo-level policy:

- repo root `.infisical.json` is non-prod only (`pirate-dev-staging`)
- production must use a separate human-only project config directory such as `ops/prod`
- AI shells must not use `--project-config-dir=ops/prod`

This includes:

- no Infisical service token in AI runtime env
- no account-scoped Infisical credentials on agent machines by default
- no automatic secret pulls from AI workflows

## Operator Escape Hatch

For production launch operations, a human operator may approve a one-shot
Infisical command in an AI shell when all of these constraints hold:

- the command is explicitly reviewed before execution
- the command uses `rtk infisical run --env prod --path /services/api -- ...`
- the command is limited to community launch, namespace attach, manifest apply,
  or launch seed operations that require `PIRATE_ADMIN_TOKEN`
- admin impersonation is limited to the intended operator actor and, for seed
  content, to routes using the `launch_seed` operation class
- stdout and stderr must not print raw environment variables or secret values
- the shell session must not persist exported Infisical credentials after the
  command exits
- the command, target community ids, acting user id, and resulting run output are
  retained in the normal terminal or task log for audit

This is an exception for command-scoped secret injection, not permission for AI
agents to browse Infisical or retrieve arbitrary secret values. The current
`infisical run --path /services/api` primitive injects the full service path, so
the reviewed command must not inspect unrelated environment variables.

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
- use the operator escape hatch for exploratory commands, shell inspection, or
  unrelated production access

## Follow-Up

Later revisions may define tighter rules for:

- single-secret injection wrappers for `PIRATE_ADMIN_TOKEN`
- local development escape hatches
- audit logging for operator-assisted secret use
