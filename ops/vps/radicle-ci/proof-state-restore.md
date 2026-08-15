# Radicle CI proof-state restore drill

This procedure proves that signed CI evidence and promotion state survive the
loss of VPS #3. Run it before authoritative promotion, at least quarterly, and
after any material backup-format change. Never restore over the live seed.

The recovery model is defined in `recovery-escrow.md`. There are no removable
recovery drives. A human retrieves a passphrase-wrapped age identity from the
dedicated recovery Infisical organization and obtains its wrapping passphrase
from a separate password manager.

## Required inputs

- One immutable off-host artifact set produced by `backup-proof-state`:
  encrypted archive, SHA-256 sidecar, JSON envelope manifest, SSH signature,
  and backup-attestation public key.
- The secret-free tracked recovery manifest, including the expected proof
  backup signer fingerprint and age recipient.
- Human access to the recovery organization with MFA, and the separate
  password-manager entry for the proof-backup age wrapping passphrase.
- An isolated temporary Linux workspace with compatible `age`, `git`,
  `rad`, `jq`, OpenSSH, and the tracked `promotion-proof-exporter`.
- The expected RID, producer NID, job COB ID, commit SHA, terminal result, and
  run identifier for one known signed job.

The archive must contain:

- one complete Git bundle per allowlisted RID;
- the producer namespace's signed `xyz.radworks.job/*` refs and reachable Git
  objects;
- the producer `refs/rad/sigrefs` ref and reachable objects;
- `refs/rad/id`, so Radicle can validate the repository identity while
  checking the restored producer signed refs;
- promotion events, controller audit records, and queue state; and
- no seed, controller, recovery, or age private key.

## Envelope verification

1. Keep the drill disconnected from VPS #3. Set `umask 077`, use a temporary
   scratch directory, and record the environment identifier and UTC start time.
2. Download the five artifacts. Verify the SHA-256 sidecar and confirm the
   envelope manifest's `archive_sha256`, byte count, archive filename, age
   recipient, and producer NID all match the downloaded artifact and tracked
   recovery manifest.
3. Compute the supplied SSH public-key fingerprint and compare it with
   `proof_backup_attestation.public_key_fingerprint` in the tracked manifest.
   Do not trust the public key merely because it arrived beside the archive.
4. Create a temporary OpenSSH allowed-signers file binding that public key to
   the role principal `proof-backup@pirate`. Verify the envelope signature with
   namespace `pirate-radicle-proof-backup`. Any mismatch is a hard stop.

Example verification shape:

```bash
sha256sum --check <archive>.sha256
ssh-keygen -lf <archive>.manifest.pub -E sha256
printf 'proof-backup@pirate %s\n' "$(cat <archive>.manifest.pub)" \
  > allowed-signers
ssh-keygen -Y verify -f allowed-signers -I proof-backup@pirate \
  -n pirate-radicle-proof-backup -s <archive>.manifest.json.sig \
  < <archive>.manifest.json
```

## Human-only key retrieval

5. Authenticate interactively and select `pirate-recovery`/`recovery` through a scratch
   `.infisical.json`. No machine identity may perform this step.
6. Retrieve only
   `RADICLE_PROOF_BACKUP_AGE_IDENTITY_CURRENT_WRAPPED` with `--plain
   --expand=false --include-imports=false`, redirecting stdout to a mode-`0600`
   file. Never render or inspect the value in the terminal.
7. Obtain the independent wrapping passphrase from the human password manager.
   Decrypt the wrapped blob to a temporary age identity, derive its public
   recipient with `age-keygen -y`, and compare it with both manifests.
8. Decrypt the archive into a new temporary path. Verify the decrypted
   `payload-manifest.json` SHA-256 equals the value in the signed envelope.
   End the Infisical session immediately with `infisical reset`.

Retrieval must use redirection, never command substitution:

```bash
infisical secrets get RADICLE_PROOF_BACKUP_AGE_IDENTITY_CURRENT_WRAPPED \
  --env recovery --path /backup-age --plain --expand=false \
  --include-imports=false > proof-backup-identity.wrapped.age
age --decrypt --output proof-backup-identity.agekey \
  proof-backup-identity.wrapped.age
age-keygen -y proof-backup-identity.agekey
age --decrypt --identity proof-backup-identity.agekey \
  --output proof-state.tar.zst <archive>.tar.zst.age
```

## Signed-proof reconstruction

9. Extract the archive. Verify `promotion-files.sha256` and every repository
   bundle SHA-256 in `payload-manifest.json`.
10. Initialize a disposable Radicle profile and clone each bundle with
    `git clone --mirror` into `RAD_HOME/storage/<RID-without-rad-prefix>`.
    Run `git fsck --full --no-dangling` on each restored repository.
11. Run `rad inspect --sigrefs <RID>` against the disposable `RAD_HOME`. Confirm
    the expected producer NID and exact `sigrefs` OID from the payload manifest
    appear. Radicle must accept the repository identity and signed-ref
    signature entirely from restored objects.
12. Run the tracked `promotion-proof-exporter` against the disposable storage.
    Resolve the selected job summary and confirm RID, producer NID, job COB ID,
    signed tip, commit SHA, terminal result, and run identifier exactly match
    the drill inputs.
13. Run the controller's proof validator against that exported summary. Mutate
    or substitute RID, commit, producer, job ID, signed-tip marker, and result
    one at a time. Every mismatch must be rejected.
14. Restore promotion events, audit records, and queue into a disposable state
    directory. Run controller status in advisory/offline mode and confirm event
    and request counts match `payload-manifest.json`. Do not start a
    canonical-push path.

## Destruction and audit

15. Remove the decrypted archive, unwrapped age identity, allowed-signers file,
    restored repositories, and all scratch state. Destroy the disposable
    environment. Do not preserve shell history or snapshots.
16. Review the recovery-organization audit log. It must contain exactly the
    expected human retrieval events and no other actor. Confirm the drill never
    contacted VPS #3.
17. Record only the secret-free drill results and update `last_drill_at` in the
    tracked recovery manifest.

## Pass criteria and hard stop

The drill passes only when it:

- verifies the immutable artifact checksum and host-attestation signature;
- retrieves and unwraps the expected age identity through split control;
- reconstructs every bundle with no missing Git object;
- cryptographically verifies the producer signed refs;
- reproduces the expected terminal CI tuple;
- rejects every mutated proof tuple;
- reconstructs promotion records and queue state without VPS #3; and
- shows exactly the expected human reads in the Infisical audit log.

Any missing object, signature failure, fingerprint mismatch, checksum mismatch,
decryption failure, recipient mismatch, validator disagreement, unexpected
audit actor, or contact with VPS #3 is a hard stop. Leave the workstation
delegate in place, keep promotion advisory, change no delegate set or GitHub
protection, repair the backup/recovery process, produce a new archive, and
repeat the complete drill.

## Secret-free drill record

Record UTC start/finish, artifact and manifest hashes, public recipients and
fingerprints, RID, producer NID, job COB ID, commit SHA, each verification
result, tool versions, and operator role identifier. Never record a private age
identity, Radicle private key, passphrase, account identifier, decrypted
content, or production credential.
