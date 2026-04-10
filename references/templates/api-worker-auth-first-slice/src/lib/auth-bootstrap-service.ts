import type { SessionExchangeResponse } from "../types/api";
import type { Env } from "../types/env";
import type { AuthBootstrapStore, AuthBootstrapTx } from "./db";
import { UniqueConstraintError } from "./db";
import { internalError } from "./errors";
import { createId } from "./ids";
import { generateHandleCandidate } from "./handle-generator";
import { deriveOnboardingStatus } from "./onboarding-deriver";
import { assembleProfile } from "./profile-assembler";
import { signPirateAccessToken } from "./pirate-session-jwt";
import type { PrivyWalletClaim } from "./privy-token-verifier";
import { verifyPrivyAccessToken, verifyPrivyIdentityToken } from "./privy-token-verifier";
import { assembleSessionExchangeResponse } from "./session-exchange-response";
import { nowIso } from "./time";
import { serializeUser } from "./user-serializer";
import { verifyUpstreamJwt } from "./upstream-jwt-verifier";
import { buildDefaultVerificationCapabilitiesJson } from "./verification-serializer";
import { serializeWalletAttachments } from "./wallet-serializer";

async function loadResolvedUser(
  store: Pick<
    AuthBootstrapStore,
    "getUser" | "getProfileByUserId" | "getGlobalHandleById" | "listActiveWalletAttachments"
  >,
  userId: string,
) {
  const userRow = await store.getUser(userId);
  if (!userRow) {
    throw internalError("Resolved user row is missing");
  }

  const profileRow = await store.getProfileByUserId(userId);
  if (!profileRow) {
    throw internalError("Resolved profile row is missing");
  }

  const globalHandleRow = await store.getGlobalHandleById(profileRow.global_handle_id);
  if (!globalHandleRow) {
    throw internalError("Resolved global handle row is missing");
  }

  const walletRows = await store.listActiveWalletAttachments(userId);

  return {
    userRow,
    profileRow,
    globalHandleRow,
    walletRows,
  };
}

type ResolvedUser = Awaited<ReturnType<typeof loadResolvedUser>>;

type ResolvedIdentity = {
  provider: string;
  providerSubject: string;
  providerUserRef: string | null;
  wallets?: PrivyWalletClaim[];
};

async function buildResponse(input: {
  resolved: ResolvedUser;
  env: Env;
  store: AuthBootstrapStore;
  now: Date;
}): Promise<SessionExchangeResponse> {
  const accessToken = await signPirateAccessToken({
    userId: input.resolved.userRow.user_id,
    env: input.env,
    now: input.now,
  });

  const [
    latestNamespaceVerificationRow,
    latestNamespaceVerificationSessionRow,
    latestRedditVerificationRow,
    latestRedditImportJobRow,
    latestRedditSnapshotRow,
  ] = await Promise.all([
    input.store.getLatestNamespaceVerificationForUser(input.resolved.userRow.user_id),
    input.store.getLatestNamespaceVerificationSessionForUser(input.resolved.userRow.user_id),
    input.store.getLatestRedditVerificationSessionForUser(input.resolved.userRow.user_id),
    input.store.getLatestJobByTypeAndSubject("reddit_snapshot_import", "user", input.resolved.userRow.user_id),
    input.store.getLatestExternalReputationSnapshotForUser(input.resolved.userRow.user_id),
  ]);

  return assembleSessionExchangeResponse({
    accessToken,
    user: serializeUser(input.resolved.userRow),
    profile: assembleProfile({
      profileRow: input.resolved.profileRow,
      globalHandleRow: input.resolved.globalHandleRow,
    }),
    onboarding: deriveOnboardingStatus({
      activeGlobalHandleRow: input.resolved.globalHandleRow,
      userRow: input.resolved.userRow,
      latestNamespaceVerificationRow,
      latestNamespaceVerificationSessionRow,
      latestRedditVerificationRow,
      latestRedditImportJobRow,
      latestRedditSnapshotRow,
    }),
    walletAttachments: serializeWalletAttachments(input.resolved.walletRows),
  });
}

