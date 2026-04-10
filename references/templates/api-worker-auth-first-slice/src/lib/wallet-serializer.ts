import type { WalletAttachmentSummary } from "../types/api";
import type { WalletAttachmentRow } from "../types/db";

export function serializeWalletAttachments(rows: WalletAttachmentRow[]): WalletAttachmentSummary[] {
  return rows.map((row) => ({
    wallet_attachment_id: row.wallet_attachment_id,
    chain_namespace: row.chain_namespace,
    wallet_address: row.wallet_address_display,
    is_primary: Boolean(row.is_primary),
  }));
}
