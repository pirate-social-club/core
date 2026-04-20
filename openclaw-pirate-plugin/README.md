# Pirate OpenClaw Connector

This package adds two OpenClaw tools:

- `connect_pirate`
- `check_pirate_connection`

The intended flow is:

1. Open Pirate and create a pairing code in `/settings/agents`.
2. In OpenClaw, ask it to connect to Pirate with that code.
3. Open the ClawKey verification URL returned by the tool.
4. Ask OpenClaw to check Pirate connection status.

The plugin persists the current pending connection in OpenClaw state so the status check can be repeated without re-entering the session id or token.
