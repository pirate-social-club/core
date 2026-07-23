import { describe, expect, test } from "bun:test";
import { parentAuthorityTargets } from "./authority-targets";

describe("parentAuthorityTargets", () => {
  test("requires parent glue for in-bailiwick authorities", () => {
    expect(parentAuthorityTargets("dankmeme", {
      nameservers: ["ns1.dankmeme."],
      glue4: [],
      glue6: [],
    })).toEqual([{
      nameserver: "ns1.dankmeme.",
      addresses: [],
      address_resolution_root: null,
      missing_address_failure_code: "missing_parent_glue",
    }]);
  });

  test("chain-resolves out-of-bailiwick authorities instead of requiring glue", () => {
    expect(parentAuthorityTargets("dankmeme", {
      nameservers: ["ns1.pirate.", "NS2.PIRATE"],
      glue4: [],
      glue6: [],
    })).toEqual([
      {
        nameserver: "ns1.pirate.",
        addresses: [],
        address_resolution_root: "pirate",
        missing_address_failure_code: "nameserver_address_resolution_failed",
      },
      {
        nameserver: "ns2.pirate.",
        addresses: [],
        address_resolution_root: "pirate",
        missing_address_failure_code: "nameserver_address_resolution_failed",
      },
    ]);
  });
});
