import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPEC: MigrationSpec = {
  migration: "1089_community_assistant_text_and_voice_mode.sql",
  label: "community-template",
  requiredTables: ["communities", "community_assistant_policy"],
  creates: {
    kind: "columns_by_table",
    columns: [
      { table: "community_assistant_policy", column: "voice_mode" },
      { table: "community_assistant_policy", column: "stt_provider" },
      { table: "community_assistant_policy", column: "stt_model" },
      { table: "community_assistant_policy", column: "tts_provider" },
      { table: "community_assistant_policy", column: "tts_voice" },
    ],
  },
  replayableDdl: false,
  description: "Read-only fleet audit for the 1089 assistant-mode sibling migration.",
}

if (import.meta.main) {
  if (process.argv.includes("--execute")) throw new Error("audit scripts are read-only")
  await runFleetMigration(SPEC, "scripts/community/audit-1089-assistant-mode-d1-migration.ts")
}
