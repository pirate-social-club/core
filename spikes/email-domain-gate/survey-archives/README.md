# Local mail-archive survey input

Raw mailbox archives are sensitive. Keep exports in this ignored directory or
pass an external absolute path to `survey-mail-archive.mjs`. Never commit,
upload, log, or attach an archive. Delete it under the spike's A3 retention rule
when the measurement is complete.

The survey output contains aggregate counts only. Live DKIM verification still
performs DNS TXT lookups, which disclose queried selector/domain names to the
configured DNS path. Use a recent explicit date window because old DKIM selector
records may have rotated away.
