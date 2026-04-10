# Upstream References

This directory holds local sidecar checkouts of external upstream repos that inform Pirate design and contract work.

The checkout directories themselves are ignored by the root repo and may contain local-only git history. This file is the tracked source of truth for what Pirate intended to reference.

## Policy

- Treat these repos as reference material, not active Pirate runtime dependencies.
- When Pirate docs or schemas are shaped by an upstream repo, record the reviewed commit here.
- If a local checkout drifts from the reviewed commit, update this file or reset the sidecar intentionally inside its own repo.
- Do not assume another machine has these folders present unless they are cloned locally.

## Current References

### `majeur`

- Purpose: reference for Pirate's Majeur DAO governance model and deployment boundary
- Origin: `https://github.com/z0r0z/majeur`
- Reviewed local `HEAD`: `e714f52eb6b74afa37ec8a1ba5840168fe9001b7`
- `HEAD` summary: `rename guild to club`
- Current `origin/main`: `7d7a36b5a25d31f7aa4d499b3a57ee98f4367fac`
- Local checkout status: ahead of `origin/main` by 1 commit
- Pirate relationship:
  - Pirate's Majeur creation model intentionally mirrors `SafeSummoner.safeSummon(...)` and `SafeConfig`
  - Pirate stores a narrowed product-facing subset rather than the full upstream module surface

### `multisig`

- Purpose: reference for external smart-account governance and multisig-backed club control
- Origin: `https://github.com/z0r0z/multisig`
- Reviewed local `HEAD`: `23293395745c020e8ccc9601e9504fcefec025b6`
- `HEAD` summary: `nit multicall3`
- Current `origin/main`: `23293395745c020e8ccc9601e9504fcefec025b6`
- Local checkout status: aligned with `origin/main`
- Pirate relationship:
  - Pirate's multisig model is generic and Safe-oriented
  - This repo is useful as governance reference material, but Pirate does not mirror its low-level execution or module interfaces

## Refresh Procedure

1. Inspect the sidecar repo and decide which commit Pirate is actually reviewing.
2. Update the corresponding `Reviewed local HEAD`, summary, and status lines in this file.
3. If Pirate docs or schemas changed because of the new upstream commit, note that in the relevant spec or design doc.
4. Keep this file terse; it is a manifest, not a full integration guide.