async function createBootstrapRows(tx: AuthBootstrapTx, createdAt: string, identity: ResolvedIdentity): Promise<string> {
  const userId = createId("usr");
  const authProviderLinkId = createId("apl");

  await tx.insertUser({
    user_id: userId,
    verification_capabilities_json: buildDefaultVerificationCapabilitiesJson(),
    created_at: createdAt,
    updated_at: createdAt,
  });

  let insertedGlobalHandle = false;
  let attempts = 0;
  let lastGlobalHandleId = "";

  while (!insertedGlobalHandle && attempts < 12) {
    attempts += 1;
    const candidate = generateHandleCandidate();
    lastGlobalHandleId = createId("ghd");

    try {
      await tx.insertGlobalHandle({
        global_handle_id: lastGlobalHandleId,
        user_id: userId,
        label_normalized: candidate.labelNormalized,
        label_display: candidate.labelDisplay,
        issued_at: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
      });
      insertedGlobalHandle = true;
    } catch (error) {
      if (!(error instanceof UniqueConstraintError) || error.field !== "global_handles.label_normalized") {
        throw error;
      }
    }
  }

  if (!insertedGlobalHandle) {
    throw new Error("Could not allocate a generated global handle after repeated retries");
  }

  await tx.insertProfile({
    user_id: userId,
    global_handle_id: lastGlobalHandleId,
    created_at: createdAt,
    updated_at: createdAt,
  });

  await tx.insertAuthProviderLink({
    auth_provider_link_id: authProviderLinkId,
    user_id: userId,
    provider: identity.provider,
    provider_subject: identity.providerSubject,
    provider_user_ref: identity.providerUserRef,
    linked_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
  });

  return userId;
}

function walletKey(wallet: PrivyWalletClaim): string {
  return `${wallet.chainNamespace}:${wallet.walletAddressNormalized}`;
}

function walletRowKey(wallet: { chain_namespace: string; wallet_address_normalized: string }): string {
  return `${wallet.chain_namespace}:${wallet.wallet_address_normalized}`;
}

async function attachWalletsToUser(input: {
  tx: AuthBootstrapTx;
  userId: string;
  identity: ResolvedIdentity;
  createdAt: string;
}) {
  const wallets = input.identity.wallets ?? [];
  if (wallets.length === 0) {
    return;
  }

  const existingWallets = await input.tx.listActiveWalletAttachments(input.userId);
  const existingWalletKeys = new Set(existingWallets.map(walletRowKey));
  const hasPrimaryWallet = existingWallets.some((wallet) => wallet.is_primary === 1);
  let primaryAssigned = hasPrimaryWallet;

  for (const wallet of wallets) {
    if (existingWalletKeys.has(walletKey(wallet))) {
      continue;
    }

    const wantsPrimary = !primaryAssigned && wallet.chainNamespace.startsWith("eip155");
    const walletAttachmentId = createId("wat");

    const insertWallet = async (isPrimary: 0 | 1) => {
      await input.tx.insertWalletAttachment({
        wallet_attachment_id: walletAttachmentId,
        user_id: input.userId,
        chain_namespace: wallet.chainNamespace,
        wallet_address_normalized: wallet.walletAddressNormalized,
        wallet_address_display: wallet.walletAddressDisplay,
        source_provider: input.identity.provider,
        source_subject: input.identity.providerSubject,
        attachment_kind: "embedded",
        is_primary: isPrimary,
        status: "active",
        attached_at: input.createdAt,
        detached_at: null,
        created_at: input.createdAt,
        updated_at: input.createdAt,
      });
    };

    try {
      await insertWallet(wantsPrimary ? 1 : 0);
      existingWalletKeys.add(walletKey(wallet));
      if (wantsPrimary) {
        await input.tx.updateUserPrimaryWalletAttachment({
          user_id: input.userId,
          primary_wallet_attachment_id: walletAttachmentId,
          updated_at: input.createdAt,
        });
        primaryAssigned = true;
      }
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) {
        throw error;
      }

      if (error.field === "wallet_attachments.user_wallet") {
        existingWalletKeys.add(walletKey(wallet));
        continue;
      }

      if (error.field === "wallet_attachments.primary" && wantsPrimary) {
        try {
          await insertWallet(0);
          existingWalletKeys.add(walletKey(wallet));
        } catch (retryError) {
          if (!(retryError instanceof UniqueConstraintError) || retryError.field !== "wallet_attachments.user_wallet") {
            throw retryError;
          }
          existingWalletKeys.add(walletKey(wallet));
        }
        primaryAssigned = true;
        continue;
      }

      throw error;
    }
  }
}

