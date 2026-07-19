import { describe, expect, test } from "bun:test";

import {
  validatePublishReceipt,
  validateRebroadcastReceipt,
} from "./batch-create-prod-spaces-communities";

describe("signed Fabric publication receipts", () => {
  const digest = "a".repeat(64);

  test("accepts a publish receipt bound to the retained bytes", () => {
    expect(validatePublishReceipt({
      published: true,
      signed_message_saved: true,
      message_sha256: digest,
      sequence: 9,
    }, digest)).toBe(9);
  });

  test("rejects missing retention, digest mismatch, or unsafe sequence", () => {
    expect(() => validatePublishReceipt({
      published: true,
      signed_message_saved: false,
      message_sha256: digest,
      sequence: 9,
    }, digest)).toThrow();
    expect(() => validatePublishReceipt({
      published: true,
      signed_message_saved: true,
      message_sha256: "b".repeat(64),
      sequence: 9,
    }, digest)).toThrow();
    expect(() => validatePublishReceipt({
      published: true,
      signed_message_saved: true,
      message_sha256: digest,
      sequence: Number.MAX_SAFE_INTEGER + 1,
    }, digest)).toThrow();
  });

  test("accepts only a rebroadcast receipt for the same retained bytes", () => {
    expect(() => validateRebroadcastReceipt({
      rebroadcasted: true,
      message_sha256: digest,
    }, digest)).not.toThrow();
    expect(() => validateRebroadcastReceipt({
      rebroadcasted: true,
      message_sha256: "b".repeat(64),
    }, digest)).toThrow();
  });
});
