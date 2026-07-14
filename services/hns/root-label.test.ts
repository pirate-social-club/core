import { describe, expect, test } from "bun:test";
import {
  isCanonicalHnsRootLabel,
  isCanonicalPirateHnsRootLabel,
} from "./root-label";

describe("isCanonicalHnsRootLabel", () => {
  test("matches the hsd covenant root-label grammar", () => {
    for (const value of ["pirate", "a", "xn--pokmon-dva", "tame_impala", "a-b_c9"]) {
      expect(isCanonicalHnsRootLabel(value)).toBe(true);
    }

    for (const value of [
      "",
      "TAME_IMPALA",
      "-pirate",
      "pirate-",
      "_pirate",
      "pirate_",
      "a.b",
      "a".repeat(64),
      "example",
      "invalid",
      "local",
      "localhost",
      "test",
    ]) {
      expect(isCanonicalHnsRootLabel(value)).toBe(false);
    }
  });

  test("keeps consensus grammar separate from Pirate's canonical IDNA policy", () => {
    expect(isCanonicalHnsRootLabel("xn--0")).toBe(true);
    expect(isCanonicalPirateHnsRootLabel("xn--pokmon-dva")).toBe(true);
    expect(isCanonicalPirateHnsRootLabel("xn--0")).toBe(false);
  });
});
