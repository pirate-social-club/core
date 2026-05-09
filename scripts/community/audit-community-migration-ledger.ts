#!/usr/bin/env bun
import { createClient } from "@libsql/client";
import { decryptCommunityDbCredential } from "../lib/shared/community-db-credential-crypto";

const controlPlaneDatabaseUrl = process.env.CONTROL_PLANE_DATABASE_URL;
const wrapKey = process.env.TURSO_COMMUNITY_DB_WRAP_KEY;

if (!controlPlaneDatabaseUrl || !wrapKey) {
  console.error("missing CONTROL_PLANE_DATABASE_URL or TURSO_COMMUNITY_DB_WRAP_KEY");
  process.exit(1);
}

const communityId = process.argv[2];
if (!communityId) {
  console.error("usage: bun run audit-community-migration-ledger.ts <community-id>");
  process.exit(1);
}

const db = new Bun.SQL(controlPlaneDatabaseUrl);

try {
  const rows = await db.unsafe<{
    community_id: string;
    display_name: string;
    database_url: string;
    encrypted_token: string;
    encryption_key_version: string;
  }[]>(`
    SELECT c.community_id, c.display_name, b.database_url, cred.encrypted_token, cred.encryption_key_version
    FROM communities AS c
    JOIN community_database_bindings AS b ON b.community_database_binding_id = c.primary_database_binding_id
    JOIN community_db_credentials AS cred ON cred.community_database_binding_id = b.community_database_binding_id AND cred.status = 'active'
    WHERE c.community_id = '${communityId}'
  `);

  if (rows.length === 0) {
    console.error("community not found");
    process.exit(1);
  }

  const r = rows[0];
  const token = decryptCommunityDbCredential({
    encryptedToken: r.encrypted_token,
    encryptionKeyVersion: Number(r.encryption_key_version),
    wrapKey,
  });

  const client = createClient({ url: r.database_url, authToken: token });
  try {
    const migrations = await client.execute("SELECT migration_name, checksum FROM schema_migrations ORDER BY migration_name");
    for (const m of migrations.rows) {
      console.log(`${m.migration_name} ${m.checksum}`);
    }
  } finally {
    client.close();
  }
} finally {
  await db.end();
}