async function exchangeResolvedIdentity(input: {
  identity: ResolvedIdentity;
  env: Env;
  store: AuthBootstrapStore;
  now: Date;
}): Promise<SessionExchangeResponse> {
  const { identity } = input;

  try {
    const resolved = await input.store.withTransaction(async (tx) => {
      const existing = await tx.findActiveAuthProviderLink(identity.provider, identity.providerSubject);
      const createdAt = nowIso(input.now);

      if (existing) {
        await attachWalletsToUser({
          tx,
          userId: existing.user_id,
          identity,
          createdAt,
        });
        return loadResolvedUser(tx, existing.user_id);
      }

      const userId = await createBootstrapRows(tx, createdAt, identity);
      await attachWalletsToUser({
        tx,
        userId,
        identity,
        createdAt,
      });
      return loadResolvedUser(tx, userId);
    });

    return buildResponse({
      resolved,
      env: input.env,
      store: input.store,
      now: input.now,
    });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError) || error.field !== "auth_provider_links.provider_subject") {
      throw error;
    }

    const existing = await input.store.findActiveAuthProviderLink(identity.provider, identity.providerSubject);
    if (!existing) {
      throw error;
    }

    if ((identity.wallets?.length ?? 0) > 0) {
      await input.store.withTransaction(async (tx) => {
        await attachWalletsToUser({
          tx,
          userId: existing.user_id,
          identity,
          createdAt: nowIso(input.now),
        });
      });
    }

    const resolved = await loadResolvedUser(input.store, existing.user_id);
    return buildResponse({
      resolved,
      env: input.env,
      store: input.store,
      now: input.now,
    });
  }
}

export async function buildSessionExchangeForUser(input: {
  userId: string;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}): Promise<SessionExchangeResponse> {
  const now = input.now ?? new Date();
  const resolved = await loadResolvedUser(input.store, input.userId);
  return buildResponse({
    resolved,
    env: input.env,
    store: input.store,
    now,
  });
}

export async function exchangeJwtSession(input: {
  upstreamJwt: string;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}): Promise<SessionExchangeResponse> {
  const now = input.now ?? new Date();
  const validated = await verifyUpstreamJwt(input.upstreamJwt, input.env);

  return exchangeResolvedIdentity({
    identity: {
      provider: "jwt",
      providerSubject: `${validated.iss}|${validated.sub}`,
      providerUserRef: validated.sub,
      wallets: [],
    },
    env: input.env,
    store: input.store,
    now,
  });
}

export async function exchangePrivySession(input: {
  privyAccessToken: string;
  privyIdentityToken?: string | null;
  env: Env;
  store: AuthBootstrapStore;
  now?: Date;
}): Promise<SessionExchangeResponse> {
  const now = input.now ?? new Date();
  const access = await verifyPrivyAccessToken(input.privyAccessToken, input.env);
  const wallets = input.privyIdentityToken
    ? await verifyPrivyIdentityToken({
        token: input.privyIdentityToken,
        env: input.env,
        expectedUserId: access.userId,
      })
    : [];

  return exchangeResolvedIdentity({
    identity: {
      provider: "privy",
      providerSubject: access.userId,
      providerUserRef: access.userId,
      wallets,
    },
    env: input.env,
    store: input.store,
    now,
  });
}
