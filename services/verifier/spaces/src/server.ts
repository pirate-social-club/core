import { json, requireBearerAuth } from "../../shared/http";
import { ChainHealthMonitor, parseExternalTipHeight } from "./chain-health";
import { rpc } from "./json-rpc";
import {
  type NativeExecutionConfig,
  resolveNativeExecutionConfig,
  runNative,
  decodeNativeJson,
} from "./native";
import { isRootHandleInput, normalizeRootLabel } from "./labels";
import { parsePublishedFallbackTargets, PublishedFallbackRegistry } from "./fallback-targets";
import {
  FabricRecordReaderUnavailableError,
  PublisherHealthMonitor,
  probePublisher,
  resolvePublisherExecutionConfig,
  runPublisher,
} from "./publisher-runtime";
import { ResolveCache, WorkLimiter, WorkQueueFullError } from "./resolve-control";
import { selectNavigationTargets } from "./resolved-targets";

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

type ServerInfo = {
  tip?: { height?: number };
};

type InspectNativeResult = {
  root_key_proof_verified?: boolean;
  root_pubkey?: string | null;
  proof_root_hash?: string | null;
  proved_outpoint?: string | null;
  failure_reason?: string | null;
  error?: string;
};

type ResolveFabricRecordsResult = {
  canonical_handle?: string | null;
  web_url?: string | null;
  freedom_url?: string | null;
  records?: Record<string, string[]>;
  sequence?: number;
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
      fabric_records_available: boolean;
      fabric_sequence: number | null;
      observation_provider: string | null;
      records: Record<string, string[]>;
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
// Production spaced retains 120 anchors at a 36-block cadence. Its historical
// proof selector deliberately leaves an eight-anchor safety margin, so a valid
// proof can be 111 intervals (3,996 blocks) behind the newest retained anchor.
const maxAnchorAgeBlocks = Number(Bun.env.SPACES_VERIFIER_MAX_ANCHOR_AGE_BLOCKS || "4032");
const bitcoinTipUrl = Bun.env.SPACES_BITCOIN_TIP_URL?.trim() || null;
const chainHealthIntervalMs = Number(Bun.env.SPACES_CHAIN_HEALTH_INTERVAL_MS || "60000");
const maxTipLagBlocks = Number(Bun.env.SPACES_CHAIN_MAX_TIP_LAG_BLOCKS || "6");
const maxAnchorLagBlocks = Number(Bun.env.SPACES_CHAIN_MAX_ANCHOR_LAG_BLOCKS || "108");
const verifierAuthToken = Bun.env.SPACES_VERIFIER_AUTH_TOKEN?.trim() || null;
const publishedTargetsFile = Bun.env.SPACES_PUBLISHED_TARGETS_FILE?.trim() || null;
const publishedTargetsJson = publishedTargetsFile
  ? await Bun.file(publishedTargetsFile).text()
  : Bun.env.SPACES_PUBLISHED_TARGETS_JSON?.trim() || "";
const nativeManifestPath = new URL("../native/Cargo.toml", import.meta.url).pathname;
const spacesPublisherDir = new URL("../../../../tools/spaces-publisher", import.meta.url).pathname;
const nativeBin = Bun.env.SPACES_VERIFIER_NATIVE_BIN?.trim() || null;
const spacesPublisherBin = Bun.env.SPACES_PUBLISHER_BIN?.trim() || null;
const spacesPublisherTimeoutMs = Number(Bun.env.SPACES_PUBLISHER_TIMEOUT_MS || "10000");
const spacesPublisherProbeHandle = Bun.env.SPACES_PUBLISHER_PROBE_HANDLE?.trim() || "@pirate";
const spacesPublisherProbeTimeoutMs = Number(Bun.env.SPACES_PUBLISHER_PROBE_TIMEOUT_MS || "60000");
const spacesPublisherKeepaliveIntervalMs = Number(Bun.env.SPACES_PUBLISHER_KEEPALIVE_INTERVAL_MS || "180000");
const resolveCacheTtlMs = Number(Bun.env.SPACES_RESOLVE_CACHE_TTL_MS || "30000");
const resolveCacheMaxEntries = Number(Bun.env.SPACES_RESOLVE_CACHE_MAX_ENTRIES || "2048");
const publisherMaxConcurrency = Number(Bun.env.SPACES_PUBLISHER_MAX_CONCURRENCY || "2");
const publisherMaxQueue = Number(Bun.env.SPACES_PUBLISHER_MAX_QUEUE || "32");
const allowNativeBuildFallback = ["1", "true", "yes", "on"].includes(
  String(Bun.env.SPACES_NATIVE_ALLOW_BUILD_FALLBACK || "").trim().toLowerCase(),
);
const nativeExecutionConfig: NativeExecutionConfig = resolveNativeExecutionConfig({
  nativeBin,
  allowNativeBuildFallback,
  nativeManifestPath,
});
const publisherExecutionConfig = resolvePublisherExecutionConfig({
  publisherBin: spacesPublisherBin,
});
const publisherHealth = new PublisherHealthMonitor();
const publisherLimiter = new WorkLimiter(publisherMaxConcurrency, publisherMaxQueue);
const resolveCache = new ResolveCache<ResolveFabricRecordsResult | null>(
  resolveCacheTtlMs,
  resolveCacheMaxEntries,
);
const fabricRelayDisagreementHandles = new Set<string>();
const chainHealth = new ChainHealthMonitor(maxTipLagBlocks, maxAnchorLagBlocks);

function recordFabricRelayDisagreement(handle: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("relay_disagreement")) {
    fabricRelayDisagreementHandles.add(handle);
  }
}

