# Phase A findings

Only manually reviewed structural metadata belongs in this file. Raw messages,
addresses, subjects, signatures, paths, and DNS keys must remain private.

## Proton custom-domain self-send

Observed 2026-07-20 from an exported same-mailbox message:

- exactly one From mailbox: yes
- exactly one To mailbox: yes
- To equals From under byte-exact-local-part and canonical-domain comparison: yes
- `DKIM-Signature` header count: **0**
- structurally complete DKIM signature: **no**

Interim conclusion: this self-send export cannot support the specified ZK proof
(no DKIM signature present). The CAUSE is not yet isolated — two confounded
explanations:

1. internal-delivery gap: same-mailbox delivery never traversed the outbound
   DKIM-signing gateway (the spec §2 hypothesis); or
2. export-fidelity gap: Proton reconstructs exports from its encrypted store and
   may strip/lose DKIM material even when the wire message was signed (zk.email
   docs warn about exactly this for Proton-received mail).

Two controls are required to separate them:

- **Control 1 (outbound signing):** Proton custom-domain → external Gmail, same
  subject, exported FROM GMAIL (known-good export fidelity). Signature present ⇒
  Proton signs external delivery; failure was ceremony- or export-side.
- **Control 2 (export fidelity):** Gmail → the Proton custom-domain address,
  exported FROM PROTON. If Gmail's `d=gmail.com` signature does not survive the
  Proton export, Proton is disqualified as the *exporting* mailbox for any
  ceremony variant, independent of the internal-delivery question.

Only 1-pass + 2-pass would localize the failure to internal delivery. 2-fail
means Proton export fidelity is the binding constraint (a Proton-specific
disqualification, not evidence about the Workspace/M365 internal-delivery risk).
