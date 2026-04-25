module github.com/pirate-v2/tools/spaces-publisher

go 1.25.0

require (
	github.com/btcsuite/btcd v0.25.0
	github.com/btcsuite/btcd/btcec/v2 v2.3.6
	github.com/btcsuite/btcd/btcutil v1.1.6
	github.com/spacesprotocol/fabric-go v0.0.0-20260424022927-568a298e6fe0
	github.com/spacesprotocol/libveritas-go v0.2.0
	golang.org/x/text v0.35.0
)

require (
	github.com/btcsuite/btcd/chaincfg/chainhash v1.1.0 // indirect
	github.com/btcsuite/btclog v0.0.0-20170628155309-84c8d2346e9f // indirect
	github.com/decred/dcrd/crypto/blake256 v1.0.0 // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.0.1 // indirect
	golang.org/x/crypto v0.25.0 // indirect
	golang.org/x/sys v0.22.0 // indirect
)

replace github.com/spacesprotocol/fabric-go => ./third_party/fabric-go
