import { json, requireBearerAuth } from "../../shared/http";
import { rpc } from "./json-rpc";
import {
  type NativeExecutionConfig,
  resolveNativeExecutionConfig,
  runNative,
  decodeNativeJson,
} from "./native";
import { normalizeRootLabel } from "./labels";

type RootAnchor = {
  root: string;
  block: {
    hash: string;
    height: number;
  };
};

type ProofResult = {
  root: string;
  proof: string;
};

type RpcFullSpace = {
  txid?: string;
  n?: number;
  script_pubkey?: string | null;
};

type InspectNativeResult = {
  root_key_proof_verified?: boolean;
  root_pubkey?: string | null;
  proof_root_hash?: string | null;
  proved_outpoint?: string | null;
  failure_reason?: string | null;
  error?: string;
};

type VerifyNativeResult = {
  valid_signature?: boolean;
  failure_reason?: string | null;
  error?: string;
};

const spacedRpcUrl = Bun.env.SPACED_RPC_URL?.trim() || "http://127.0.0.1:7225";
const spacedRpcAuthToken = Bun.env.SPACED_RPC_AUTH_TOKEN?.trim() || null;
const verifierHost = Bun.env.SPACES_VERIFIER_HOST?.trim() || "0.0.0.0";
const verifierPort = Number(Bun.env.SPACES_VERIFIER_PORT || "4047");
const maxAnchorAgeBlocks = Number(Bun.env.SPACES_VERIFIER_MAX_ANCHOR_AGE_BLOCKS || "144");
const verifierAuthToken = Bun.env.SPACES_VERIFIER_AUTH_TOKEN?.trim() || null;
const nativeManifestPath = new URL("../native/Cargo.toml", import.meta.url).pathname;
const nativeBin = Bun.env.SPACES_VERIFIER_NATIVE_BIN?.trim() || null;
const allowNativeBuildFallback = ["1", "true", "yes", "on"].includes(
  String(Bun.env.SPACES_NATIVE_ALLOW_BUILD_FALLBACK || "").trim().toLowerCase(),
);

const nativeExecutionConfig: NativeExecutionConfig = resolveNativeExecutionConfig({
  nativeBin,
  allowNativeBuildFallback,
  nativeManifestPath,
});

function spacedRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  return rpc<T>(spacedRpcUrl, spacedRpcAuthToken, method, params);
}

export function deriveTaprootPubkey(scriptPubkey: string | null | undefined) {
  const normalized = scriptPubkey?.trim().toLowerCase() ?? "";
  return normalized.startsWith("5120") && normalized.length === 68
    ? normalized.slice(4)
    : null;
}

