# Architecture fork: email ZK vs OIDC privacy variants

**Status:** decision required; no path is authorized for product build.

**Date:** 2026-08-10

## Decision being made

The current spike uses a local ZK proof over a work-to-personal email export.
The alternatives are direct OIDC, a local ZK proof over an OIDC ID token,
TEE-wrapped OIDC, and an attested SMTP dead drop. The SMTP design remains
documented below but is no longer the default alternative: once employer-visible
third-party authentication is accepted, OIDC has better UX and avoids DKIM
alignment/export constraints.

This is not a transport substitution. It changes the privacy disclosure, trust
root, availability model, and proof authority. Do not launch a hybrid: multiple
ceremonies would create multiple security surfaces and let an attacker choose
the weakest one.

The architecture decision starts with one product question:

1. Must verification avoid a recognizable third-party authentication event in
   employer-controlled systems?

If yes, local email ZK is the only current candidate: OIDC applications and
SMTP dead drops are both visible to the employer/provider control plane. If its
ceremony is unusable, defer the gate rather than silently weaken that boundary.
If employer visibility is acceptable, compare direct OIDC, ZK-OIDC, and
TEE-wrapped OIDC before building SMTP infrastructure. Operator blindness and
vendor-attestation acceptance then decide between those OIDC variants.

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

### Direct OIDC

1. Browser begins a provider authorization flow with a Pirate client ID and a
   fresh nonce.
2. Google returns a signed ID token containing `hd`; Microsoft returns a token
   containing immutable tenant/user identifiers.
3. Pirate validates signature, issuer, audience, nonce and expiry. Google gates
   directly on `hd`. Microsoft gates on `tid` mapped to the tenant's Graph
   `verifiedDomains`, never on mutable `email` or `preferred_username`.
4. Pirate retains the minimum stable identifier needed for best-effort dedup and
   grants the affiliation capability.

This is the simplest familiar ceremony, but Pirate receives provider identity
material and the provider/employer can associate the user with the application.

### Local ZK-OIDC

1. Browser begins the same OIDC flow with a fresh nonce bound to the Pirate
   session and approved client audience.
2. The browser receives the signed ID token and locally proves provider
   signature plus required claims. It reveals only the affiliation claim
   (`hd`, or `tid`) and an application-scoped nullifier derived from the stable
   subject; the raw token and subject are not sent to Pirate.
3. Pirate verifies the proof against a session-pinned provider JWK, checks
   issuer/audience/nonce/expiry and domain policy, then grants the capability.

This removes email export, DKIM parsing and DKIM alignment from supported OIDC
providers. It is not automatically operator-blind: Pirate controls ordinary web
assets and could serve JavaScript that exfiltrates the token before proving.
That stronger claim requires a trusted delivery boundary such as a reviewed
signed client, reproducible extension/application, or another mechanism that
prevents the operator from silently changing the prover. A proof protects the
protocol transcript; it does not make hostile frontend code harmless.

### TEE-wrapped OIDC

The browser sends the authorization code directly to an attested workload. The
workload redeems and validates it, emits only domain/tenant plus a keyed
pseudonymous identifier, and discards the token. This can provide operator
isolation without browser proving, but adds the vendor attestation/key-release
trust root. Unlike SMTP-in-TEE, it needs no MX, mail parser, DANE/MTA-STS or
always-on inbound email service.

## Comparison

| Property | Email ZK | Direct OIDC | ZK-OIDC | TEE OIDC | SMTP TEE |
|---|---|---|---|---|---|
| User ceremony | Send, export, select, prove | Provider sign-in | Provider sign-in + local prove | Provider sign-in | Send one email |
| Employer/provider sees third-party authentication | No recognizable Pirate service; ordinary external personal mail remains logged | Yes | Yes | Yes | Yes, via recipient |
| Pirate operator identity access | Email digest is enumerable in hosted path | Yes | Protocol hides token, but hostile served JS can exfiltrate it | Isolated by attested workload | Isolated by attested workload |
| Coverage basis | Strictly aligned DKIM (~57% observed sample) | Supported OIDC tenants | Supported OIDC tenants | Supported OIDC tenants | Strictly aligned DKIM |
| Browser proof cost | Load-bearing, unmeasured | None | Load-bearing, unmeasured | None | None |
| Novel runtime | Proof verifier | Standard OAuth backend | Proof verifier + JWK policy | Confidential OAuth callback/exchange | Confidential SMTP + mail security stack |
| Primary trust root | Provider DKIM + ZK artifacts | OIDC provider | OIDC provider + ZK artifacts + client-delivery integrity | OIDC provider + vendor attestation | DKIM + vendor attestation |
| Gate semantics | Mailbox-at-exact-domain affiliation | Google domain membership; Microsoft tenant membership mapped to verified domain | Same as direct OIDC | Same as direct OIDC | Mailbox-at-exact-domain affiliation |

## OIDC claim semantics and unresolved trust

