# Fresh-wallet Spaces publish and rebroadcast E2E

Status: owner ceremony required; no transaction is pre-authorized.

This exercise is for a disposable **Spaces `@root`** and a Spaces wallet managed by `space-cli`.
It does not use the Bob Handshake wallet, the `.pirate` HNS TLD, or any HNS resource records.

## Purpose

Prove the two remaining durability properties with a purpose-built fixture:

1. a fresh local wallet can publish a complete Fabric record set while retaining the exact signed
   envelope; and
2. a host with no wallet material can rebroadcast that envelope, after which an intentional clear
   becomes a verified-empty native result that suppresses Pirate's fallback.

## Owner gate

The owner must choose one disposable mainnet Spaces root. Do not infer that a root is disposable
from `listspaces`, its name, inactivity, or absence from Pirate. Record the selected root and the
wallet that currently controls it.

If the selected root is not already controlled by the fresh test wallet, transfer is a separate
on-chain ceremony. If it has not been initialized for off-chain operation, `operate` and the
required commitment are also on-chain Bitcoin transactions. `space-cli` broadcasts these commands;
there is no review packet in this runbook that makes them safe to run sight unseen.

Before any mutation, provide the owner with:

- selected `@root` and current outpoint;
- source and destination wallet labels and destination address, if transfer is needed;
- exact `transfer`, `operate`, or `commit` command;
- current fee-rate input and estimated fee;
- expected next covenant/outpoint;
- a statement that the root is disposable and its existing Fabric navigation may be removed.

The owner approves and runs each on-chain command locally. Never ask the owner to paste a mnemonic,
wallet export, descriptor, cookie, private key, or transaction-signing response into chat.

## Local constants

Use explicit local paths. The examples intentionally contain placeholders:

```bash
CLI=/absolute/path/to/space-cli
RPC_URL=http://127.0.0.1:7225
RPC_COOKIE=/absolute/path/to/mainnet/.cookie
TEST_WALLET=fresh_publish_e2e
ROOT=@owner-selected-disposable-root
WALLET_EXPORT=/absolute/private/path/fresh-publish-e2e-wallet.json
ARCHIVE_DIR=/absolute/private/path/signed-fabric-publications
PUBLISHER=/absolute/path/to/spaces-publisher-v0.1.5
```

Create `ARCHIVE_DIR` locally with mode `0700`. Wallet exports never leave this machine. Signed
Fabric envelopes are public signed data, but keep the archive private by default and back it up.

If `TEST_WALLET` does not exist, the owner creates it in a private local terminal and immediately
backs up the displayed recovery material. If it exists but is unloaded, the owner loads it:

```bash
"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" \
  createwallet -w "$TEST_WALLET"
"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" \
  loadwallet -w "$TEST_WALLET"
```

Run only the applicable command. Do not capture its output in an AI/session transcript.

## Read-only preflight

These commands must succeed before proposing a transaction:

```bash
"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" \
  --output-format json getserverinfo
"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" \
  --output-format json -w "$TEST_WALLET" getwalletinfo
"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" \
  --output-format json getspace "$ROOT"
"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" \
  --output-format json -w "$TEST_WALLET" listspaces
```

Stop if the wallet is not loaded, the root/outpoint differs from the review packet, or the daemon
is not at the expected chain state.

## On-chain preparation

Do not copy commands from this section directly into a signing shell. Substitute the reviewed
root, wallet, destination, and fee rate, then show the exact command and estimated fee to the owner.

Commands that may be required, depending on current state:

```bash
"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" -w CURRENT_WALLET \
  transfer --fee-rate REVIEWED_SAT_PER_VB "$ROOT" --to REVIEWED_DESTINATION_ADDRESS

"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" -w "$TEST_WALLET" \
  operate --fee-rate REVIEWED_SAT_PER_VB "$ROOT"

"$CLI" --rpc-url "$RPC_URL" --rpc-cookie "$RPC_COOKIE" -w "$TEST_WALLET" \
  commit --fee-rate REVIEWED_SAT_PER_VB "$ROOT" REVIEWED_ROOT_HASH
```

Wait for the protocol-required confirmation/state transition after each transaction and repeat the
read-only preflight. Never guess that `commit` is required or invent its root hash; derive it from
the exact publisher/daemon flow being exercised.

## Complete publication with retention

Export the fresh wallet only to `WALLET_EXPORT` on the local machine. Obtain a fresh Pirate
namespace-verification session and record its exact `txt_key`, `txt_value`, `web_url`, and
`freedom_url`. Then run locally:

```bash
"$PUBLISHER" publish "$ROOT" \
  --wallet-export "$WALLET_EXPORT" \
  --web 'REVIEWED_WEB_URL' \
  --freedom 'REVIEWED_FREEDOM_URL' \
  --txt 'REVIEWED_TXT_KEY=REVIEWED_TXT_VALUE' \
  --signed-message-out "$ARCHIVE_DIR/complete-SESSION_ID.fabric-message"
```

Acceptance evidence:

- output says `published=true` and `signed_message_saved=true`;
- independently computed archive SHA-256 equals `message_sha256`;
- public resolve reports Fabric available, the emitted sequence, and all expected records;
- Pirate completes the namespace-verification session.

## Wallet-free rebroadcast

Copy only `complete-SESSION_ID.fabric-message` to the rebroadcast host. Do not copy the wallet
export. Run publisher v0.1.5 there:

```bash
spaces-publisher rebroadcast \
  --message-file /path/to/complete-SESSION_ID.fabric-message \
  --seeds https://relay-cosmos.spacesprotocol.org,https://relay-atlas.spacesprotocol.org
```

Require `rebroadcasted=true` and the same independently computed SHA-256. Resolve through fresh
processes afterward and require the same selected sequence and targets; rebroadcast must not create
a new sequence.

## Create and verify the intentional empty fixture

Back on the wallet machine, clear every navigation and verification key while retaining the new
signed envelope:

```bash
"$PUBLISHER" clear "$ROOT" \
  --wallet-export "$WALLET_EXPORT" \
  --key web \
  --key freedom \
  --key pirate-verify \
  --signed-message-out "$ARCHIVE_DIR/empty-SESSION_ID.fabric-message"
```

Require the new sequence to be higher than the complete publication. Across twenty consecutive,
paced, fresh-process reads, require:

- Fabric state is available;
- the selected sequence is the clear sequence;
- records contain no `web`, `freedom`, or `pirate-verify` value;
- `web_url` and `freedom_url` are null even if a reviewed fallback exists;
- relay and native/fallback disagreement telemetry remains zero.

Finally, rebroadcast the empty envelope without wallet material and repeat the same assertions.
This proves verified-empty precedence and the retention/rebroadcast path together.

## Stop conditions

Stop immediately on any unexpected outpoint, covenant, fee, sequence, digest, target, relay
disagreement, or fallback appearance. Do not compensate by publishing again: first determine
whether the retained envelope is current and whether rebroadcast—not a new signature—is correct.