async function inspectRoot(rootLabel: string) {
  const normalizedRootLabel = normalizeRootLabel(rootLabel);
  const existingRoot = await spacedRpc<RpcFullSpace | null>("getspace", [`@${normalizedRootLabel}`]);
  if (existingRoot == null) {
    return {
      root_exists: false,
      root_key_proof_verified: false,
      anchor_fresh_enough: false,
      accepted_anchor_height: null,
      accepted_anchor_block_hash: null,
      accepted_anchor_root_hash: null,
      proof_root_hash: null,
      root_pubkey: null,
      control_class: "single_holder_root",
      operation_class: "owner_managed_namespace",
      observation_provider: "spaced_rpc+veritas_native",
      evidence_bundle_ref: null,
      failure_reason: "root_not_found",
      proof_payload: null,
    };
  }

  const anchors = await spacedRpc<RootAnchor[]>("getrootanchors");
  const proof = await spacedRpc<ProofResult>("provespaceoutpoint", [`@${normalizedRootLabel}`]);

  if (!proof.root || !proof.proof) {
    return {
      root_exists: false,
      root_key_proof_verified: false,
      anchor_fresh_enough: false,
      accepted_anchor_height: null,
      accepted_anchor_block_hash: null,
      accepted_anchor_root_hash: null,
      proof_root_hash: null,
      root_pubkey: null,
      control_class: "single_holder_root",
      operation_class: "owner_managed_namespace",
      observation_provider: "spaced_rpc+veritas_native",
      evidence_bundle_ref: null,
      failure_reason: "root_not_found",
      proof_payload: null,
    };
  }

  const matchedAnchor = anchors.find((anchor) => anchor.root === proof.root) ?? null;
  const newestHeight = anchors.reduce((max, anchor) => Math.max(max, anchor.block.height), 0);
  const native = decodeNativeJson<InspectNativeResult>(
    runNative(nativeExecutionConfig, ["inspect", `@${normalizedRootLabel}`, proof.proof, proof.root]),
  );
  const provedOutpoint = typeof native.proved_outpoint === "string" ? native.proved_outpoint : null;
  const liveOutpoint = typeof existingRoot.txid === "string" && Number.isInteger(existingRoot.n)
    ? `${existingRoot.txid}:${existingRoot.n}`
    : null;
  const rootPubkey = deriveTaprootPubkey(existingRoot.script_pubkey);
  const proofOutpointMatches = provedOutpoint != null && liveOutpoint != null && provedOutpoint === liveOutpoint;
  const rootKeyProofVerified = native.root_key_proof_verified === true && proofOutpointMatches && rootPubkey != null;

  return {
    root_exists: true,
    root_key_proof_verified: rootKeyProofVerified,
    anchor_fresh_enough: matchedAnchor != null
      ? newestHeight - matchedAnchor.block.height <= maxAnchorAgeBlocks
      : false,
    accepted_anchor_height: matchedAnchor?.block.height ?? null,
    accepted_anchor_block_hash: matchedAnchor?.block.hash ?? null,
    accepted_anchor_root_hash: matchedAnchor?.root ?? null,
    proof_root_hash: native.proof_root_hash ?? proof.root,
    root_pubkey: rootPubkey,
    control_class: "single_holder_root",
    operation_class: "owner_managed_namespace",
    observation_provider: "spaced_rpc+veritas_native",
    evidence_bundle_ref: null,
    failure_reason: native.failure_reason
      ?? (native.root_key_proof_verified !== true
        ? "proof_not_verifiable"
        : !proofOutpointMatches
          ? "proof_outpoint_mismatch"
          : rootPubkey == null
            ? "unsupported_script_pubkey"
        : matchedAnchor == null
          ? "proof_root_mismatch"
          : newestHeight - matchedAnchor.block.height > maxAnchorAgeBlocks
            ? "anchor_set_stale"
            : null),
    proof_payload: {
      proof_base64: proof.proof,
      proof_root: proof.root,
      proved_outpoint: provedOutpoint,
      live_outpoint: liveOutpoint,
    },
  };
}

async function verifySignature(body: {
  digest?: string | null;
  signature?: string | null;
  root_pubkey?: string | null;
  signer_pubkey?: string | null;
}) {
  const digest = body.digest?.trim();
  const signature = body.signature?.trim();
  const rootPubkey = body.root_pubkey?.trim();
  const signerPubkey = body.signer_pubkey?.trim() || null;

  if (!digest || !signature || !rootPubkey) {
    return json(
      {
        error: "digest, signature, and root_pubkey are required",
      },
      { status: 400 },
    );
  }

  if (signerPubkey && signerPubkey !== rootPubkey) {
    return json({
      valid_signature: false,
      wrong_signer: true,
      observation_provider: "spaces_verifier_native",
      failure_reason: "wrong_signer",
    });
  }

  const native = decodeNativeJson<VerifyNativeResult>(
    runNative(nativeExecutionConfig, ["verify-schnorr", digest, signature, rootPubkey]),
  );

  return json({
    valid_signature: native.valid_signature === true,
    wrong_signer: false,
    observation_provider: "spaces_verifier_native",
    failure_reason: native.failure_reason ?? null,
  });
}

Bun.serve({
  hostname: verifierHost,
  port: verifierPort,
  async fetch(request) {
    const url = new URL(request.url);
    const authResponse = requireBearerAuth(request, verifierAuthToken);
    if (authResponse) {
      return authResponse;
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        bind_host: verifierHost,
        bind_port: verifierPort,
        spaced_rpc_url: spacedRpcUrl,
        requires_bearer_auth: verifierAuthToken != null,
        requires_spaced_auth: spacedRpcAuthToken != null,
        native_execution_mode: nativeExecutionConfig.mode,
      });
    }

    if (url.pathname === "/" || url.pathname === "/inspect") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const rootLabel = url.searchParams.get("root_label");
      if (!rootLabel || !normalizeRootLabel(rootLabel)) {
        return json({ error: "root_label is required" }, { status: 400 });
      }

      try {
        return json(await inspectRoot(rootLabel));
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "inspect failed",
        }, { status: 500 });
      }
    }

    if (url.pathname === "/verify-signature") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as {
          digest?: string | null;
          signature?: string | null;
          root_pubkey?: string | null;
          signer_pubkey?: string | null;
        };
        return await verifySignature(body);
      } catch (error) {
        return json({
          error: error instanceof Error ? error.message : "signature verification failed",
        }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(
  `Spaces verifier listening on http://${verifierHost}:${verifierPort} using ${nativeExecutionConfig.mode}`,
);
