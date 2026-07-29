# Promotion shadow migrations

This independent PostgreSQL migration root owns only the S0 promotion model's
shadow state in the `promotion_shadow` schema.

- Candidate identifiers are permanently `shc_`-prefixed.
- No table contains an `rc_id` column; shadow candidates cannot be upgraded into
  production release candidates.
- `schema_metadata` records the independently versioned shadow schema.
- Workflow evidence is idempotent per candidate, gate, run ID, and run attempt:
  delivery retries deduplicate while intentional GitHub reruns remain distinct.
- Lease epochs are mandatory and have no default. S0 does not allocate them;
  later phases must obtain a positive epoch from the external authority.
- The root shares the database-wide migration-runner lock and
  `public.schema_migrations` ledger with the other PostgreSQL roots.
- It contains no application tables and grants no runtime access. Environment
  role creation and least-privilege grants are separate operational steps.

Apply with the Core PostgreSQL runner and label `promotion-shadow`.
