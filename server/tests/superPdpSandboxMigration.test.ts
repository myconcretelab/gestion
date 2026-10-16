import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("migration sandbox SQLite : conservation des connexions, secrets, verrous, enfants et contraintes", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "contrats-sandbox-migration-"),
  );
  const file = path.join(temp, "fixture.db");
  const sql = (input: string, expectSuccess = true) => {
    const result = spawnSync("sqlite3", ["-bail", "-json", file], {
      input: "PRAGMA foreign_keys=ON;\n" + input,
      encoding: "utf8",
    });
    if (expectSuccess) assert.equal(result.status, 0, result.stderr);
    else assert.notEqual(result.status, 0);
    return result.stdout.trim();
  };
  try {
    sql(`CREATE TABLE fiscal_entities (id TEXT, organization_id TEXT, UNIQUE(id, organization_id));
      INSERT INTO fiscal_entities VALUES ('entity-a', 'org-a'), ('entity-b', 'org-a'), ('entity-c', 'org-b'), ('entity-d', 'org-a');`);
    sql(
      fs.readFileSync(
        new URL(
          "../prisma/migrations/20261016170000_superpdp_oauth/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    // These are the composite references used by outgoing transport and inbox synchronization.
    sql(`CREATE UNIQUE INDEX superpdp_connections_id_entity_org_key ON superpdp_connections(id, fiscal_entity_id, organization_id);
      CREATE TABLE transport_fixture (id TEXT PRIMARY KEY, connection_id TEXT, fiscal_entity_id TEXT, organization_id TEXT,
        FOREIGN KEY(connection_id, fiscal_entity_id, organization_id) REFERENCES superpdp_connections(id, fiscal_entity_id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE);
      INSERT INTO superpdp_connections (id, organization_id, fiscal_entity_id, local_siren, encrypted_client_secret, encrypted_tokens,
        expected_number, remote_company_id, generation, operation_id, operation_expires_at, updatedAt)
        VALUES ('connection-a', 'org-a', 'entity-a', '732829320', 'fake-encrypted-secret', 'fake-encrypted-tokens',
          '000000002', '114214', 7, 'fake-lock', '2026-10-16 12:00:00', '2026-10-16 11:00:00');
      INSERT INTO superpdp_oauth_states (id, organization_id, connection_id, generation, user_id, session_hash, encrypted_verifier, expires_at)
        VALUES ('fake-state', 'org-a', 'connection-a', 7, 'fake-user', 'fake-session-hash', 'fake-encrypted-verifier', '2026-10-16 12:00:00');
      INSERT INTO transport_fixture VALUES ('transport-a', 'connection-a', 'entity-a', 'org-a');`);
    const before = sql(
      "SELECT * FROM superpdp_connections; SELECT * FROM superpdp_oauth_states; SELECT * FROM transport_fixture;",
    );
    const indexQuery =
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='superpdp_connections' AND name NOT LIKE 'sqlite_%' ORDER BY name;";
    const beforeIndexes = sql(indexQuery);
    sql(
      fs.readFileSync(
        new URL(
          "../prisma/migrations/20261016233000_superpdp_sandbox_identity/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(sql("PRAGMA foreign_key_check;"), "");
    assert.equal(sql(indexQuery), beforeIndexes);
    assert.equal(
      sql(
        "SELECT * FROM superpdp_connections; SELECT * FROM superpdp_oauth_states; SELECT * FROM transport_fixture;",
      ),
      before,
    );
    sql(
      "INSERT INTO superpdp_connections(id, organization_id, fiscal_entity_id, local_siren, updatedAt) VALUES ('connection-b', 'org-a', 'entity-b', NULL, CURRENT_TIMESTAMP);",
    );
    sql(
      "INSERT INTO superpdp_connections(id, organization_id, fiscal_entity_id, environment, local_siren, updatedAt) VALUES ('production-without-siren', 'org-b', 'entity-c', 'production', NULL, CURRENT_TIMESTAMP);",
      false,
    );
    sql(
      "INSERT INTO superpdp_connections(id, organization_id, fiscal_entity_id, local_siren, updatedAt) VALUES ('cross-tenant', 'org-b', 'entity-b', NULL, CURRENT_TIMESTAMP);",
      false,
    );
    sql(
      "INSERT INTO superpdp_connections(id, organization_id, fiscal_entity_id, local_siren, updatedAt) VALUES ('duplicate-entity', 'org-a', 'entity-b', NULL, CURRENT_TIMESTAMP);",
      false,
    );
    sql(
      "INSERT INTO superpdp_connections(id, organization_id, fiscal_entity_id, local_siren, remote_company_id, updatedAt) VALUES ('duplicate-remote', 'org-a', 'entity-d', NULL, '114214', CURRENT_TIMESTAMP);",
      false,
    );
    // This fails due to the child reference, not because the connection was lost during the rebuild.
    sql("DELETE FROM superpdp_connections WHERE id='connection-a';", false);
    assert.equal(sql("PRAGMA foreign_key_check;"), "");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
