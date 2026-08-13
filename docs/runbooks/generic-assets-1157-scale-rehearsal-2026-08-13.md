# Generic-assets 1157 synthetic scale rehearsal — 2026-08-13

## Fixture contract

The canonical pre-1157 migration history generated deterministic,
production-free fixtures from the measured largest-shard rebuilt-table counts:
posts 29, assets 28, publish requests 22, and moderation actions 3. Every
referenced parent row was generated and `PRAGMA foreign_key_check` was empty
before export. Both fixtures used 1,024-byte deterministic padding in hot
content fields and the D1-compatible remote import transport.

The exact migration SHA-256 was
`9441131cc7e187d156e402dc2c59b2001e3eebaddc0ec9776b371e6dd7962495`.

## 100×

- Rebuilt-table rows: 8,200
- Local fixture size: 29,036,544 bytes
- Import SQL size: 17,557,588 bytes
- Pre-migration remote size: 28,905,472 bytes
- Post-migration remote size: 29,126,656 bytes
- Growth: 221,184 bytes (0.77%)
- Migration SQL duration: 384.8293 ms
- Attempts: 1
- Rows read/written: 144,072 / 56,902
- Row-count mismatches: 0
- Foreign-key violations: 0

## 1000×

- Rebuilt-table rows: 82,000
- Local fixture size: 274,595,840 bytes
- Import SQL size: 174,673,514 bytes
- Pre-migration remote size: 273,076,224 bytes
- Post-migration remote size: 273,346,560 bytes
- Growth: 270,336 bytes (0.10%)
- Migration SQL duration: 6,555.2956 ms
- Attempts: 1
- Rows read/written: 1,284,778 / 564,502
- Row-count mismatches: 0
- Foreign-key violations: 0
- Forbidden transitional tables: 0

At the current 30-second D1 query limit, the 1000× migration consumed 21.85%
and retained 78.15% headroom. The fixture import took 31,304.0357 ms across
85,316 statements; that bulk-ingest duration is separate from the exact
71-statement migration execution and completed successfully through D1's
remote import transport.

Synthetic scale evidence re-runs if the migration bytes, applicable D1 limits,
or canonical fixture generator change.
