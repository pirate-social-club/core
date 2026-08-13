# Community migration rollout contracts

Every newly added file under `db/community-template/migrations/` must add a
same-change JSON contract under this directory. Core CI checks the contract
before the migration can merge.

The contract records the workflow and target environments that own the rollout,
the tracked Core operator spec, and requires a read-only audit before applying
production. It is an execution contract, not proof that a migration has already
been applied. Production application remains proven by the reviewed migration
workflow and the release schema gate.

Keep ownership expressed as a role or workflow, never as a person.
