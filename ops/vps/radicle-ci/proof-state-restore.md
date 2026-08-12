# Radicle CI proof-state restore drill

This procedure proves that signed CI evidence and promotion state survive the
loss of VPS #3. Run it before authoritative promotion and after material backup
format changes. Never restore over the live seed.

## Required inputs

- An encrypted off-host archive and its signed manifest.
- One offline age identity copy, supplied from recovery media.
- A disposable offline or isolated Linux environment with compatible `git`,
  `rad`, and job-COB tooling.
- The expected repository RID, producer NID, job COB ID, commit SHA, result,
  archive SHA-256, and recipient public key from the manifest.

The archive must contain:

- the producer namespace's `refs/cobs/xyz.radworks.job/*` refs and all reachable
  Git objects for every allowlisted RID;
- the producer `refs/rad/sigrefs` ref and reachable objects;
- promotion events, controller audit records, and queue state; and
- no controller or recovery private key.

## Restore drill

1. Disconnect or isolate the restore environment from VPS #3. Record the
   environment identifier and UTC start time.
2. Copy the encrypted archive and manifest to temporary local storage. Do not
   copy the recovery identity beside the archive permanently.
3. Verify the archive SHA-256 against the manifest before decryption. Stop on
   any mismatch.
4. Decrypt with one recovery-media identity into a new, empty temporary
   directory. Record only the recipient public key, never the private identity.
5. Import the repository storage into a new disposable `RAD_HOME`. Do not point
   tools at the workstation or VPS storage directories.
6. Verify the restored producer `refs/rad/sigrefs` signature and confirm its
   signer equals the manifest's producer NID.
7. Resolve the selected `xyz.radworks.job` COB entirely from restored objects.
   Confirm its repository RID, commit SHA, terminal result, and run identifier
   exactly match the manifest.
8. Run the promotion proof validator against the restored proof and confirm it
   accepts that exact tuple. Mutate or substitute each of RID, commit, producer,
   and result in turn and confirm validation rejects every mismatch.
9. Restore promotion events, audit records, and queue into a disposable state
   directory. Run controller status in advisory/offline mode and confirm the
   event and request counts match the manifest. Do not start a canonical-push
   path.
10. Repeat steps 2–9 using the second separately stored recovery copy. A test of
    only one copy does not satisfy the recovery requirement.
11. Securely dispose of decrypted temporary material according to the recovery
    environment's media policy. Preserve the encrypted archive, signed
    manifest, and a secret-free drill record.

## Pass criteria

The drill passes only when both recovery copies independently:

- decrypt an archive whose checksum matches the manifest;
- reconstruct and cryptographically verify the selected signed job COB;
- reproduce the expected terminal CI tuple;
- reject all mismatched proof tuples; and
- reconstruct promotion records and queue state without contacting VPS #3.

Any missing object, signature failure, checksum mismatch, decryption failure,
validator disagreement, or second-copy failure is a hard stop. Leave the
workstation delegate in place, keep promotion advisory, make no delegate-set or
GitHub protection cutover, repair the backup process, create a new archive, and
repeat the complete drill.

## Secret-free drill record

Record:

- UTC start and finish times;
- archive and manifest SHA-256 values;
- recipient public key;
- repository RID, producer NID, job COB ID, and commit SHA;
- verification result for each pass criterion and recovery copy;
- tool versions; and
- operator role identifier.

Never record a private age identity, Radicle private key, passphrase, decrypted
archive content, environment secrets, or production credentials.
