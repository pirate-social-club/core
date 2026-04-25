# Community Provision Operator VPS Assets

This directory contains tracked deployment assets for the private Turso community
provision operator.

Deployment assumption:

- the VPS keeps a full `core` checkout at `/srv/pirate-spaces/app`
- runtime secrets live in `/srv/pirate-spaces/config/community-provision-operator.env`
- the service binds to localhost and is exposed only through the configured private route

## Files

- `bin/start-community-provision-operator.sh`
  Starts the current operator entrypoint in the repo checkout.
- `env/community-provision-operator.env.example`
  Example runtime environment contract.
- `systemd/pirate-community-provision-operator.service`
  Tracked systemd unit template.

The wrapper intentionally runs `bun` directly, not `rtk`. `rtk` is a local CLI
convenience, not a VPS runtime dependency.
