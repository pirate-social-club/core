# Private corpus

Place raw `.eml` samples in this directory. Everything except this README is
ignored by Git.

Rules:

- Use dedicated test mailboxes and an empty body where possible.
- Never commit, upload, log, or attach a raw sample to an issue.
- Do not encode an email address in a sample filename or inspector label.
- Share only manually reviewed inspector output.
- Delete raw samples when the spike ends.

Initial Proton pair:

1. Custom-domain Proton address sent to itself.
2. The same custom-domain Proton address sent to a personal external inbox and
   exported by that recipient.
3. Subject for both: `pirate-verify:test-proton-001`.

