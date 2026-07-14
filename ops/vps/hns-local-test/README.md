# Local HNS Edge Integration Test

This harness proves the canonical primary and secondary PowerDNS roles before
ordering or touching public infrastructure. It mounts the production config
files unchanged and overrides only networking/API reachability inside an
isolated Docker bridge.

It exercises:

- real PowerDNS 5.1 containers pinned to the production digest
- real `PowerDnsApiClient.ensureZone`
- DNSSEC key generation, rectification, and DS derivation
- DANE-EE TLSA derivation from a disposable certificate, publication at apex,
  explicit-profile, and wildcard-synthesized owners, and signature validation
  through both authorities
- per-zone `TSIG-ALLOW-AXFR` convergence
- unsigned AXFR rejection and TSIG-authenticated AXFR success
- signed-NOTIFY autoprovisioning of a previously unknown secondary zone
- unsigned unknown-zone NOTIFY rejection
- SOA/DNSKEY parity plus cryptographic validation through both authorities
- proof that the secondary serves transferred signatures with zero private keys
- update/serial/TXT propagation without manual secondary provisioning

Run:

```bash
bash ops/vps/hns-local-test/run.sh
```

Run the real backup/restore proof separately:

```bash
bash ops/vps/hns-local-test/backup-roundtrip.sh
```

That test uses real `age` encryption/decryption, real `rclone` S3 transfers,
and a local MinIO bucket with default COMPLIANCE retention. It verifies the
locked object version cannot be deleted, restores and integrity-checks the
PowerDNS database, then boots the pinned PowerDNS image from the restored copy
and validates its DNSSEC answers. `systemctl` alone is simulated so the test
cannot stop unrelated workstation services.

This proves S3 Object Lock behavior locally. It does not replace a one-time
live Backblaze B2 check of default retention and restricted application-key
permissions before production backups are trusted.

The harness deletes its isolated containers, network, volumes, generated
DNSSEC keys, and test TSIG secret on exit. It never reads production secrets,
contacts a Handshake wallet, or publishes DNS records.

The DNS tools image installs Debian's `bind9-dnsutils` at local build time. It
is test-only; both PowerDNS authorities remain digest-pinned production images.
