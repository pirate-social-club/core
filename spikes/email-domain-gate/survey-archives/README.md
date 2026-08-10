# Local mail-archive survey input

Raw mailbox archives are sensitive. Keep exports in this ignored directory or
pass an external absolute path to `survey-mail-archive.mjs`. Never commit,
upload, log, or attach an archive. Delete it under the spike's A3 retention rule
when the measurement is complete.

The survey output contains aggregate counts only. Archive mode trusts only the
explicitly configured receiving provider's stored `Authentication-Results` and
makes no DNS or HTTP requests. This avoids disclosing a correspondence graph and
avoids false negatives after old DKIM selectors rotate away. Use an explicit
recent date window so the measured correspondence population is reviewable.
