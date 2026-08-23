# Namebase resolver wrapper

`run-namebase-clean.sh` launches the external Namebase binary while restoring
the GNOME proxy settings and removing the `Namebase Local CA` trust entry when
the process exits. It also removes `.namebase/shd.pid` when that PID is dead.

The wrapper is intentionally not installed by the repository. Install it as
the command used by the local desktop launcher, for example:

```text
/path/to/core/ops/namebase/run-namebase-clean.sh
```

The `proxy-ca-orphaned.txt` file is retained as an audit ledger; the wrapper
removes active NSS trust, not historical fingerprints.
