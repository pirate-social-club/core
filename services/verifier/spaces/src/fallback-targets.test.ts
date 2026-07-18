import { describe, expect, test } from "bun:test";
import { parsePublishedFallbackTargets, PublishedFallbackRegistry } from "./fallback-targets";

const rootPubkey = "ab".repeat(32);
const raw = JSON.stringify({
  "@xn--tl8h": {
    root_pubkey: rootPubkey,
    web_url: "https://pirate.sc/c/@xn--tl8h",
    freedom_url: "https://pirate.sc/c/@xn--tl8h",
  },
});

describe("published Spaces fallbacks", () => {
  test("loads every reviewed production fallback", async () => {
    const rawTargets = await Bun.file(
      new URL("../../../../ops/vps/spaces-verifier/config/published-targets.json", import.meta.url),
    ).text();
    expect(parsePublishedFallbackTargets(rawTargets).size).toBe(44);
  });

  test("requires a matching live root key", () => {
    const registry = new PublishedFallbackRegistry(parsePublishedFallbackTargets(raw));
    expect(registry.targetFor("@xn--tl8h", rootPubkey)?.webUrl).toBe(
      "https://pirate.sc/c/@xn--tl8h",
    );
    expect(registry.targetFor("@xn--tl8h", "cd".repeat(32))).toBeNull();
  });

  test("rejects unsafe URLs and malformed keys", () => {
    expect(() => parsePublishedFallbackTargets(JSON.stringify({
      "@space": { root_pubkey: rootPubkey, web_url: "javascript:alert(1)", freedom_url: "https://pirate.sc" },
    }))).toThrow("HTTPS URL");
    expect(() => parsePublishedFallbackTargets(JSON.stringify({
      "@space": { root_pubkey: "short", web_url: "https://pirate.sc", freedom_url: "https://pirate.sc" },
    }))).toThrow("root_pubkey");
  });

  test("records native target disagreements but not missing relay data", () => {
    const registry = new PublishedFallbackRegistry(parsePublishedFallbackTargets(raw));
    registry.observeNative("@xn--tl8h", { webUrl: null, freedomUrl: null });
    expect(registry.disagreementSnapshot().count).toBe(0);

    registry.observeNative("@xn--tl8h", {
      webUrl: "https://owner.example/new",
      freedomUrl: "https://pirate.sc/c/@xn--tl8h",
    });
    expect(registry.disagreementSnapshot()).toEqual({ count: 1, handles: ["@xn--tl8h"] });

    registry.observeNative("@xn--tl8h", {
      webUrl: "https://pirate.sc/c/@xn--tl8h",
      freedomUrl: "https://pirate.sc/c/@xn--tl8h",
    });
    expect(registry.disagreementSnapshot().count).toBe(0);
  });
});
