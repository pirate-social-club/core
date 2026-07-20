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

Interim conclusion: this sample confirms the internal-delivery DKIM gap for the
tested Proton custom-domain self-send. It cannot support the specified ZK proof
because there is no DKIM signature to prove. A Proton custom-domain → external
Gmail export using the same subject is still required as the control; that will
show whether Proton signs external delivery normally and isolate the failure to
the self-send ceremony.
