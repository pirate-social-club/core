import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { seedControlPlaneFixtures } from "./control-plane-fixtures";
import { splitSqlStatements, toSqliteCompatibleStatement } from "./shared/sql-migration";

type Cleanup = () => Promise<void>;

let cleanup: Cleanup | null = null;

async function createControlPlaneTestDatabase(): Promise<{
  databaseUrl: string;
  client: ReturnType<typeof createClient>;
  cleanup: Cleanup;
}> {
  const databasePath = join(tmpdir(), `pirate-core-control-plane-fixtures-${Date.now()}.db`);
  const client = createClient({
    url: `file:${databasePath}`,
  });
  const migrationsDir = new URL("../../db/control-plane/migrations/", import.meta.url);
  const entries = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  const baselineEntry = entries.find((entry) => entry.startsWith("0000_") && entry.includes("baseline"));
  const entriesToApply = baselineEntry ? [baselineEntry] : entries;

  for (const entry of entriesToApply) {
    const rawSql = await readFile(new URL(entry, migrationsDir), "utf8");
    for (const statement of splitSqlStatements(rawSql)) {
      const sqliteStatement = toSqliteCompatibleStatement(statement);
      if (!sqliteStatement) {
        continue;
      }
      await client.execute(sqliteStatement);
    }
  }

  return {
    databaseUrl: `file:${databasePath}`,
    client,
    cleanup: async () => {
      client.close();
      await rm(databasePath, { force: true });
    },
  };
}

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = null;
  }
});

describe("seedControlPlaneFixtures", () => {
  test("creates and idempotently upserts the expected identity, namespace, and reputation rows", async () => {
    const db = await createControlPlaneTestDatabase();
    cleanup = db.cleanup;

    const first = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_fixture_01",
      subject: "fixture-subject-01",
      handle: "fixture",
      namespaceLabel: "infinity",
      redditUsername: "infinitypilot",
      issuer: "pirate-dev-upstream",
    });

    const second = await seedControlPlaneFixtures({
      databaseUrl: db.databaseUrl,
      userId: "usr_fixture_01",
      subject: "fixture-subject-01",
      handle: "fixture",
      namespaceLabel: "infinity",
      redditUsername: "infinitypilot",
      issuer: "pirate-dev-upstream",
    });

    expect(second.namespaceVerificationId).toBe(first.namespaceVerificationId);
    expect(second.providerSubject).toBe(first.providerSubject);

    const userRows = await db.client.execute({
      sql: `
        SELECT verification_state, capability_provider
        FROM users
        WHERE user_id = ?1
      `,
      args: ["usr_fixture_01"],
    });
    expect(userRows.rows).toHaveLength(1);
    expect(userRows.rows[0]?.verification_state).toBe("verified");
    expect(userRows.rows[0]?.capability_provider).toBe("self");

    const namespaceRows = await db.client.execute({
      sql: `
        SELECT family, normalized_root_label, status, club_attach_allowed
        FROM namespace_verifications
        WHERE namespace_verification_id = ?1
      `,
      args: [first.namespaceVerificationId],
    });
    expect(namespaceRows.rows).toHaveLength(1);
    expect(namespaceRows.rows[0]?.family).toBe("hns");
    expect(namespaceRows.rows[0]?.normalized_root_label).toBe("infinity");
    expect(namespaceRows.rows[0]?.status).toBe("verified");
    expect(Number(namespaceRows.rows[0]?.club_attach_allowed ?? 0)).toBe(1);

    const assertionCount = await db.client.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM namespace_verification_assertions
        WHERE namespace_verification_id = ?1
      `,
      args: [first.namespaceVerificationId],
    });
    expect(Number(assertionCount.rows[0]?.count ?? 0)).toBe(5);

    const handleRows = await db.client.execute({
      sql: `
        SELECT label_normalized, label_display, status
        FROM global_handles
        WHERE user_id = ?1
      `,
      args: ["usr_fixture_01"],
    });
    expect(handleRows.rows).toHaveLength(1);
    expect(handleRows.rows[0]?.label_normalized).toBe("fixture");
    expect(handleRows.rows[0]?.label_display).toBe("fixture.pirate");
    expect(handleRows.rows[0]?.status).toBe("active");

    const authRows = await db.client.execute({
      sql: `
        SELECT provider, provider_subject, status
        FROM auth_provider_links
        WHERE user_id = ?1
      `,
      args: ["usr_fixture_01"],
    });
    expect(authRows.rows).toHaveLength(1);
    expect(authRows.rows[0]?.provider).toBe("jwt");
    expect(authRows.rows[0]?.provider_subject).toBe("pirate-dev-upstream|fixture-subject-01");
    expect(authRows.rows[0]?.status).toBe("active");

    const redditJobRows = await db.client.execute({
      sql: `
        SELECT status, job_type
        FROM jobs
        WHERE subject_id = ?1
          AND job_type = 'reddit_snapshot_import'
      `,
      args: ["usr_fixture_01"],
    });
    expect(redditJobRows.rows).toHaveLength(1);
    expect(redditJobRows.rows[0]?.status).toBe("succeeded");
  });
});
