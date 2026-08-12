# HNS and Spaces runtime closure policy

Each production executable belongs to exactly one integrity class:

1. **Release-contained** — copied or built into an immutable role/app release
   and covered by its file-set manifest.
2. **Digest-pinned container** — the running image is checked against the
   digest recorded in `DEPLOYMENT`.
3. **Host-pinned executable** — intentionally installed outside a release and
   listed by absolute path and digest in the role's root-owned
   `config/RUNTIME_SHA256SUMS`.
4. **Accepted base OS** — ordinary shell/core utilities whose integrity and
   updates belong to the host package-management and patching boundary. This
   is an explicit risk acceptance, not a claim that they are checksummed by the
   Pirate deployment verifier.

## Active-role classification

| Role | Executable or code | Class | Rationale |
| --- | --- | --- | --- |
| Spaces verifier | full app source tree | Release-contained | App commit, complete file set, and checksums are verified independently of the role. |
| Spaces verifier | `spaces-publisher` | Release-contained | Download archive and extracted binary digests are pinned before release staging. |
| Spaces verifier | `spaces-verifier-native` | Release-contained | Built from the exact clean core commit and included in release checksums. |
| Spaces verifier | `spaced` | Host-pinned executable | External chain reader and root-pubkey trust input; highest semantic severity. |
| Spaces verifier | `bun` | Host-pinned executable | Interpreter for the entire verified app tree. |
| HNS verifier | full app source tree | Release-contained | Dedicated app commit, complete file set, and checksums are verified independently of the backup role. |
| HNS verifier | `bun` | Host-pinned executable | Interpreter for the dedicated verifier app tree. |
| HNS gateway | full app source tree | Release-contained | App commit, complete file set, and checksums are verified. |
| HNS gateway | `bun` | Host-pinned executable | Interpreter for gateway routing and authorization logic. |
| Public TLS edge | custom `pirate-caddy` | Host-pinned executable | Terminates WebPKI/DANE TLS and supplies the rate-limit module. |
| Authoritative/secondary DNS | PowerDNS image | Digest-pinned container | Deployment verification compares the live image digest with `DEPLOYMENT`. |
| HNS observer | hsd image | Digest-pinned container | Observer role owns its image pin and container verification. |
| All roles | release health/alert scripts | Release-contained | Invoked through the immutable role's `current/bin`. |
| All roles | `bash`, `env`, `dig`, `openssl`, `awk`, `grep`, `date`, `docker`, systemd | Accepted base OS | Broad operating-system trust boundary; monitored through host patching and access controls rather than per-role pins. |

The host manifests intentionally cover the three high-impact exceptions:
`spaced`, `bun`, and `pirate-caddy`. A replacement causes daily deployment
verification to fail even if every role and app file remains pristine.

Whenever a unit gains a new interpreter, daemon, or helper outside its release,
the reviewer must classify it here before deployment. Prefer moving it into the
release; use a host pin only where release containment is impractical.

Installed systemd fragments and generated Caddy JSON are not executables. Each
owning role records those absolute paths in `config/INSTALLED_SHA256SUMS`; the
manifest is covered by `CONFIG_SHA256`, and deployment verification checks the
installed bytes separately from `RUNTIME_SHA256SUMS`.
