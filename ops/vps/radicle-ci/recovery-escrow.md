# Human-only recovery escrow

This is the recovery-key design for the Radicle-primary cutover. It replaces
the unimplemented removable-drive design. It does not give CI, VPS #3, the
workstation, or an AI shell access to recovery private keys.

## Threat model and accepted tradeoff

Radicle replication preserves repository objects and signed identity
documents. It cannot create a new valid identity update after every delegate
private key is lost. The recovery delegate exists for that signing operation;
the backup age identities exist to decrypt immutable off-host archives.

Recovery material uses split control:

- Infisical stores one provider-replicated, versioned **encrypted blob** for
  each recovery key.
- A separate human password manager stores only the corresponding wrapping or
  key passphrase.
- Hardware-backed MFA protects the dedicated Infisical recovery account.
- The recovery account is never authenticated on the normal workstation, any
  VPS, CI, or an AI-reachable environment.

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

The daily operator account must not be a member of this organization. The four
application GitHub OIDC identities, VPS #3, CI broker, Ambient guests,
promotion controller, and mirroring identity must have no membership or auth
method in it. Export the effective permission audit after setup and attach its
redacted result to the ceremony record.

The organization plan must provide audit logs before any key is stored. Record
the audit retention window, point-in-time recovery availability, and secret
versioning behavior in the recovery manifest. Do not assume approval workflows
are available or useful for a single-member recovery organization.

## Recovery account boundary

The recovery account:

- is used only from a disposable VM or live environment with swap disabled and
  a RAM-backed working directory;
- uses a unique password and hardware-backed MFA;
- has recovery codes held by the human password manager;
- is never added as an Infisical CLI profile on the workstation;
- is reset/logged out before the disposable environment is destroyed; and
- is reviewed in the Infisical audit log after every ceremony or drill.

From the normal daily account and every application machine identity, test that
the recovery organization cannot be listed, described, or read. Any successful
enumeration or read is a hard stop.

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

Run only after the organization boundary, audit logs, hardware MFA, and
negative access tests pass.

1. Boot the disposable environment, disable swap, set `umask 077`, and create
   a working directory under `/dev/shm`.
2. Authenticate the recovery account interactively and select
   `pirate-recovery`/`recovery` through a scratch `.infisical.json`. Never use a
   machine identity or committed project configuration.
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
7. Remove the scratch files, run `infisical reset`, destroy the disposable
   environment, and inspect the recovery-organization audit log. It must show
   only the expected recovery-operator actions.

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

1. Install and drill the encrypted proof-state backup pipeline.
2. Create and verify the dedicated recovery organization.
3. Complete the generation ceremony and commit the secret-free manifest.
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

Step 8 is the authority transition. Before it, the workstation can bypass CI.
After it, recovery requires the escrowed recovery delegate if the controller
cannot promote.
