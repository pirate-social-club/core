import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    import.meta.dir,
    "../../db/control-plane/migrations/0237_control_plane_dance_telegram_capture_modes.sql",
  ),
  "utf8",
);

describe("dance Telegram capture-mode migration", () => {
  test("replaces the original capture-mode constraint", () => {
    expect(migration).toContain(
      "DROP CONSTRAINT dance_attempt_sessions_capture_mode_check",
    );
    expect(migration).toContain(
      "ADD CONSTRAINT dance_attempt_sessions_capture_mode_check",
    );
  });

  test("admits only browser and server-derived Telegram modes", () => {
    expect(migration).toContain("capture_mode IS NULL");
    expect(migration).toContain("'in_app_camera'");
    expect(migration).toContain("'telegram_video'");
    expect(migration).toContain("'telegram_document'");
    expect(migration).not.toContain("telegram_upload");
  });
});
