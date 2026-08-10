# Architecture fork: local ZK proof vs attested SMTP dead drop

**Status:** decision required; neither path is authorized for product build.

**Date:** 2026-08-10

## Decision being made

The current spike uses a local ZK proof over a work-to-personal email export. A
proposed alternative sends the fresh challenge email to an SMTP dead drop whose
entire receiver, DKIM verifier, commitment derivation, and receipt signer run in
an attestable confidential workload.

This is not a transport substitution. It changes the privacy disclosure, trust
root, availability model, and proof authority. Do not launch both paths: two
ceremonies would create two security surfaces and let an attacker choose the
weaker one.

The architecture decision turns principally on two product questions:

1. Is disclosure of a verification-recipient domain in employer outbound-mail
   logs, DLP systems, and archives acceptable?
2. Is a cloud/hardware attestation chain acceptable as a community-access trust
   root?

If either answer is no, the TEE path is not an acceptable replacement. If the
local ceremony is also unusable, the honest outcome is to defer or abandon the
email-domain gate rather than silently weaken its guarantees.

## Compared flows

### Local ZK proof

1. Pirate issues an opaque, single-use nonce.
2. The user sends work mail to a personal mailbox with the nonce in a signed
   Subject.
3. The user exports the raw message and selects it locally.
4. The browser verifies DKIM, proves the signed From domain and nonce, and sends
   only the proof.
5. Pirate verifies the proof and grants the affiliation capability.

### Attested SMTP dead drop

1. Pirate issues an opaque, single-use nonce and an unbranded recipient such as
   `challenge+<nonce>@<neutral-domain>`.
2. A prefilled mail composer includes the same nonce in Subject; the signed
   Subject remains the security binding because an envelope recipient alone
   does not prevent replay of an old signed message.
3. The user presses Send from the work mailbox.
4. SMTP TLS terminates inside a measured confidential workload. That workload
   verifies DKIM, strict `d=`/From alignment, signed From/Subject coverage,
   nonce/session validity, and deterministic signature selection.
5. It derives `HMAC(tee_secret, normalized_mailbox)` and emits only a signed
   receipt containing the nonce, domain, commitment, policy version, and
   workload measurement reference.
6. Pirate verifies the receipt, atomically consumes the nonce, and grants the
   affiliation capability. The workload has no raw-message persistence,
   address-bearing logs, arbitrary commitment oracle, or output containing the
   mailbox.

The TEE necessarily sees the raw address transiently. The claim is that the
reviewed measured workload is the only Pirate-controlled code able to see it,
not that no computation ever knows it.

## Comparison

| Property | Local ZK | Attested SMTP dead drop |
|---|---|---|
| User ceremony | Send, export, select, prove | Open prefilled mail and press Send |
| Pirate application/operator sees address | The hosted unsalted digest is enumerable by an operator | Not if TLS terminates in the approved workload and its HMAC interface cannot be abused |
| Employer-visible recipient | User's personal mailbox | Verification service domain |
| Personal mail provider sees work identity | Yes | No |
| Raw-message export fidelity | Required | Irrelevant |
| Browser proving artifacts/performance | Load-bearing | Eliminated |
| Runtime dependency | Client plus Pirate verifier | 24/7 SMTP, confidential workload, attestation, key release, monitoring |
| Primary trust root | DKIM, pinned ZK artifacts, proof verifier | DKIM plus hardware/cloud attestation and measured receipt signer |
| Public proof portability | Possible | No; receipt inherits the attestation trust model |
| DKIM strict-alignment coverage | Required | Identically required |
| Gate semantics | Affiliation badge | Affiliation badge |

## Privacy consequences

### Operator-blind commitment is a real TEE advantage

The current hosted-blueprint path exposes an unsalted digest before Pirate's
server-side HMAC. A Pirate verifier can enumerate a likely employee directory
against it. A commitment keyed inside an attested workload removes that offline
dictionary attack if all of the following hold:

- the key is released or unsealed only to an approved measurement;
- the workload accepts only valid, fresh, strictly aligned challenged email;
- there is no arbitrary HMAC/evaluation endpoint;
- receipts and logs never contain the mailbox or unkeyed digest; and
- workload updates and key continuity are governed publicly.

This is stronger operator privacy than the current hosted ZK blueprint can
provide without an OPRF-like mechanism. It is not merely a usability gain.

### Employer-log disclosure reverses a deliberate boundary

The current work-to-personal ceremony deliberately avoids a Pirate-controlled
recipient. The employer sees a personal recipient and neutral Subject, but not
a service recipient. A dead drop makes every attempt visible as mail to the
verification service in outbound logs, DLP, and journaling archives.

An unbranded neutral domain reduces casual keyword detection. It does not hide
ownership from DNS, certificate-transparency, traffic, legal, or deliberate
investigation. The employer-disclosure decision must therefore be made using
the strong threat model, not the branding mitigation.

## Attestation and mail-routing limits

Attestation can bind a receipt key to reviewed workload measurements. It does
not make ordinary SMTP senders verify that measurement, and it does not by
itself stop the recipient-domain operator from temporarily routing mail through
another server.

A defensible design requires at least:

- SMTP TLS termination and plaintext parsing inside the measured workload;
- an MX TLS private key generated or released only inside an approved
  measurement, with the key never available to the host or operator;
