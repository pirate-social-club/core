import type { User } from "../types/api";
import type { UserRow } from "../types/db";
import { serializeVerificationCapabilities } from "./verification-serializer";

export function serializeUser(row: UserRow): User {
  return {
    user_id: row.user_id,
    primary_wallet_attachment_id: row.primary_wallet_attachment_id,
    verification_state: row.verification_state,
    capability_provider: row.capability_provider === "self" || row.capability_provider === "very"
      ? row.capability_provider
      : null,
    verification_capabilities: serializeVerificationCapabilities(row.verification_capabilities_json),
    verified_at: row.verified_at,
    nationality: row.nationality,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
