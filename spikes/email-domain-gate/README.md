# Email-domain gate spike

Phase A tooling for `specs/domain/email-domain-gate-spike.md`.

Raw email is sensitive. Put samples only in `corpus/`; Git ignores everything
there except its handling instructions. The inspector emits structural metadata
only: it never emits an address, subject, body, signature, DNS key, input path,
or filename.

Inspect one sample:

```bash
rtk node inspect-eml.mjs --label proton-self --file corpus/proton-self.eml
```

Save a result locally (the `results/` directory is also ignored):

```bash
rtk node inspect-eml.mjs --label proton-self --file corpus/proton-self.eml \
  --out results/proton-self.json
```

Run the focused synthetic tests:

```bash
rtk node --test inspect-eml.test.mjs
```

