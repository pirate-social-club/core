import { describe, expect, test } from "bun:test";

import { buildDnsQuery, parseDnsAnswers } from "./dns-wire";

describe("DNS wire helpers", () => {
  test("builds a deterministic A question", () => {
    expect(Buffer.from(buildDnsQuery("app.community", "A", 0x1234)).toString("hex")).toBe(
      "1234010000010000000000000361707009636f6d6d756e6974790000010001",
    );
  });

  test("parses A and TLSA answer data", () => {
    const a = Buffer.from("1234818000010001000000000361707009636f6d6d756e6974790000010001c00c000100010000012c0004c000020a", "hex");
    expect(parseDnsAnswers(a, 0x1234)).toEqual({ rcode: 0, records: ["192.0.2.10"] });

    const tlsa = Buffer.from("123481800001000100000000045f343433045f7463700361707009636f6d6d756e6974790000340001c00c003400010000012c0005030101abcd", "hex");
    expect(parseDnsAnswers(tlsa, 0x1234)).toEqual({ rcode: 0, records: ["3 1 1 ABCD"] });
  });
});
