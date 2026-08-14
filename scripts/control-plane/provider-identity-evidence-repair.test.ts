import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildRepairPlan,
  type AttestationRepairRow,
} from "./provider-identity-evidence-repair";

function row(overrides: Partial<AttestationRepairRow> = {}): AttestationRepairRow {
  const valueJsonText = overrides.value_json_text ?? '{"state":"verified"}';
  return {
    user_attestation_id: "att_default",
    user_id: "usr_default",
    source_verification_session_id: "ver_default",
    source_identity_nullifier_id: null,
    provider: "self",
    attestation_type: "unique_human",
    capability_key: "unique_human",
    status: "accepted",
    value_json: JSON.parse(valueJsonText),
    value_json_text: valueJsonText,
    verified_at: "2026-08-01T00:00:00.000Z",
    expires_at: "2026-09-01T00:00:00.000Z",
    revoked_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    nullifier_link_count: 0,
    valid_nullifier_link_count: 0,
    invalid_nullifier_link_count: 0,
    ...overrides,
  };
}

const NOW = Date.parse("2026-08-13T00:00:00.000Z");

test("keeps the linked duplicate, supersedes unbound rows, and expires stale rows", () => {
  const plan = buildRepairPlan([
    row({
      user_attestation_id: "att_linked",
      user_id: "usr_one",
      verified_at: "2026-08-02T00:00:00.000Z",
      created_at: "2026-08-02T00:00:00.000Z",
      nullifier_link_count: 1,
      valid_nullifier_link_count: 1,
    }),
    row({
      user_attestation_id: "att_unbound_duplicate",
      user_id: "usr_one",
      verified_at: "2026-08-03T00:00:00.000Z",
      created_at: "2026-08-03T00:00:00.000Z",
    }),
    row({
      user_attestation_id: "att_unbound_other",
      user_id: "usr_two",
      verified_at: "2026-08-04T00:00:00.000Z",
      created_at: "2026-08-04T00:00:00.000Z",
    }),
    row({
      user_attestation_id: "att_expired_document",
      capability_key: "nationality",
      attestation_type: "nationality",
      expires_at: "2026-08-01T00:00:00.000Z",
    }),
    row({
      user_attestation_id: "att_expired_human",
      expires_at: "2026-08-01T00:00:00.000Z",
    }),
  ], NOW);

  expect(plan.duplicateGroups).toEqual([{
    key: "usr_one\u001fself\u001funique_human",
    winnerUserAttestationId: "att_linked",
    loserUserAttestationIds: ["att_unbound_duplicate"],
  }]);
  expect(plan.supersede).toEqual([
    {
      userAttestationId: "att_unbound_duplicate",
      reason: "provenance_unbound",
      duplicateGroupKey: "usr_one\u001fself\u001funique_human",
    },
    {
      userAttestationId: "att_unbound_other",
      reason: "provenance_unbound",
      duplicateGroupKey: null,
    },
  ]);
  expect(plan.expire.map((mutation) => mutation.userAttestationId)).toEqual([
    "att_expired_document",
    "att_expired_human",
  ]);
  expect(plan.supersede.some((mutation) => mutation.userAttestationId === "att_expired_human")).toBe(false);
});

test("falls back to earliest verified_at when no duplicate has a nullifier link", () => {
  const plan = buildRepairPlan([
    row({
      user_attestation_id: "att_later",
      user_id: "usr_one",
      verified_at: "2026-08-03T00:00:00.000Z",
      created_at: "2026-08-03T00:00:00.000Z",
    }),
    row({
      user_attestation_id: "att_earlier",
      user_id: "usr_one",
      verified_at: "2026-08-02T00:00:00.000Z",
      created_at: "2026-08-02T00:00:00.000Z",
    }),
  ], NOW);

  expect(plan.duplicateGroups[0]?.winnerUserAttestationId).toBe("att_earlier");
  expect(plan.supersede.map((mutation) => mutation.userAttestationId)).toEqual(["att_earlier", "att_later"]);
  expect(plan.supersede.every((mutation) => mutation.reason === "provenance_unbound")).toBe(true);
});

test("fails closed when a duplicate group has conflicting values", () => {
  expect(() => buildRepairPlan([
    row({ user_attestation_id: "att_a", user_id: "usr_one", value_json_text: '{"nationality":"USA"}' }),
    row({ user_attestation_id: "att_b", user_id: "usr_one", value_json_text: '{"nationality":"CAN"}' }),
  ], NOW)).toThrow("conflicting duplicate values require review");
});

test("fails closed when provenance points at an invalid nullifier", () => {
  expect(() => buildRepairPlan([
    row({ user_attestation_id: "att_invalid", invalid_nullifier_link_count: 1 }),
  ], NOW)).toThrow("invalid nullifier link requires review");
});

test("supersedes accepted nationality evidence with an unusable nullifier link", () => {
  const plan = buildRepairPlan([
    row({
      user_attestation_id: "att_invalid_nationality",
      capability_key: "nationality",
      attestation_type: "nationality",
      source_identity_nullifier_id: "nul_inactive",
      nullifier_link_count: 1,
      invalid_nullifier_link_count: 1,
    }),
  ], NOW);

  expect(plan.supersede).toEqual([{
    userAttestationId: "att_invalid_nationality",
    reason: "provenance_invalid",
    duplicateGroupKey: null,
  }]);
});

test("is idempotent after the planned status transitions", () => {
  const plan = buildRepairPlan([
    row({
      user_attestation_id: "att_superseded",
      status: "superseded",
      value_json_text: '{"state":"superseded","reason":"provenance_unbound","ref":"review-1"}',
      value_json: { state: "superseded", reason: "provenance_unbound", ref: "review-1" },
    }),
    row({
      user_attestation_id: "att_expired",
      status: "expired",
      expires_at: "2026-08-01T00:00:00.000Z",
    }),
  ], NOW);

  expect(plan).toEqual({ duplicateGroups: [], supersede: [], expire: [] });
});

test("does not update the derived user projection", () => {
  const source = readFileSync(new URL("./provider-identity-evidence-repair.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/UPDATE\s+users/u);
});
