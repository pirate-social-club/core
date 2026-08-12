# HNS verifier operator scripts

## Unclaimed-zone audit

`audit-unclaimed-zones.ts` is a read-only comparator. It reads the PowerDNS
zone list and snapshots, then joins them with the control-plane inventory
produced by the API operator script:

```sh
bun run scripts/audit-unclaimed-zones.ts \
  --control-plane-inventory /tmp/hns-zone-control-plane.json
```

The command deliberately rejects `--apply` and `--delete`. It never patches a
zone, removes a TXT record, calls rectify, or sends NOTIFY. Unknown roots,
reserved shared zones, active sessions, attachments, delegation state, and
hard-denied roots are all protected or review-only. Every result includes the
PowerDNS serial and a SHA-256 snapshot hash for a later, separately reviewed
operation.