Google's signed `hd` claim is designed for restricting access to members of a
Workspace or Cloud organization domain. Do not infer hosted-domain membership
from the mutable email claim.

Microsoft is different. Validate immutable `tid` and `oid`/`sub`, then map the
tenant to its Graph `verifiedDomains`. Never authorize from `email`,
`preferred_username`, or `unique_name`. A tenant may verify several domains, so
this establishes **membership in a tenant that controls the configured domain**,
not possession of a mailbox at that domain. A contractor or guest account in
that tenant may qualify. This is acceptable only under the resolved
affiliation-badge semantics and must be visible to gate authors; it is a real
loosening from the DKIM mailbox claim.

ZK-OIDC also retains key and client-delivery trust:

- The proof must bind `iss`, `aud`, `nonce`, `exp`, `kid`, the provider claim,
  and an application-scoped salted nullifier derived from the stable subject.
- Provider JWK rotation is manageable because tokens are short-lived, but not
  irrelevant. Pin the selected JWK to the session before proving and verify the
  proof's key hash against it; define cache, revocation and stale-session policy.
- Local proving prevents the normal backend from receiving the JWT only when
  the authorization response and prover run inside a client the operator cannot
  silently replace. A normal Pirate-served web bundle does not provide that
  guarantee against a malicious Pirate operator.
- Never place tokens or authorization codes in application logs, analytics,
  Sentry, query retention, referrers or responses. Use authorization code + PKCE
  where supported and make redirect/callback logging part of the threat model.

The available `zkemail/zk-jwt` repository demonstrates RSA JWT verification and
claim masking but explicitly says it is unaudited and not intended for
production. Production use cannot inherit maturity from unrelated deployments;
the circuit, helpers, setup artifacts and browser path require their own audit
and feasibility result. See `zk-oidc-feasibility.md`.

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

- [Google OpenID Connect and `hd`](https://developers.google.com/identity/openid-connect/openid-connect)
- [Microsoft claims validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation)
- [Microsoft Graph tenant `verifiedDomains`](https://learn.microsoft.com/en-us/graph/api/resources/verifieddomain?view=graph-rest-1.0)
- [`zkemail/zk-jwt` research implementation](https://github.com/zkemail/zk-jwt)
- [Sui zkLogin technical reference](https://docs.sui.io/sui-stack/zklogin-integration/zklogin)
- [DKIM signed-header semantics (RFC 6376)](https://www.rfc-editor.org/info/rfc6376/)
- [MTA-STS and its SMTP TLS threat model (RFC 8461)](https://www.rfc-editor.org/info/rfc8461/)
- [DANE authentication for SMTP (RFC 7672)](https://www.rfc-editor.org/info/rfc7672/)
- [AWS Nitro Enclaves isolation and attestation](https://docs.aws.amazon.com/enclaves/latest/user/security.html)
- [TLS private-key isolation with ACM for Nitro Enclaves](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-refapp.html)
- [Google Confidential VM remote attestation](https://docs.cloud.google.com/confidential-computing/confidential-vm/docs/attestation-overview)
- [Azure confidential VM overview](https://learn.microsoft.com/en-us/azure/confidential-computing/confidential-vm-overview)

## Strategic fit

The local email and OIDC proof paths produce verifier-controlled cryptographic
proofs from pinned public artifacts. TEE paths make a centralized
hardware/cloud attestation chain part of community access and require
Pirate-operated confidential infrastructure. That conflicts with the project's
broader preference for portable verification and minimizing centralized trust
roots.

This does not automatically reject a TEE path: operator isolation is a real
privacy improvement and avoids browser proving. It means the vendor trust must
be accepted as a deliberate product exception. ZK-OIDC may avoid that vendor
root, but only after its unaudited implementation, proving cost, JWK binding and
client-delivery boundary pass the dedicated spike.

## Architecture-independent work

Strict DKIM alignment remains the eligibility boundary for email-ZK and SMTP
TEE, and the recorded unconfigured Workspace sample fails both. OIDC variants
replace that constraint with provider/tenant coverage and administrator consent
policy. Configured Workspace/M365 samples remain useful for the email branches;
dedicated Google/Microsoft test clients are required for the OIDC branches.

## Decision record template

Before implementation, record:

- **Employer disclosure accepted:** yes/no, with the target-user threat model.
- **OIDC provider/admin visibility accepted:** yes/no.
- **Pirate operator access to provider identity accepted:** yes/no, including
  the frontend-delivery assumption for local ZK-OIDC.
- **Vendor attestation accepted:** yes/no, including named hardware/cloud roots
  and revocation/update policy.
- **Portable public proof required:** yes/no.
- **Selected architecture:** email ZK / direct OIDC / ZK-OIDC / TEE OIDC /
  SMTP TEE / do not ship.
- **Why each rejected architecture is unacceptable:** concrete reason.

Until this record is completed, every alternative is a research candidate only.
Do not provision production OAuth, SMTP, confidential infrastructure, receipt
keys, gate UI, or a hybrid fallback.
