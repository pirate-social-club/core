# AI Infisical Boundary

Defines the minimum secret-boundary policy for AI-assisted workflows in the Pirate workspace.

## Rule

AI environments must not have standing Infisical auth.

Repo-level policy:

- the repo-root `.infisical.json` selects the application project for dev,
  staging, and prod; environment and path flags provide command scope
- production access remains human-approved and command-scoped under the
  operator escape hatch below
- the separate `pirate-recovery` organization may be selected only for an
  explicitly authorized recovery setup operation

This includes:

- no Infisical service token in AI runtime env
- no account-scoped Infisical credentials on agent machines by default
- no automatic secret pulls from AI workflows
- no unattended recovery machine identity, token, or committed project
  configuration

## Recovery organization

Recovery escrow is still excluded from unattended automation. With explicit
operator authorization, an AI shell may create or verify organization metadata,
folders, and clearly unusable placeholders. It must not retrieve, print, or
transform real recovery private-key values. Those values are replaced through
the human-controlled Infisical UI. Application machine identities, VPS hosts,
CI guests, and the controller must remain unable to access the recovery
organization. Public recovery metadata remains safe for AI-assisted
verification.

## Operator Escape Hatch

For production launch operations or read-only production diagnostics, a human operator may approve a one-shot
Infisical command in an AI shell when all of these constraints hold:

- the command is explicitly reviewed before execution
- the command uses `rtk infisical run --env prod --path /services/api -- ...`
- the command is limited to either:
  - community launch, namespace attach, manifest apply, or launch seed operations
    that require `PIRATE_ADMIN_TOKEN`; or
  - an explicitly requested read-only query that reports operational state without
    printing credentials, connection strings, tokens, or unrelated secret values
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
- retrieve, print, rotate, or delete real recovery-organization secret values
- create or replace recovery placeholders without explicit operator approval
- persist raw secrets into repo files
- write secret values into machine-readable config inventories
- expand access from one approved secret to broader secret inventory access
- use the operator escape hatch for unrequested exploratory commands, general shell
  inspection, or production access unrelated to the approved operation

## Follow-Up

Later revisions may define tighter rules for:

- single-secret injection wrappers for `PIRATE_ADMIN_TOKEN`
- local development escape hatches
- narrower secret injection wrappers and audit logging for operator-assisted secret use
