import { describe, expect, test } from "bun:test";
import { isRootHandleInput } from "./labels";

describe("isRootHandleInput", () => {
  test("accepts prefixed, unprefixed, and unicode root labels", () => {
    expect(isRootHandleInput("@pirate")).toBe(true);
    expect(isRootHandleInput("pirate")).toBe(true);
    expect(isRootHandleInput("@🌀")).toBe(true);
  });

  test("rejects subnames, dotted names, and empty labels", () => {
    expect(isRootHandleInput("genesis@xn--gg8h")).toBe(false);
    expect(isRootHandleInput("@genesis@xn--gg8h")).toBe(false);
    expect(isRootHandleInput("pirate.example")).toBe(false);
    expect(isRootHandleInput("@")).toBe(false);
  });
});
