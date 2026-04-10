import type { GlobalHandle, Profile } from "../types/api";
import type { GlobalHandleRow, ProfileRow } from "../types/db";

export function assembleGlobalHandle(row: GlobalHandleRow): GlobalHandle {
  return {
    global_handle_id: row.global_handle_id,
    label: row.label_display,
    tier: row.tier,
    status: row.status,
    issuance_source: row.issuance_source,
    redirect_target_global_handle_id: row.redirect_target_global_handle_id,
    price_paid_usd: row.price_paid_usd,
    free_rename_consumed: Boolean(row.free_rename_consumed),
    issued_at: row.issued_at,
    replaced_at: row.replaced_at,
  };
}

export function assembleProfile(input: {
  profileRow: ProfileRow;
  globalHandleRow: GlobalHandleRow;
}): Profile {
  const { profileRow, globalHandleRow } = input;

  return {
    user_id: profileRow.user_id,
    display_name: profileRow.display_name,
    avatar_ref: profileRow.avatar_ref,
    bio: profileRow.bio,
    // The current control-plane profile row has no preferred_locale column.
    // Keep this null until the runtime schema grows that field.
    preferred_locale: null,
    primary_wallet_address: null,
    verification_capabilities: null,
    global_handle: assembleGlobalHandle(globalHandleRow),
    created_at: profileRow.created_at,
    updated_at: profileRow.updated_at,
  };
}
