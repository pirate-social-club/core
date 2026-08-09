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
extraction. Independently, the circuit input is the canonicalized,
`h=`-selected signed header sequence, so an unsigned prepended From is not
available to the regex. The generated circuit/project must still exercise
duplicate and non-oversigned cases to confirm that audited pipeline end to end.

The current regexes assume relaxed header canonicalization (lowercase field
names and normalized colon whitespace). Simple-header compatibility is unproven
and must be tested if the provider corpus contains it.

Generating the project requires authenticating to the ZK Email Registry and
submitting a private/draft blueprint. Do not publish the blueprint or upload a
raw corpus email. If the registry requires a test email, use a sanitized
synthetic DKIM fixture or explicitly approve the private corpus disclosure
first.
