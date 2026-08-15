import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(import.meta.dir, "../../db/control-plane/migrations/0238_control_plane_dance_telegram_session_binding.sql"),
  "utf8",
);

describe("dance Telegram session-binding migration", () => {
  test("backfills existing sessions into the API envelope", () => {
    expect(migration).toContain("source_channel TEXT NOT NULL DEFAULT 'api'");
    expect(migration).toContain("source_channel IN ('api', 'telegram')");
    expect(migration).toContain("capture_mode IS NULL OR capture_mode = 'in_app_camera'");
  });

  test("binds Telegram sessions to bot, chat, sender, prompt, and media identity", () => {
    for (const column of [
      "telegram_bot_user_id",
      "telegram_chat_id",
      "telegram_sender_id",
      "telegram_prompt_message_id",
      "telegram_file_id",
      "telegram_file_unique_id",
      "telegram_delivery_mode",
    ]) expect(migration).toContain(column);
    expect(migration).toContain("capture_mode = 'telegram_' || telegram_delivery_mode");
  });

  test("enforces one active session per bot/chat/sender and unique prompt binding", () => {
    expect(migration).toContain("dance_attempt_sessions_one_active_telegram_sender");
    expect(migration).toContain("dance_attempt_sessions_telegram_prompt");
  });
});
