# Community shard quarantine review

Community shard quarantine is temporary containment, not a permanent schema-policy exemption. `review_after` is an operational prompt and `expires_at` is a hard release stop: an expired registry entry makes fleet verification fail closed.

The daily `Community shard quarantine review` workflow opens or updates an issue 48 hours before review is due and keeps it open until no review is pending. Do not close that issue without changing the registry or explicitly completing the review; automation will reopen it while the condition remains.

For each entry:

1. Re-run a read-only health and schema inspection against the exact binding.
2. Determine whether the recorded reason still describes current reality.
3. If healthy but behind, use the reviewed single-shard migration operator, run the authoritative scan, and remove the quarantine only after verification passes.
4. If the condition remains, document the new evidence and deliberately extend both review and expiry. Renewal is not the default.
5. If the community is disposable, use the separately reviewed decommission procedure; never substitute an ad-hoc D1 write.

Removing a quarantine must exercise the expected fail-closed transition: the aggregate reader initially declines if its proof is stale, then the authoritative scan verifies and republishes the binding before the reader may fire again.