- receipt-key release restricted to approved measurements;
- reproducible workload images and published accepted measurements;
- a public append-only log of accepted measurement/key/policy transitions;
- MTA-STS in enforcement mode and DANE/TLSA where sending providers validate
  it;
- continuous external MX, TLS certificate/SPKI, TLSA, MTA-STS, and attestation
  monitoring; and
- alerting plus capability-issuance shutdown on unexplained route or
  measurement changes.

### Attestation-gated MX TLS key

Keeping the MX hostname's TLS private key inside the measured workload
materially narrows the reroute hole. The key manager releases or unwraps it only
after validating the workload measurement. A different host cannot terminate
TLS as that endpoint with the pinned key; a TCP proxy can relay encrypted bytes
to the real workload but cannot read them. The measured workload must also keep
decrypted SMTP bytes internal rather than forwarding plaintext to its host.

This pattern exists in current confidential-computing infrastructure: enclave
KMS policies can condition cryptographic operations on measurements, and ACM
for Nitro Enclaves keeps TLS private keys isolated from the parent. Its packaged
integration currently targets supported web servers, so SMTP/PKCS#11 wiring is
a feasibility task, not an assumed product feature.

The resulting guarantee depends on sender enforcement:

| Sender behavior | Effect of rerouting away from the attested key holder |
|---|---|
| DANE-validating SMTP with DNSSEC TLSA pinned to the enclave-held SPKI | Delivery must fail unless the TLS key is compromised or a DNSSEC-authorized TLSA change is made. The latter is externally monitorable. |
| MTA-STS-enforcing SMTP | The replacement must present a publicly trusted certificate for an allowed MX hostname. Certificate Transparency monitoring can expose normal public-CA issuance, but MTA-STS itself neither pins the original SPKI nor mandates CT. |
| Opportunistic SMTP without DANE/MTA-STS enforcement | No strong route binding. A DNS/MX controller may redirect delivery to another TLS endpoint or downgrade according to sender behavior. |

This is materially stronger than a bare transparency log. For enforcing
senders it changes silent rerouting from an ordinary operator action into key
compromise, a DNSSEC-authorized policy change, or publicly observable
certificate issuance under the required CA/CT policy.

Residual limits remain. Neither MTA-STS nor DANE natively names a TEE
measurement; the binding is indirect through exclusive possession of the TLS
key. Pirate controls its DNS and certificate issuance unless those authorities
are separately governed. Certificate, TLSA, and measurement monitors have a
detection interval, and non-enforcing senders retain the weak opportunistic
path. A transparency log also cannot prevent an unlogged/race-window policy
change; it can only make governed changes auditable and trigger shutdown.

Therefore the strongest honest dead-drop guarantee is **attested and publicly
auditable operator isolation under an explicitly governed mail route**, not a
cryptographic proof that Pirate could never observe the sender.

References:

- [DKIM signed-header semantics (RFC 6376)](https://www.rfc-editor.org/info/rfc6376/)
- [MTA-STS and its SMTP TLS threat model (RFC 8461)](https://www.rfc-editor.org/info/rfc8461/)
- [DANE authentication for SMTP (RFC 7672)](https://www.rfc-editor.org/info/rfc7672/)
- [AWS Nitro Enclaves isolation and attestation](https://docs.aws.amazon.com/enclaves/latest/user/security.html)
- [TLS private-key isolation with ACM for Nitro Enclaves](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-refapp.html)
- [Google Confidential VM remote attestation](https://docs.cloud.google.com/confidential-computing/confidential-vm/docs/attestation-overview)
- [Azure confidential VM overview](https://learn.microsoft.com/en-us/azure/confidential-computing/confidential-vm-overview)

## Strategic fit

The local proof path produces a verifier-controlled cryptographic proof from
pinned public artifacts. The dead-drop path makes a centralized hardware/cloud
attestation chain part of community access and requires Pirate-operated online
infrastructure. That conflicts with the project's broader preference for
portable verification and minimizing centralized trust roots.

This does not automatically reject the TEE path: the operator-blind HMAC is a
privacy improvement and the ceremony is dramatically simpler. It means the
vendor trust must be accepted as a deliberate product exception, documented in
gate copy and operational policy rather than hidden as an implementation
detail.

## Architecture-independent work

Strict DKIM alignment remains the same eligibility boundary in both designs.
The recorded unconfigured Workspace sample fails both. Continue measuring real
aligned custom-domain Workspace and M365 mail before selecting either
architecture; otherwise the decision optimizes a ceremony whose addressable
population is still unknown.

## Decision record template

Before implementation, record:

- **Employer disclosure accepted:** yes/no, with the target-user threat model.
- **Vendor attestation accepted:** yes/no, including named hardware/cloud roots
  and revocation/update policy.
- **Portable public proof required:** yes/no.
- **Online SMTP operational burden accepted:** yes/no, with availability and
  incident ownership.
- **Selected architecture:** local ZK / attested dead drop / do not ship.
- **Why the rejected architecture is unacceptable:** concrete reason.

Until this record is completed, the dead drop is a design candidate only. Do
not provision production SMTP, confidential infrastructure, receipt keys, gate
UI, or a hybrid fallback.
