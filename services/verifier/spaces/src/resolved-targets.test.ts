import { describe, expect, test } from "bun:test";
import { selectNavigationTargets } from "./resolved-targets";

describe("Spaces navigation target precedence", () => {
  const fallback = {
    webUrl: "https://pirate.sc/c/@alice",
    freedomUrl: "https://pirate.sc/c/@alice",
  };

  test("uses fallback only when Fabric state is unavailable", () => {
    expect(selectNavigationTargets({
      fabricAvailable: false,
      native: { webUrl: null, freedomUrl: null },
      fallback,
    })).toEqual(fallback);
  });

  test("preserves a verified-empty native zone as deliberate owner intent", () => {
    expect(selectNavigationTargets({
      fabricAvailable: true,
      native: { webUrl: null, freedomUrl: null },
      fallback,
    })).toEqual({ webUrl: null, freedomUrl: null });
  });

  test("does not fill a missing native field from fallback", () => {
    expect(selectNavigationTargets({
      fabricAvailable: true,
      native: { webUrl: "https://owner.example", freedomUrl: null },
      fallback,
    })).toEqual({ webUrl: "https://owner.example", freedomUrl: null });
  });
});
