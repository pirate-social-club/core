# Spaces Repository Map

Status: naming source of truth for Pirate Spaces verifier and publisher repositories

## Naming Rule

Every public repo in this family must start with `pirate-spaces-`.

Repos that do not use that prefix should be renamed if still active, or archived if superseded.
This keeps Pirate ownership and the Spaces product boundary visible from the repo name alone.

## Current Names

| What it is | GitHub repo name | Status |
| --- | --- | --- |
| Live VPS verifier API | `pirate-spaces-verifier` | Active name if extracted; current source lives in `core` |
| Fabric record publisher | `pirate-spaces-publisher` | Active |
| Local digest-signing helper | `pirate-spaces-signer` | Active only if the digest-signing flow is still used |
| Superseded Fabric publisher | `spaces-publisher` | Archive |
| Broad legacy verifier repo | `pirate-verifier` | Archive |

## Active Runtime Ownership

The live verifier service currently stays in `core`:

- [services/verifier/spaces](../../services/verifier/spaces)
- [ops/vps/spaces-verifier](../../ops/vps/spaces-verifier)

It is deployed on the VPS behind `https://spaces.pirate.sc`. If this service is extracted into a
standalone repo, use `pirate-spaces-verifier`.

The active publisher CLI name is `pirate-spaces-publisher`. The local source used by this workspace
lives at:

- [tools/spaces-publisher](../../tools/spaces-publisher)

The `pirate-spaces-signer` repo is not the verifier service. Keep it only if the local digest-signing
flow still exists, and keep its README header explicit:

```text
Not the verifier service. This is a local CLI helper for signing verification digests.
```

## Archive Targets

Archive `spaces-publisher` because the missing `pirate-` prefix makes it look like upstream or
community tooling, and `pirate-spaces-publisher` is the active name.

Archive `pirate-verifier` because the name is too broad and overlaps the verifier, publisher, and
signer concepts.
