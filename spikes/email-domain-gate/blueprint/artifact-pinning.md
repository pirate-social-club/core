# Hosted blueprint artifact pinning

The ZK Email Registry is a compile-time convenience for this spike. It must not
be a production runtime dependency. No real corpus email may be uploaded during
blueprint creation or compilation; use a synthetic DKIM fixture only.

## Capture immediately after compilation

Store the export under a versioned, gitignored local directory until every file
has been manually reviewed for private material. Capture:

- normalized blueprint properties, private blueprint ID, slug, and version;
- registry frontend, SDK, circuit compiler, proving-system, and dependency
  versions;
- generated circuit source, build scripts, manifest, and lockfiles;
- circuit WASM and R1CS or equivalent constraint artifact, when exposed;
- verification key;
- every proving-key file or chunk plus the advertised chunk ordering;
- generated public-signal metadata and verifier source; and
- the source URL and retrieval time for each downloaded artifact.

Create a deterministic manifest containing each relative path, byte length, and
SHA-256 hash. The private blueprint ID and mutable download URLs are metadata,
not integrity anchors. The file hashes and pinned compiler inputs are the
integrity anchors.

## Completeness checks

Before accepting the hosted output:

1. Recompute every hash after moving the export into its final spike directory.
2. Reconstruct the circuit from pinned source and versions when the generated
   project supports local builds; compare the resulting constraint metadata.
3. Record the exact public-signal order and meaning, including the DKIM
   public-key hash, extracted From domain, nonce, and hashed mailbox output.
4. Search generated source for a sender-domain constant and document the result.
5. Trace each regex constraint to the authenticated `emailHeader` input.

## Offline acceptance

After artifacts are captured, block registry, conductor, DKIM archive, and
remote-prover network access. DNS must also be unnecessary during proving: the
session-pinned DKIM key is the verifier trust anchor.

The offline harness must:

1. generate a proof from a local fixture using only pinned WASM/proving keys;
2. verify it using only the pinned verification key;
3. reject a substituted nonce, From domain, and DKIM public-key hash;
4. demonstrate safe duplicate-From and valid non-oversigned behavior;
5. exercise every canonicalization mode observed in the provider corpus; and
6. fail the test if any unexpected network request is attempted.

Only after these checks pass should the dynamic-domain verifier wrapper and
desktop/mobile proving benchmarks proceed.
