import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

Bun.env.PDNS_SQLITE_DATABASE = createPowerDnsTestDatabase();

const { handleRequest } = await import("./server");

function createPowerDnsTestDatabase(): string {
  const path = join(mkdtempSync(join(tmpdir(), "pirate-hns-verifier-")), "pdns.sqlite3");
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec(`
      CREATE TABLE domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL
      );

      CREATE TABLE records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        ttl INTEGER,
        prio INTEGER,
        disabled INTEGER NOT NULL DEFAULT 0,
        ordername TEXT,
        auth INTEGER NOT NULL DEFAULT 1
      );
    `);
  } finally {
    db.close();
  }
  return path;
}

describe("hns verifier server", () => {
  test("exports a health handler", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:4048/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.observation_provider).toBe("powerdns_sqlite");
  });

  test("supports API-facing public inspect endpoint for punycode HNS roots", async () => {
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=xn--pokmon-dva&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root_label).toBe("xn--pokmon-dva");
    expect(body.zone_name).toBe("xn--pokmon-dva.");
    expect(body.challenge_name).toBe("_pirate.xn--pokmon-dva.");
    expect(body.zone_exists).toBe(false);
    expect(body.failure_reason).toBe("zone_not_provisioned");
  });

  test("normalizes Unicode HNS roots to the same public inspect result", async () => {
    const response = await handleRequest(new Request(
      "http://127.0.0.1:4048/inspect-public?root_label=pok%C3%A9mon&challenge_host=_pirate.xn--pokmon-dva",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.root_label).toBe("xn--pokmon-dva");
    expect(body.zone_name).toBe("xn--pokmon-dva.");
  });

  test("supports API-facing public TXT verification endpoint", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:4048/verify-txt-public", {
      method: "POST",
      body: JSON.stringify({
        root_label: "xn--pokmon-dva",
        challenge_host: "_pirate.xn--pokmon-dva",
        challenge_txt_value: "pirate-verification=nvs_test",
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verified).toBe(false);
    expect(body.failure_reason).toBe("zone_not_provisioned");
    expect(body.root_exists).toBe(false);
  });
});
