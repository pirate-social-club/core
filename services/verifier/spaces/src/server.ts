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

type ResolveFabricRecordsResult = {
  canonical_handle?: string | null;
  web_url?: string | null;
  freedom_url?: string | null;
  records?: Record<string, string[]>;
  error?: string;
};

type ResolveResponse =
  | {
      resolved: true;
      handle: string;
      canonical_handle: string;
      root_pubkey: string | null;
      outpoint: string | null;
      proof_verified: boolean;
      proof_root_hash: string | null;
      accepted_anchor_height: number | null;
      accepted_anchor_block_hash: string | null;
      accepted_anchor_root_hash: string | null;
      control_class: string | null;
      operation_class: string | null;
      web_url: string | null;
      freedom_url: string | null;
      observation_provider: string | null;
    }
  | {
      resolved: false;
      handle: string;
      reason: string;
    };

const spacedRpcUrl = Bun.env.SPACED_RPC_URL?.trim() || "http://127.0.0.1:7225";
const spacedRpcAuthToken = Bun.env.SPACED_RPC_AUTH_TOKEN?.trim() || null;
const verifierHost = Bun.env.SPACES_VERIFIER_HOST?.trim() || "0.0.0.0";
const verifierPort = Number(Bun.env.SPACES_VERIFIER_PORT || "4047");
const maxAnchorAgeBlocks = Number(Bun.env.SPACES_VERIFIER_MAX_ANCHOR_AGE_BLOCKS || "144");
const verifierAuthToken = Bun.env.SPACES_VERIFIER_AUTH_TOKEN?.trim() || null;
const publishedWebTargetsJson = Bun.env.SPACES_PUBLISHED_WEB_TARGETS_JSON?.trim() || "";
const nativeManifestPath = new URL("../native/Cargo.toml", import.meta.url).pathname;
const spacesPublisherDir = new URL("../../../../tools/spaces-publisher", import.meta.url).pathname;
const nativeBin = Bun.env.SPACES_VERIFIER_NATIVE_BIN?.trim() || null;
const spacesPublisherBin = Bun.env.SPACES_PUBLISHER_BIN?.trim() || null;
const spacesPublisherTimeoutMs = Number(Bun.env.SPACES_PUBLISHER_TIMEOUT_MS || "10000");
const allowNativeBuildFallback = ["1", "true", "yes", "on"].includes(
  String(Bun.env.SPACES_NATIVE_ALLOW_BUILD_FALLBACK || "").trim().toLowerCase(),
);
const nativeExecutionConfig: NativeExecutionConfig = resolveNativeExecutionConfig({
  nativeBin,
  allowNativeBuildFallback,
  nativeManifestPath,
});
const spacesPublisherCommand = spacesPublisherBin ? [spacesPublisherBin] : ["go", "run", "."];

function parsePublishedWebTargets(raw: string): Map<string, string> {
  if (!raw) {
    return new Map();
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const entries = Object.entries(parsed)
    .map(([handle, url]) => {
      const normalized = normalizeRootLabel(handle);
      const target = typeof url === "string" ? url.trim() : "";
      if (!normalized || !target) {
        return null;
      }
      return [`@${normalized}`, target] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry != null);

  return new Map(entries);
}

const publishedWebTargets = parsePublishedWebTargets(publishedWebTargetsJson);

function trimOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function appendObservationProvider(base: string | null, addition: string | null) {
  if (!base) {
    return addition;
  }
  if (!addition) {
    return base;
  }
  return base.includes(addition) ? base : `${base}+${addition}`;
}

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

async function resolveFabricRecords(handle: string): Promise<ResolveFabricRecordsResult> {
  const result = Bun.spawn([...spacesPublisherCommand, "resolve", handle], {
    cwd: spacesPublisherDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutId = setTimeout(() => {
    try {
      result.kill();
    } catch {
      // best effort timeout cleanup
    }
  }, spacesPublisherTimeoutMs);

  const [exitCode, stdout, stderr] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ]);
  clearTimeout(timeoutId);

  const normalizedStdout = stdout.trim();
  const normalizedStderr = stderr.trim();
  if (exitCode !== 0) {
    throw new Error(
      normalizedStderr || normalizedStdout || `spaces publisher resolve failed after ${spacesPublisherTimeoutMs}ms`,
    );
  }

  const parsed = JSON.parse(normalizedStdout) as ResolveFabricRecordsResult;
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return parsed;
}

async function resolveHandle(handle: string): Promise<ResolveResponse> {
  const normalizedRootLabel = normalizeRootLabel(handle);
  const [inspection, fabricRecords] = await Promise.all([
    inspectRoot(normalizedRootLabel),
    resolveFabricRecords(`@${normalizedRootLabel}`).catch((error) => {
      console.warn(
        `[spaces] native fabric record lookup failed for @${normalizedRootLabel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }),
  ]);

  if (inspection.root_exists !== true) {
    return {
      resolved: false,
      handle: `@${normalizedRootLabel}`,
      reason: typeof inspection.failure_reason === "string" ? inspection.failure_reason : "root_not_found",
    };
  }

  const nativeWebUrl = trimOptionalString(fabricRecords?.web_url);
  const nativeFreedomUrl = trimOptionalString(fabricRecords?.freedom_url);

  return {
    resolved: true,
    handle: `@${normalizedRootLabel}`,
    canonical_handle: trimOptionalString(fabricRecords?.canonical_handle) ?? `@${normalizedRootLabel}`,
    root_pubkey: typeof inspection.root_pubkey === "string" ? inspection.root_pubkey : null,
    outpoint:
      typeof inspection.proof_payload?.live_outpoint === "string"
        ? inspection.proof_payload.live_outpoint
        : null,
    proof_verified: inspection.root_key_proof_verified === true,
    proof_root_hash:
      typeof inspection.proof_root_hash === "string" ? inspection.proof_root_hash : null,
    accepted_anchor_height:
      typeof inspection.accepted_anchor_height === "number" ? inspection.accepted_anchor_height : null,
    accepted_anchor_block_hash:
      typeof inspection.accepted_anchor_block_hash === "string" ? inspection.accepted_anchor_block_hash : null,
    accepted_anchor_root_hash:
      typeof inspection.accepted_anchor_root_hash === "string" ? inspection.accepted_anchor_root_hash : null,
    control_class:
      typeof inspection.control_class === "string" ? inspection.control_class : null,
    operation_class:
      typeof inspection.operation_class === "string" ? inspection.operation_class : null,
    web_url: nativeWebUrl ?? publishedWebTargets.get(`@${normalizedRootLabel}`) ?? null,
    freedom_url: nativeFreedomUrl,
    observation_provider: appendObservationProvider(
      typeof inspection.observation_provider === "string" ? inspection.observation_provider : null,
      fabricRecords != null ? "fabric_zone" : null,
    ),
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
    const isPublicPath = url.pathname === "/health" || url.pathname === "/resolve";

    if (!isPublicPath) {
      const authResponse = requireBearerAuth(request, verifierAuthToken);
      if (authResponse) {
        return authResponse;
      }
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

    if (url.pathname === "/resolve") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const handle = url.searchParams.get("handle");
      if (!handle || !normalizeRootLabel(handle)) {
        return json({ error: "handle is required" }, { status: 400 });
      }

      try {
        return json(await resolveHandle(handle));
      } catch (error) {
        return json({
          resolved: false,
          handle: handle.trim(),
          reason: error instanceof Error ? error.message : "resolver_unavailable",
        }, { status: 500 });
      }
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
