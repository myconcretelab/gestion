import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("la reprise des origines préserve les plateformes, choix explicites et règlements de chaque organisation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "reservation-origins-"));
  const file = path.join(temp, "fixture.db");
  const sql = (input: string) => {
    const result = spawnSync("sqlite3", ["-bail", "-json", file], {
      input,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const migration = fs.readFileSync(
    new URL(
      "../prisma/migrations/20261026190000_backfill_reservation_booking_source/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    migration,
    fs.readFileSync(
      new URL(
        "../prisma/postgres/migrations/20261026190000_backfill_reservation_booking_source/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  try {
    sql(`CREATE TABLE reservations (
      id TEXT PRIMARY KEY, organization_id TEXT, date_sortie TEXT, source_paiement TEXT,
      booking_source TEXT, payments_managed BOOLEAN, prix_total DECIMAL);
      INSERT INTO reservations VALUES
        ('cheque', 'org-a', '2025-01-01', 'Chèque', NULL, false, 500),
        ('cash', 'org-b', '2025-01-01', 'Espèces', NULL, false, 600),
        ('transfer', 'org-a', '2026-12-01', 'Virement', '', true, 700),
        ('direct', 'org-a', '2025-01-01', 'Direct', NULL, false, 500),
        ('unknown', 'org-a', '2025-01-01', NULL, ' ', false, 500),
        ('airbnb', 'org-a', '2025-01-01', 'Airbnb', NULL, false, 800),
        ('abritel', 'org-b', '2025-01-01', 'Abritel', NULL, false, 800),
        ('gdf', 'org-a', '2025-01-01', 'Gites de France', NULL, false, 800),
        ('exchange', 'org-a', '2025-01-01', 'HomeExchange', NULL, false, 0),
        ('explicit', 'org-a', '2025-01-01', 'Virement', 'Airbnb', true, 900),
        ('other', 'org-a', '2025-01-01', 'Chèque', 'Autre', false, 900),
        ('pending', 'org-b', '2025-01-01', 'Chèque', 'À préciser', false, 900);
      CREATE TABLE reservation_recorded_payments (id TEXT, reservation_id TEXT, amount_cents INTEGER, method TEXT);
      INSERT INTO reservation_recorded_payments VALUES ('payment', 'transfer', 20000, 'Virement');`);
    const untouched =
      "SELECT id, organization_id, date_sortie, source_paiement, payments_managed, prix_total FROM reservations ORDER BY id; SELECT * FROM reservation_recorded_payments;";
    const before = sql(untouched);
    sql(migration);
    assert.equal(sql(untouched), before);
    const origins = JSON.parse(
      sql("SELECT id, booking_source FROM reservations ORDER BY id;"),
    );
    assert.deepEqual(
      Object.fromEntries(
        origins.map((row: { id: string; booking_source: string }) => [
          row.id,
          row.booking_source,
        ]),
      ),
      {
        abritel: "Abritel",
        airbnb: "Airbnb",
        cash: "Direct",
        cheque: "Direct",
        direct: "Direct",
        exchange: "HomeExchange",
        explicit: "Airbnb",
        gdf: "Gites de France",
        other: "Autre",
        pending: "À préciser",
        transfer: "Direct",
        unknown: "Direct",
      },
    );
    sql(migration);
    assert.deepEqual(
      JSON.parse(
        sql("SELECT id, booking_source FROM reservations ORDER BY id;"),
      ),
      origins,
    );
    assert.equal(sql(untouched), before);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
