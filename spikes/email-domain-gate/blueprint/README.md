# Domain-specific blueprint draft

This is a local, unsubmitted B1 artifact pinned to `@zk-email/sdk@2.0.11`.
It models the measured work→personal ceremony and deliberately has no To
extraction.

The draft is domain-specific (`senderDomain: pirate.sc`) solely because the
existing Proton custom-domain sample uses that domain. It is not a production
domain policy.

Run the local schema and extraction checks:

```bash
rtk bun install --frozen-lockfile
rtk bun test
```

If the private corpus is present, exercise the released SDK's local
input-generation path without printing extracted values:

```bash
rtk bun run test:corpus
```

The SDK parser rejects the current duplicate-From mutation before regex
extraction. That is useful defense-in-depth but is not proof of circuit
soundness: a malicious prover need not use the SDK parser. The official ZK
Email regex semantics select the first match, so regex extraction itself does
not prove that exactly one From header exists. The generated circuit/project
must still be tested adversarially.

Generating the project requires authenticating to the ZK Email Registry and
submitting a private/draft blueprint. Do not publish the blueprint or upload a
raw corpus email. If the registry requires a test email, use a sanitized
synthetic DKIM fixture or explicitly approve the private corpus disclosure
first.
