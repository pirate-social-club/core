import type { Env } from "../types/env";
import type { AuthBootstrapStore } from "../lib/db";
import { authError } from "../lib/errors";
import { assembleProfile } from "../lib/profile-assembler";
import { verifyPirateAccessToken } from "../lib/pirate-session-jwt";
import { nowIso } from "../lib/time";
import type { JsonResponse, RequestLike } from "./http";
import { ok, requireBearerToken, toErrorResponse } from "./http";

type PatchProfileRequestBody = {
  display_name?: string;
  avatar_ref?: string | null;
  bio?: string | null;
};

export async function getProfilesMe(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const profileRow = await input.store.getProfileByUserId(session.userId);
    if (!profileRow) {
      throw authError();
    }
    const globalHandleRow = await input.store.getGlobalHandleById(profileRow.global_handle_id);
    if (!globalHandleRow) {
      throw authError();
    }
    return ok(assembleProfile({ profileRow, globalHandleRow }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function patchProfilesMe(input: {
  request: RequestLike;
  env: Env;
  store: AuthBootstrapStore;
}): Promise<JsonResponse<unknown>> {
  try {
    const token = requireBearerToken(input.request);
    const session = await verifyPirateAccessToken(token, input.env);
    const profileRow = await input.store.getProfileByUserId(session.userId);
    if (!profileRow) {
      throw authError();
    }

    const body = (await input.request.json()) as PatchProfileRequestBody;
    await input.store.withTransaction(async (tx) => {
      await tx.updateProfile({
        user_id: session.userId,
        display_name: body.display_name ?? profileRow.display_name,
        bio: body.bio === undefined ? profileRow.bio : body.bio,
        avatar_ref: body.avatar_ref === undefined ? profileRow.avatar_ref : body.avatar_ref,
        updated_at: nowIso(new Date()),
      });
    });

    const updatedProfileRow = await input.store.getProfileByUserId(session.userId);
    if (!updatedProfileRow) {
      throw authError();
    }
    const globalHandleRow = await input.store.getGlobalHandleById(updatedProfileRow.global_handle_id);
    if (!globalHandleRow) {
      throw authError();
    }
    return ok(assembleProfile({ profileRow: updatedProfileRow, globalHandleRow }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
