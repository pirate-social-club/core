# References

This directory holds non-canonical material that informs Pirate v2 work but is not itself the production runtime.

## Layout

- `upstream/`
  - local checkouts of external repos or sidecar projects kept for design, contract, or architecture reference
  - tracked manifest lives in `upstream/README.md`
- `templates/`
  - starter implementations and handoff skeletons that encode current decisions without claiming canonical runtime ownership
- `prototypes/`
  - executable spikes used to prove feasibility, runtime shape, or third-party integration assumptions

## Current Upstreams

- `upstream/majeur/`
  - Majeur DAO framework reference checkout
- `upstream/multisig/`
  - Multisig wallet reference checkout

These directories are intentionally ignored by the root repo because they carry their own git history and are not shipped as part of Pirate v2.

`templates/` and `prototypes/` may contain executable code, tests, and active experiments, but they remain reference material until promoted into a canonical runtime repo.

Use `upstream/README.md` as the canonical tracked record for origin URLs, pinned commits, and local checkout expectations.
