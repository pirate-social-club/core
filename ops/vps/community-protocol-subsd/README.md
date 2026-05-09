# Community Protocol subsd VPS Assets

Persistent `subsd` runtime for Pirate community handle protocol issuance.

This service should run next to the existing Spaces verifier stack because it needs local access to
`spaced` and the operator wallet that can operate parent Spaces such as `@pesto`.

## Boundary

- `subsd` is internal-only. Do not expose it through Caddy or a public hostname.
- It binds through Docker host networking and is consumed by `community-protocol-issuer`.
- Its data directory is durable and must be backed up with the Spaces verifier data.
- It is safe to restart; local protocol state lives under `/srv/pirate-spaces/data/subsd`.

## Files

- `env/subsd.env.example`
  Runtime environment contract.
- `systemd/pirate-community-protocol-subsd.service`
  Docker-backed service unit.

## Deploy Shape

Build and push the image from the API repo:

```bash
rtk docker build --platform linux/amd64 -t t3333333k/community-protocol-subsd:staging services/community-protocol-subsd
rtk docker push t3333333k/community-protocol-subsd:staging
```

Current staging image:

```text
t3333333k/community-protocol-subsd@sha256:be9ac7cff697a576d7926707531e9b0c580c5368dfe7b06e59dd12c80cbf5618
```

On the VPS:

```bash
sudo mkdir -p /srv/pirate-spaces/config /srv/pirate-spaces/data/subsd
sudo cp ops/vps/community-protocol-subsd/env/subsd.env.example /srv/pirate-spaces/config/subsd.env
sudo cp ops/vps/community-protocol-subsd/systemd/pirate-community-protocol-subsd.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pirate-community-protocol-subsd.service
```

Then operate the parent Space once:

```bash
curl -fsS -X POST http://127.0.0.1:7777/spaces/%40pesto/operate
curl -fsS http://127.0.0.1:7777/spaces/%40pesto
```

Set the issuer:

```text
COMMUNITY_PROTOCOL_ISSUER_SUBSD_BASE_URL=http://127.0.0.1:7777
```

If the issuer runs on a different host, use a private network URL or an SSH tunnel. Do not publish
`subsd` on the internet.
