# Operator-controlled recovery escrow

This is the recovery-key design for the Radicle-primary cutover. It replaces
the unimplemented removable-drive design. CI, VPS #3, and unattended machine
identities never receive recovery credentials. An explicitly authorized
operator session may provision metadata and placeholders, but must not print
real private-key values into terminal or agent output.

## Threat model and accepted tradeoff

Radicle replication preserves repository objects and signed identity
documents. It cannot create a new valid identity update after every delegate
private key is lost. The recovery delegate exists for that signing operation;
the backup age identities exist to decrypt immutable off-host archives.

Recovery material uses managed cloud escrow:

- Infisical stores one provider-replicated, versioned **encrypted blob** for
  each recovery key.
- A separate human password manager stores only the corresponding wrapping or
  key passphrase.
- MFA protects the human Infisical account.
- No machine identity, VPS, CI guest, or controller can access the recovery
  organization.

There is deliberately no second private-key export in the password manager.
Putting a key copy beside its passphrase would make that provider sufficient
to recover the key and would defeat split control. Provider replication,
versioning, point-in-time recovery when available, and quarterly drills replace
the old two-media durability rule. This is an explicit single-provider
durability decision, not an accidental missing copy.

The residual risks are accepted:

- Infisical plus password-manager/hardware-factor compromise exposes recovery
  authority.
- An Infisical outage can delay emergency recovery. It does not stop normal
  promotion while the online controller is healthy.
- Loss or corruption across Infisical's replicated storage and version history
  can destroy the sole escrowed blob. Quarterly retrieval drills and version
  checks detect, but do not eliminate, that provider risk.

## Organization boundary

Create a dedicated Infisical organization and a single project named
`pirate-recovery`. Project-level separation inside the application organization
is insufficient because an organization administrator can join its projects.

Required effective configuration:

```yaml
organization: <dedicated-recovery-org-id>
project: pirate-recovery
environment: recovery
members:
  human: [recovery_operator]
  machine: []
service_tokens: []
identity_auth_methods: []
secret_syncs: []
integrations: []
webhooks: []
audit_logs: enabled
```

The existing operator account may be the sole human administrator. The four
application GitHub OIDC identities, VPS #3, CI broker, Ambient guests,
promotion controller, and mirroring identity must have no membership or auth
method in it. Record the effective member counts in the secret-free manifest.

Record the plan, audit-log API availability, retention information if supplied,
point-in-time recovery availability, and tested secret-version behavior in the
recovery manifest. Paid audit retention is useful but is not a cutover gate for
this solo-operator design.

## Recovery account boundary

The recovery organization has one human administrator protected by MFA. CLI
selection on the workstation is permitted for explicitly authorized setup and
drills. Do not create service tokens, machine identities, integrations, syncs,
or webhooks for it. Real recovery values should be entered or replaced through
the human-controlled Infisical UI; agent-visible commands may create only
clearly unusable placeholders unless the operator explicitly authorizes a
specific key operation.

## Key separation

Use three independent private keys:

| Key | Purpose | Escrow form |
| --- | --- | --- |
| Radicle recovery delegate | Emergency identity-document updates | Its passphrase-encrypted OpenSSH private-key file in Infisical; passphrase in password manager |
| NS1 backup age identity | Decrypt HNS/Spaces state archives | `age` identity wrapped with `age --passphrase` before Infisical upload; wrapping passphrase in password manager |
| Radicle proof-backup age identity | Decrypt CI proof/promotion archives | Separate `age` identity wrapped with `age --passphrase`; separate wrapping passphrase in password manager |

The two age identities are intentionally different so recovery of one backup
domain does not expose the other. Infisical secret names:

```text
recovery:/radicle/RADICLE_RECOVERY_PRIVATE_KEY
recovery:/backup-age/NS1_BACKUP_AGE_IDENTITY_CURRENT_WRAPPED
recovery:/backup-age/NS1_BACKUP_AGE_IDENTITY_PREVIOUS_WRAPPED
recovery:/backup-age/RADICLE_PROOF_BACKUP_AGE_IDENTITY_CURRENT_WRAPPED
recovery:/backup-age/RADICLE_PROOF_BACKUP_AGE_IDENTITY_PREVIOUS_WRAPPED
```

