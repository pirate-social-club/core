# Generic-assets 1157 production-shape rehearsal — 2026-08-13

## Scope

The authoritative production pool contained 106 allocated-and-loaded community
shards. `DB_CMTY_0073` was the largest by D1 `database_size` at 6,057,984 bytes
(5.78 MiB), with 88 tables. This run proves production schema, ledger-drift,
row-shape, index, and foreign-key fidelity. It is not the synthetic scale test.

The restricted export was sanitized mechanically. All 1,198 `TEXT`/`BLOB`
columns were classified: `schema_migrations` and schema-constrained columns were
preserved, while 854 unconstrained text columns received length-preserving
replacements. Before/after row counts, byte-length distributions, and exact
migration-ledger bytes matched. The restricted source and sanitized artifacts
were removed after the remote rehearsal.

## First-run finding

The original migration used positional `INSERT INTO ... SELECT *` copies for
three rebuilt tables. Production's historical `assets` physical column order
differed from the canonical checkout, causing values to shift into the wrong
target columns and the migration to fail at `assets_next.publication_status`.
The failed remote execution rolled back without transitional tables.

The migration now uses explicit, matching target/source column lists for all
four hot-table rebuilds. A regression test rejects future positional rebuilds.

## Passing run

- Migration SHA-256: `9441131cc7e187d156e402dc2c59b2001e3eebaddc0ec9776b371e6dd7962495`
- Production transport: `wrangler d1 execute --remote --file`
- D1 region/colo: `EEUR` / `ARN`
- Attempts: 1
- Statements: 71
- SQL duration: 61.6638 ms
- Rows read/written: 18,142 / 1,058
- Size before/after: 5,939,200 / 6,152,192 bytes
- Growth: 212,992 bytes (3.59%)
- Preserved rows: posts 29, assets 28, publish requests 22, moderation actions 3
- Required indexes: 8 of 8
- Forbidden transitional tables: 0
- Foreign-key violations: 0
- Sanitized byte-length distribution SHA-256:
  `34a9c3d7e6323164f4681c489c63b3fc3a57f46a1ff2fc89305876eda6b44fbd`
- Preserved `schema_migrations` projection SHA-256:
  `c4d516abe42c0c8697f2c812e26f4f7e7da4adb166ad3fed257acc06defe1250`

The 61.6638 ms SQL duration is far below the current 30-second D1 query limit;
the current real-shard run therefore has substantially more than the required
50 percent headroom. Synthetic 100× and 1000× rebuilt-table fixtures remain the
authority for forward scale evidence.

The real-shard shape rehearsal re-runs if the migration bytes change or when
the largest allocated-and-loaded shard crosses a new 100 MiB boundary.
