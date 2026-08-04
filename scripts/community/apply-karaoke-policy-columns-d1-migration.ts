#!/usr/bin/env bun
/**
 * Operator catch-up for shards that skipped the contiguous 1095 -> 1098 block.
 *
 * The 2026-08-03 set-closure attestation found DB_CMTY_0078 and DB_CMTY_0079
 * (zero-content smoke-test communities copied verbatim from Turso at the
 * 2026-07-01 cutover) missing BOTH the ledger rows and the columns for
 *
 *   1095_community_assistant_telegram_preview_prompt_suffix.sql
 *   1096_community_karaoke_enabled.sql
 *   1098_community_karaoke_scoring_policy.sql        (numbering jumps 1096 -> 1098)
 *
 * while their ledgers otherwise advanced to the head (1150): the columns lived
 * only on an unmerged branch at copy time and were restored to main on 07-04
 * with no catch-up rollout. Those shards classify needs_migration here and get
 * the DDL + ledger row in one file; every other shard must already classify
 * ok_recorded.
 *
 * Deliberately NOT done: a shard with a 1095 ledger row but no column classifies
 * ledger_without_objects (BLOCKING) and the run refuses to write to it. That is
 * intended — the ledger claiming work the schema does not have is a different,
 * more dangerous drift and must be investigated by hand, never papered over with
 * a ledgerBackfillSql.
 *
 * One MigrationSpec per file, driven through the shared fleet machinery in
 * order; each runs to completion (or fails closed) before the next starts.
 * Read-only by default; --execute requires --confirm-time-travel, and fleet
 * writes require --resume-file. See lib/fleet-d1-migration.ts for the safety
 * properties. The fleet-wide proof this repair is done is a clean read-only
 * pass of audit-community-template-set-closure.ts.
 */

import { runFleetMigration, type MigrationSpec } from "./lib/fleet-d1-migration"

export const SPECS: MigrationSpec[] = [
  {
    migration: "1095_community_assistant_telegram_preview_prompt_suffix.sql",
    label: "community-template",
    requiredTables: ["community_assistant_policy"],
    creates: {
      kind: "columns",
      table: "community_assistant_policy",
      columns: ["telegram_preview_prompt_suffix_json"],
    },
    replayableDdl: false,
    description: "Telegram preview prompt suffix on the community assistant policy.",
  },
  {
    migration: "1096_community_karaoke_enabled.sql",
    label: "community-template",
    requiredTables: ["communities"],
    creates: {
      kind: "columns",
      table: "communities",
      columns: ["karaoke_enabled"],
    },
    replayableDdl: false,
    description: "Per-community karaoke feature toggle.",
  },
  {
    migration: "1098_community_karaoke_scoring_policy.sql",
    label: "community-template",
    requiredTables: ["communities"],
    creates: {
      kind: "columns",
      table: "communities",
      columns: [
        "karaoke_scoring_enabled",
        "karaoke_stt_provider",
        "karaoke_stt_model",
        "karaoke_voice_coach_enabled",
        "karaoke_audio_retention",
      ],
    },
    replayableDdl: false,
    description: "Karaoke scoring, STT, voice-coach, and audio-retention policy columns.",
  },
]

if (import.meta.main) {
  for (const spec of SPECS) {
    await runFleetMigration(
      spec,
      "scripts/community/apply-karaoke-policy-columns-d1-migration.ts",
    )
  }
}
