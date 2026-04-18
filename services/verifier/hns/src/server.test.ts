import { describe, expect, test } from "bun:test";
import { handleRequest } from "./server";

describe("hns verifier server", () => {
  test("exports a health handler", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:4048/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.observation_provider).toBe("powerdns_sqlite");
  });
});