async function withPublisherPermit<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await publisherLimiter.run(work);
  } catch (error) {
    if (error instanceof WorkQueueFullError) {
      throw new FabricRecordReaderUnavailableError("Spaces Fabric record reader is at capacity");
    }
    throw error;
  }
}

async function refreshPublisherHealth(): Promise<void> {
  await publisherHealth.check(async () => {
    const result = await withPublisherPermit(() => probePublisher(publisherExecutionConfig, {
      cwd: spacesPublisherDir,
      timeoutMs: spacesPublisherProbeTimeoutMs,
      args: ["resolve", spacesPublisherProbeHandle],
    }));
    if (!result.ready) {
      console.error(`[spaces] Fabric record reader keepalive failed: ${result.error}`);
    }
    return result;
  });
}

const publishedFallbacks = new PublishedFallbackRegistry(
  parsePublishedFallbackTargets(publishedTargetsJson),
);

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

function readStringArrayRecord(records: Record<string, string[]> | null | undefined, key: string): string[] {
  const values = records?.[key] ?? [];
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
}

function spacedRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  return rpc<T>(spacedRpcUrl, spacedRpcAuthToken, method, params);
}

async function refreshChainHealth(): Promise<void> {
  await chainHealth.check(async () => {
    if (!bitcoinTipUrl) {
      throw new Error("SPACES_BITCOIN_TIP_URL is required");
    }
    const [serverInfo, anchors, externalTipResponse] = await Promise.all([
      spacedRpc<ServerInfo>("getserverinfo"),
      spacedRpc<RootAnchor[]>("getrootanchors"),
      fetch(bitcoinTipUrl, {
        headers: { accept: "text/plain" },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!externalTipResponse.ok) {
      throw new Error(`independent Bitcoin tip endpoint returned HTTP ${externalTipResponse.status}`);
    }
    const externalTipHeight = parseExternalTipHeight(await externalTipResponse.text());
    const indexedHeight = serverInfo.tip?.height;
    if (!Number.isInteger(indexedHeight)) {
      throw new Error("spaced getserverinfo returned no indexed tip height");
    }
    const newestAnchorHeight = anchors.reduce<number | null>(
      (newest, anchor) => newest == null || anchor.block.height > newest ? anchor.block.height : newest,
      null,
    );
    return { indexedHeight, externalTipHeight, newestAnchorHeight };
  });
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

  const liveOutpoint = typeof existingRoot.txid === "string" && Number.isInteger(existingRoot.n)
    ? `${existingRoot.txid}:${existingRoot.n}`
    : null;
  if (liveOutpoint == null) {
    return {
      root_exists: true,
      root_key_proof_verified: false,
      anchor_fresh_enough: false,
      accepted_anchor_height: null,
      accepted_anchor_block_hash: null,
      accepted_anchor_root_hash: null,
      proof_root_hash: null,
      root_pubkey: deriveTaprootPubkey(existingRoot.script_pubkey),
      control_class: "single_holder_root",
      operation_class: "owner_managed_namespace",
      observation_provider: "spaced_rpc+veritas_native",
      evidence_bundle_ref: null,
      failure_reason: "live_outpoint_missing",
      proof_payload: null,
    };
  }

  const [anchors, recentProof] = await Promise.all([
    spacedRpc<RootAnchor[]>("getrootanchors"),
    spacedRpc<ProofResult>("provespaceoutpoint", [`@${normalizedRootLabel}`]),
  ]);

  let proof = recentProof;
  let matchedAnchor = anchors.find((anchor) => anchor.root === proof.root) ?? null;
  if (matchedAnchor == null) {
    proof = await spacedRpc<ProofResult>("provespaceout", [liveOutpoint, false]);
    matchedAnchor = anchors.find((anchor) => anchor.root === proof.root) ?? null;
  }

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

  const newestHeight = anchors.reduce((max, anchor) => Math.max(max, anchor.block.height), 0);
  const native = decodeNativeJson<InspectNativeResult>(
    runNative(nativeExecutionConfig, [
      "inspect",
      `@${normalizedRootLabel}`,
      proof.proof,
      proof.root,
      liveOutpoint,
    ]),
  );
  const provedOutpoint = typeof native.proved_outpoint === "string" ? native.proved_outpoint : null;
  const rootPubkey = deriveTaprootPubkey(existingRoot.script_pubkey);
  const proofOutpointMatches = provedOutpoint != null && liveOutpoint != null && provedOutpoint === liveOutpoint;
  const anchorFreshEnough = matchedAnchor != null
    && newestHeight - matchedAnchor.block.height <= maxAnchorAgeBlocks;
  const rootKeyProofVerified = native.root_key_proof_verified === true
    && proofOutpointMatches
    && rootPubkey != null
    && anchorFreshEnough;

  return {
    root_exists: true,
    root_key_proof_verified: rootKeyProofVerified,
    anchor_fresh_enough: anchorFreshEnough,
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
  let result: Awaited<ReturnType<typeof runPublisher>>;
  try {
    result = await withPublisherPermit(() => runPublisher(publisherExecutionConfig, ["resolve", handle], {
      cwd: spacesPublisherDir,
      timeoutMs: spacesPublisherTimeoutMs,
    }));
  } catch (error) {
    recordFabricRelayDisagreement(handle, error);
    throw error;
  }
  let parsed: ResolveFabricRecordsResult;
  try {
    parsed = JSON.parse(result.stdout) as ResolveFabricRecordsResult;
  } catch (error) {
    throw new FabricRecordReaderUnavailableError(
      "Spaces Fabric record reader returned invalid JSON",
      { cause: error },
    );
  }
  if (parsed.error) {
    throw new FabricRecordReaderUnavailableError(parsed.error);
  }
  return parsed;
}

function resolveFabricRecordsCached(normalizedRootLabel: string): Promise<ResolveFabricRecordsResult | null> {
  const handle = `@${normalizedRootLabel}`;
  return resolveCache.getOrCreate(handle, () => resolveFabricRecords(handle).catch((error) => {
    console.warn(
      `[spaces] native fabric record lookup failed for ${handle}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }));
}

async function resolveHandle(handle: string): Promise<ResolveResponse> {
  const normalizedRootLabel = normalizeRootLabel(handle);
  const [inspection, fabricRecords] = await Promise.all([
    inspectRoot(normalizedRootLabel),
    resolveFabricRecordsCached(normalizedRootLabel),
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
  const handleKey = `@${normalizedRootLabel}`;
  const liveRootPubkey = typeof inspection.root_pubkey === "string" ? inspection.root_pubkey : null;
  const fallback = publishedFallbacks.targetFor(handleKey, liveRootPubkey);
  const selectedTargets = selectNavigationTargets({
    fabricAvailable: fabricRecords != null,
    native: { webUrl: nativeWebUrl, freedomUrl: nativeFreedomUrl },
    fallback: fallback ?? null,
  });
  if (fabricRecords != null) {
    publishedFallbacks.observeNative(handleKey, {
      webUrl: nativeWebUrl,
      freedomUrl: nativeFreedomUrl,
    });
  }

  return {
    resolved: true,
    handle: `@${normalizedRootLabel}`,
    canonical_handle: trimOptionalString(fabricRecords?.canonical_handle) ?? `@${normalizedRootLabel}`,
    root_pubkey: liveRootPubkey,
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
    web_url: selectedTargets.webUrl,
    freedom_url: selectedTargets.freedomUrl,
    fabric_records_available: fabricRecords != null,
    fabric_sequence: typeof fabricRecords?.sequence === "number" ? fabricRecords.sequence : null,
    observation_provider: appendObservationProvider(
      typeof inspection.observation_provider === "string" ? inspection.observation_provider : null,
      fabricRecords != null ? "fabric_zone" : null,
    ),
    records: fabricRecords?.records ?? {},
  };
}

async function verifyFabricPublish(body: {
  root_label?: string | null;
  txt_key?: string | null;
  txt_value?: string | null;
  web_url?: string | null;
  freedom_url?: string | null;
}) {
  const rootLabel = normalizeRootLabel(body.root_label ?? "");
  const txtKey = body.txt_key?.trim() || "pirate-verify";
  const txtValue = body.txt_value?.trim();
  const expectedWebUrl = body.web_url?.trim();
  const expectedFreedomUrl = body.freedom_url?.trim();

  if (!rootLabel || !txtKey || !txtValue || !expectedWebUrl || !expectedFreedomUrl) {
    return json(
      {
        error: "root_label, txt_key, txt_value, web_url, and freedom_url are required",
      },
      { status: 400 },
    );
  }

  const [inspection, fabricRecords] = await Promise.all([
    inspectRoot(rootLabel),
    resolveFabricRecords(`@${rootLabel}`),
  ]);
  await resolveCache.observeIfNewer(
    `@${rootLabel}`,
    fabricRecords,
    (candidate) => typeof candidate?.sequence === "number" ? candidate.sequence : null,
  );
  const records = fabricRecords.records ?? {};
  const observedTxtValues = readStringArrayRecord(records, txtKey);
  const observedWebUrl = trimOptionalString(fabricRecords.web_url);
  const observedFreedomUrl = trimOptionalString(fabricRecords.freedom_url);
  const txtVerified = observedTxtValues.includes(txtValue);
  const webVerified = observedWebUrl === expectedWebUrl;
  const freedomVerified = observedFreedomUrl === expectedFreedomUrl;
  const rootProofVerified = inspection.root_key_proof_verified === true;
  const verified = rootProofVerified && txtVerified && webVerified && freedomVerified;
  const failureReason = verified
    ? null
    : !inspection.root_exists
      ? "root_not_found"
      : !rootProofVerified
        ? (typeof inspection.failure_reason === "string" ? inspection.failure_reason : "proof_not_verifiable")
        : observedTxtValues.length === 0
          ? "pirate_verify_record_missing"
          : !txtVerified
            ? "pirate_verify_record_mismatch"
            : observedWebUrl == null
              ? "web_target_missing"
              : !webVerified
                ? "web_target_mismatch"
                : observedFreedomUrl == null
                  ? "freedom_target_missing"
                  : "freedom_target_mismatch";

  return json({
    fabric_publish_verified: verified,
    root_key_proof_verified: rootProofVerified,
    web_target_verified: webVerified,
    freedom_target_verified: freedomVerified,
    observed_web_url: observedWebUrl,
    observed_freedom_url: observedFreedomUrl,
    observed_txt_values: observedTxtValues,
    records,
    accepted_anchor_height: typeof inspection.accepted_anchor_height === "number" ? inspection.accepted_anchor_height : null,
    accepted_anchor_block_hash:
      typeof inspection.accepted_anchor_block_hash === "string" ? inspection.accepted_anchor_block_hash : null,
    accepted_anchor_root_hash:
      typeof inspection.accepted_anchor_root_hash === "string" ? inspection.accepted_anchor_root_hash : null,
    proof_root_hash: typeof inspection.proof_root_hash === "string" ? inspection.proof_root_hash : null,
    observation_provider: appendObservationProvider(
      typeof inspection.observation_provider === "string" ? inspection.observation_provider : null,
      "fabric_zone",
    ),
    failure_reason: failureReason,
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
      const fabricReaderHealth = publisherHealth.snapshot();
      const chainStateHealth = chainHealth.snapshot();
      const fallbackDisagreements = publishedFallbacks.disagreementSnapshot();
      const cacheHealth = resolveCache.snapshot();
      const publisherCapacity = publisherLimiter.snapshot();
      return json({
        ok: fabricReaderHealth.ready
          && fabricRelayDisagreementHandles.size === 0
          && chainStateHealth.ready,
        bind_host: verifierHost,
        bind_port: verifierPort,
        spaced_rpc_url: spacedRpcUrl,
        requires_bearer_auth: verifierAuthToken != null,
        requires_spaced_auth: spacedRpcAuthToken != null,
        native_execution_mode: nativeExecutionConfig.mode,
        fabric_record_reader_mode: publisherExecutionConfig.mode,
        fabric_record_reader_ready: fabricReaderHealth.ready,
        fabric_record_reader_checking: fabricReaderHealth.checking,
        fabric_record_reader_probe_handle: spacesPublisherProbeHandle,
        fabric_record_reader_last_checked_at: fabricReaderHealth.lastCheckedAt,
        fabric_record_reader_last_success_at: fabricReaderHealth.lastSuccessAt,
        fallback_target_disagreements: fallbackDisagreements.count,
        fallback_target_disagreement_handles: fallbackDisagreements.handles,
        fabric_relay_disagreements: fabricRelayDisagreementHandles.size,
        fabric_relay_disagreement_handles: Array.from(fabricRelayDisagreementHandles).sort(),
        chain_state_ready: chainStateHealth.ready,
        chain_state_checking: chainStateHealth.checking,
        indexed_height: chainStateHealth.indexed_height,
        external_tip_height: chainStateHealth.external_tip_height,
        newest_anchor_height: chainStateHealth.newest_anchor_height,
        tip_lag_blocks: chainStateHealth.tip_lag_blocks,
        anchor_lag_blocks: chainStateHealth.anchor_lag_blocks,
        last_index_progress_at: chainStateHealth.last_index_progress_at,
        chain_state_last_checked_at: chainStateHealth.last_checked_at,
        chain_state_last_success_at: chainStateHealth.last_success_at,
        chain_state_error: chainStateHealth.error,
        resolve_cache: cacheHealth,
        publisher_capacity: publisherCapacity,
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
      if (!isRootHandleInput(handle)) {
        return json({
          error: "unsupported_handle_type",
          message: "this endpoint resolves parent Spaces only",
        }, { status: 422 });
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

    if (url.pathname === "/verify-publish") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        const body = await request.json() as {
          root_label?: string | null;
          txt_key?: string | null;
          txt_value?: string | null;
          web_url?: string | null;
          freedom_url?: string | null;
        };
        return await verifyFabricPublish(body);
      } catch (error) {
        if (error instanceof FabricRecordReaderUnavailableError) {
          return json({
            error: "fabric_record_reader_unavailable",
            failure_reason: error.message,
          }, { status: 503 });
        }
        return json({
          error: error instanceof Error ? error.message : "publish verification failed",
        }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(
  `Spaces verifier listening on http://${verifierHost}:${verifierPort} using ${nativeExecutionConfig.mode}`,
);

void refreshPublisherHealth();
const publisherKeepalive = setInterval(() => {
  void refreshPublisherHealth();
}, spacesPublisherKeepaliveIntervalMs);
publisherKeepalive.unref?.();

void refreshChainHealth();
const chainHealthKeepalive = setInterval(() => {
  void refreshChainHealth();
}, chainHealthIntervalMs);
chainHealthKeepalive.unref?.();