Store the Radicle recovery DID/public key and both age recipients in the
secret-free tracked manifest. Never retrieve a private key to perform a public
DID or recipient check.

The online controller key and seed transport key are never escrowed. A lost
controller is replaced with a new DID by the recovery delegate. A lost seed is
rebuilt with a new transport identity from replicated repositories.

## Generation ceremony

Run only after the organization boundary and MFA are verified.

1. Use a private operator terminal with `umask 077` and a temporary working
   directory. Do not use a VPS, CI guest, or committed project configuration.
2. Authenticate interactively and select `pirate-recovery`/`recovery`.
3. Create and edit a decoy secret. Confirm its prior versions remain
   retrievable and that the audit log records the expected operations. Delete
   the decoy.
4. Generate the Radicle recovery key with an interactively entered passphrase.
   Record only its DID and public key. Upload the already-encrypted private-key
   file using Infisical's file-input syntax; never place its bytes in argv or
   stdout.
5. Generate each age identity separately. Record its public recipient, wrap
   the private identity with `age --passphrase`, and upload only the wrapped
   ciphertext file. Store each wrapping passphrase only in the password
   manager.
6. Retrieve every stored blob with `infisical secrets get --plain
   --expand=false --include-imports=false` redirected to a mode-`0600` file.
   Compare bytes with the uploaded blob. Unwrap it, derive the expected public
   DID/recipient, and stop on any mismatch.
7. Remove all scratch files, stop the temporary SSH agent, and inspect the
   recovery-organization audit log when available.

Never print secret values, use command substitution around secret retrieval,
or let a raw private key reach terminal output. Any output containing an
OpenSSH private-key header or `AGE-SECRET-KEY-` is a hard stop: rotate the
affected key before continuing.

## Drills and hard stops

At least quarterly and before delegate cutover:

- restore the Radicle key, derive the manifest DID, unlock it through an
  ephemeral SSH agent, and rehearse add/replace/remove on a disposable repo;
- restore each age identity and decrypt one retained archive from its own
  backup domain;
- run the complete proof-state restore in `proof-state-restore.md` without
  contacting VPS #3; and
- verify the recovery audit log contains exactly the expected reads and no
  other actor.

If any account recovery, version retrieval, key comparison, DID derivation,
archive decryption, proof verification, audit review, or negative access test
fails, stop. Keep the workstation delegate, keep promotion advisory, and do not
change GitHub's authority boundary.

## Cutover sequence

1. Create and verify the dedicated recovery organization.
2. Complete the generation ceremony and commit the secret-free manifest. This
   produces the public recipients required to configure either backup host.
3. Install the encrypted proof-state backup pipeline without enabling its
   timer, configure it with the public proof-backup recipient and immutable
   bucket credential, then run one manual backup.
4. Rotate NS1 and proof-state backups to their new public recipients; verify a
   fresh immutable upload and restore from each.
5. Add the recovery DID to all five repositories at threshold 1 and verify it
   from the workstation, VPS seed, and an off-host replica.
6. Add the controller DID; implement the canonical-promotion path; complete the
   advisory comparison, restart, queue-recovery, and controller-replacement
   drills.
7. Prove exact-SHA GitHub mirroring, restrict `main` to the mirroring identity,
   reject a non-mirror push, and verify deployment of the mirrored SHA.
8. Only then remove the workstation DID from all five delegate sets.
9. Retire each previous age identity after the last old-recipient archive has
   exceeded provider retention.

Do not create an empty production backup environment file merely to mark step
3 started. Its presence is the host-verification signal that configuration is
complete and a successful timer run must exist.

Step 8 is the authority transition. Before it, the workstation can bypass CI.
After it, recovery requires the escrowed recovery delegate if the controller
cannot promote.
