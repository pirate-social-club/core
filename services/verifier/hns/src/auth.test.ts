import { describe, expect, test } from "bun:test";
import {
  requireHnsVerifierAuth,
  resolveHnsVerifierAuth,
  type HnsVerifierAuth,
} from "./auth";

const configuredAuth: HnsVerifierAuth = {
  primaryToken: "primary-secret",
  observerToken: "observer-secret",
};

function request(path: string, token?: string, method = "GET") {
  return new Request(`http://verifier.test${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe("HNS verifier scoped authentication", () => {
  test("primary token retains access to every route", () => {
    for (const [method, path] of [
      ["GET", "/health"],
      ["GET", "/inspect?root_label=pirate"],
      ["GET", "/inspect-public?root_label=pirate"],
      ["GET", "/authority-health?root_label=pirate"],
      ["GET", "/observe-root-parent?root_label=pirate"],
      ["GET", "/observe-root-authority?root_label=pirate"],
      ["POST", "/publish-txt"],
      ["POST", "/ensure-zone"],
      ["POST", "/verify-txt"],
      ["GET", "/unknown"],
    ]) {
      expect(requireHnsVerifierAuth(request(path, "primary-secret", method), configuredAuth)).toBeNull();
    }
  });

  test("observer token is accepted only by the two observation GET routes", () => {
    for (const path of [
      "/observe-root-parent?root_label=pirate",
      "/observe-root-authority?root_label=pirate",
    ]) {
      expect(requireHnsVerifierAuth(request(path, "observer-secret"), configuredAuth)).toBeNull();
    }

    for (const [method, path] of [
      ["POST", "/observe-root-parent?root_label=pirate"],
      ["POST", "/observe-root-authority?root_label=pirate"],
      ["GET", "/health"],
      ["GET", "/inspect?root_label=pirate"],
      ["GET", "/inspect-public?root_label=pirate"],
      ["GET", "/authority-health?root_label=pirate"],
      ["POST", "/publish-txt"],
      ["POST", "/ensure-zone"],
      ["POST", "/verify-txt"],
      ["POST", "/verify-txt-public"],
      ["GET", "/unknown"],
    ]) {
      expect(
        requireHnsVerifierAuth(request(path, "observer-secret", method), configuredAuth)?.status,
      ).toBe(401);
    }
  });

  test("observation routes still require primary token when observer token is unset", () => {
    const primaryOnly = resolveHnsVerifierAuth("primary-secret", undefined);
    for (const path of ["/observe-root-parent", "/observe-root-authority"]) {
      expect(requireHnsVerifierAuth(request(path), primaryOnly)?.status).toBe(401);
      expect(requireHnsVerifierAuth(request(path, "primary-secret"), primaryOnly)).toBeNull();
    }
  });

  test("open development mode requires both tokens to be unset", () => {
    const openAuth = resolveHnsVerifierAuth(undefined, undefined);
    expect(requireHnsVerifierAuth(request("/ensure-zone"), openAuth)).toBeNull();
  });

  test("rejects observer token without a primary token", () => {
    expect(() => resolveHnsVerifierAuth(undefined, "observer-secret")).toThrow(
      "HNS_VERIFIER_OBSERVER_AUTH_TOKEN requires HNS_VERIFIER_AUTH_TOKEN",
    );
  });

  test("rejects identical primary and observer tokens", () => {
    expect(() => resolveHnsVerifierAuth("same-secret", "same-secret")).toThrow(
      "HNS verifier primary and observer auth tokens must be distinct",
    );
  });
});
