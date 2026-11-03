import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createTouristTaxStayForSource,
  DEFAULT_TOURIST_TAX_COLLECTION,
  reservationAmountToCollect,
} from "@contrats/shared";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tourist-tax-collection-"));
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/modules/organizations/context.js");
let settings: typeof import("../src/services/touristTaxCollection.js");
let reapply: typeof import("../src/modules/touristTax/collectionReapply.js");
const policy = {
  version: 1 as const,
  classified: true,
  stars: 1,
  included: true,
  fixed_rate: 0.8,
  percentage: 4,
  cap: 4,
  additional_percentage: 0,
  accommodation_vat_rate: 0,
  authority: "Ploërmel",
  effective_from: "2026-01-01",
};
before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `file:${temp}/test.db`,
    DATABASE_URL_SQLITE: `file:${temp}/test.db`,
    DATA_DIR: temp,
  });
  fs.writeFileSync(`${temp}/test.db`, "");
  const root = process.cwd().endsWith("/server")
    ? process.cwd()
    : path.join(process.cwd(), "server");
  const migrated = spawnSync(
    process.execPath,
    ["scripts/prisma.mjs", "migrate", "deploy"],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  db = await import("../src/db/prisma.js");
  context = await import("../src/modules/organizations/context.js");
  settings = await import("../src/services/touristTaxCollection.js");
  reapply = await import("../src/modules/touristTax/collectionReapply.js");
});
after(async () => {
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});
async function fixture(work: (giteId: string, org: string) => Promise<void>) {
  const org = randomUUID();
  await db.systemPrisma.organization.create({
    data: { id: org, slug: org, name: "Test" },
  });
  await context.runWithOrganization(
    { organizationId: org, source: "test" },
    async () => {
      const gite = await db.default.gite.create({
        data: {
          nom: "Gîte test",
          prefixe_contrat: org,
          adresse_ligne1: "Test",
          capacite_max: 6,
          proprietaires_noms: "Test",
          proprietaires_adresse: "Test",
          telephones: "",
          taxe_sejour_par_personne_par_nuit: 0.8,
          taxe_sejour_config: JSON.stringify(policy),
          iban: "",
          titulaire: "Test",
        },
      });
      await work(gite.id, org);
    },
  );
}
const stay = (giteId: string, data: Record<string, unknown> = {}) =>
  db.default.reservation.create({
    data: {
      gite_id: giteId,
      hote_nom: "TEST Voyageur",
      date_entree: new Date("2026-09-10"),
      date_sortie: new Date("2026-09-12"),
      nb_nuits: 2,
      nb_adultes: 2,
      prix_par_nuit: 50,
      prix_total: 100,
      booking_source: "Direct",
      ...data,
    },
  });
const scope = { from: "2026-09-01", to: "2026-09-30", override_manual: false };
test("les références de factures regroupées sont reconnues dans les formats SQLite et PostgreSQL", async () => {
  const { invoiceReferencesReservations } =
    await import("../src/modules/touristTax/collectionReapply.js");
  for (const items of [
    [{ reservation_id: "r1" }],
    JSON.stringify([{ reservation_id: "r1" }]),
  ]) {
    assert.equal(invoiceReferencesReservations(items, ["r1"]), true);
    assert.equal(invoiceReferencesReservations(items, ["other"]), false);
  }
  assert.equal(invoiceReferencesReservations(null, ["r1"]), false);
});
test("les écritures de reprise exigent aussi le droit de modifier les réservations", async () => {
  const { getRequiredBusinessPermission, getAdditionalBusinessPermissions } =
    await import("../src/services/accessControl.js");
  assert.equal(
    getRequiredBusinessPermission(
      "GET",
      "/settings/tourist-tax-collection/defaults",
    ),
    null,
  );
  assert.equal(
    getRequiredBusinessPermission("PUT", "/settings/tourist-tax-collection"),
    "settings:write",
  );
  assert.deepEqual(
    getAdditionalBusinessPermissions(
      "POST",
      "/settings/tourist-tax-collection/apply",
      {},
    ),
    ["reservations:write"],
  );
});
test("la création par l’API préremplit la collecte et accepte les origines personnalisées", () =>
  fixture(async (gite, org) => {
    const express = (await import("express")).default;
    const router = (await import("../src/routes/reservations.js")).default;
    const app = express();
    app.use(express.json());
    app.use((_req, _res, next) =>
      context.runWithOrganization(
        { organizationId: org, source: "test" },
        next,
      ),
    );
    app.use("/reservations", router);
    app.use(
      (
        error: Error,
        _req: unknown,
        res: { status: (code: number) => { json: (value: unknown) => void } },
        _next: unknown,
      ) => res.status(500).json({ error: error.message }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const address = server.address() as { port: number };
      const response = await fetch(
        `http://127.0.0.1:${address.port}/reservations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gite_id: gite,
            hote_nom: "TEST API",
            date_entree: "2026-09-10",
            date_sortie: "2026-09-12",
            nb_adultes: 2,
            prix_par_nuit: 50,
            booking_source: "Direct",
            options: {},
          }),
        },
      );
      const body = (await response.json()) as {
        options: { tourist_tax: { collector: string } };
        error?: string;
        id: string;
      };
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(body.options.tourist_tax.collector, "host");
      const changed = await fetch(
        `http://127.0.0.1:${address.port}/reservations/${body.id}/booking-source`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ booking_source: "Nouvelle plateforme" }),
        },
      );
      assert.equal(changed.status, 200);
      const saved = await db.default.reservation.findUniqueOrThrow({
        where: { id: body.id },
      });
      assert.equal(JSON.parse(saved.options).tourist_tax.collector, "unknown");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }));
test("l’import Pump préremplit une nouvelle réservation avec la règle de la plateforme", () =>
  fixture(async (gite) => {
    const { importPreviewReservations } =
      await import("../src/services/reservationImports.js");
    const item = {
      id: randomUUID(),
      listing_id: "test-listing",
      gite_id: gite,
      gite_nom: "Test",
      source_type: "Airbnb",
      status: "new" as const,
      check_in: "2026-09-10",
      check_out: "2026-09-12",
      nights: 2,
      hote_nom: "TEST Import",
      prix_total: 100,
      commentaire: null,
      confirmation_code: null,
      existing_id: null,
      conflict_id: null,
      update_fields: [],
    };
    const result = await importPreviewReservations(
      {
        reservations: [item],
        counts: {
          new: 1,
          existing: 0,
          existing_updatable: 0,
          conflict: 0,
          unmapped_listing: 0,
        },
      },
      undefined,
      "pump-manual",
    );
    assert.equal(result.created_count, 1);
    const saved = await db.default.reservation.findFirstOrThrow({
      where: { hote_nom: "TEST Import" },
    });
    const tax = JSON.parse(saved.options).tourist_tax;
    assert.equal(tax.collector, "platform");
    assert.equal(tax.platform, "Airbnb");
    assert.equal(tax.settings.included, false);
  }));
test("les règles sont propres au compte et les barèmes de chaque gîte restent distincts", () =>
  fixture(async (gite, org) => {
    await settings.saveTouristTaxCollectionSettings({
      rules: [{ source: "Direct", collector: "host", price: "excluded" }],
    });
    const tax = await settings.newReservationTouristTax(gite, "Direct");
    assert.equal(tax?.settings.included, false);
    assert.equal(
      JSON.parse(
        (await db.default.gite.findUniqueOrThrow({ where: { id: gite } }))
          .taxe_sejour_config!,
      ).included,
      true,
    );
    const other = await context.runWithOrganization(
      { organizationId: `${org}-other`, source: "test" },
      () => settings.readTouristTaxCollectionSettings(),
    );
    assert.deepEqual(other, DEFAULT_TOURIST_TAX_COLLECTION);
    const response = await settings.touristTaxCollectionResponse();
    assert.ok(response.sources.includes("Airbnb"));
  }));
test("prévisualiser ne modifie rien, appliquer reprend septembre et invalide le cache des rapports", () =>
  fixture(async (gite) => {
    const r = await stay(gite);
    const revisionBefore =
      (await db.default.financeReportCache.findFirst())?.source_revision ?? 0;
    const preview = await reapply.previewTouristTaxReapply(scope);
    assert.equal(preview.eligible, 1);
    assert.equal(preview.rows[0].before.tax, null);
    assert.equal(preview.rows[0].after.tax, 3.2);
    assert.equal(preview.rows[0].after.accommodation, 96.8);
    assert.equal(preview.rows[0].after.total, 100);
    assert.equal(
      (await db.default.reservation.findUniqueOrThrow({ where: { id: r.id } }))
        .options,
      "{}",
    );
    assert.equal(
      (
        await reapply.applyTouristTaxReapply({
          ...scope,
          fingerprint: preview.fingerprint,
        })
      ).updated,
      1,
    );
    const saved = await db.default.reservation.findUniqueOrThrow({
      where: { id: r.id },
    });
    assert.equal(JSON.parse(saved.options).tourist_tax.collector, "host");
    assert.ok(
      (await db.default.financeReportCache.findFirst())!.source_revision >
        revisionBefore,
    );
    assert.equal(
      await db.default.auditLog.count({
        where: { action: "tourist_tax.reapply" },
      }),
      1,
    );
    await assert.rejects(
      reapply.applyTouristTaxReapply({
        ...scope,
        fingerprint: preview.fingerprint,
      }),
      /changé/,
    );
  }));
test("un barème postérieur à l’arrivée ou une origine sans règle reste exclu avec une explication", () =>
  fixture(async (gite) => {
    await db.default.gite.update({
      where: { id: gite },
      data: {
        taxe_sejour_config: JSON.stringify({
          ...policy,
          effective_from: "2026-10-01",
        }),
      },
    });
    await stay(gite);
    const preview = await reapply.previewTouristTaxReapply(scope);
    assert.equal(preview.eligible, 0);
    assert.match(preview.rows[0].reason!, /date d’application/);
    await db.default.gite.update({
      where: { id: gite },
      data: { taxe_sejour_config: JSON.stringify(policy) },
    });
    await db.default.reservation.updateMany({
      data: { booking_source: "Plateforme inconnue" },
    });
    const unknown = await reapply.previewTouristTaxReapply(scope);
    assert.equal(unknown.eligible, 0);
    assert.match(unknown.rows[0].reason!, /collecte/);
  }));
test("les modifications concurrentes des règles ou du séjour périment l’aperçu", () =>
  fixture(async (gite) => {
    const r = await stay(gite);
    const preview = await reapply.previewTouristTaxReapply(scope);
    await db.default.reservation.update({
      where: { id: r.id },
      data: { nb_adultes: 3 },
    });
    await assert.rejects(
      reapply.applyTouristTaxReapply({
        ...scope,
        fingerprint: preview.fingerprint,
      }),
      /changé/,
    );
    const second = await reapply.previewTouristTaxReapply(scope);
    await settings.saveTouristTaxCollectionSettings({
      rules: [{ source: "Direct", collector: "host", price: "excluded" }],
    });
    await assert.rejects(
      reapply.applyTouristTaxReapply({
        ...scope,
        fingerprint: second.fingerprint,
      }),
      /changé/,
    );
  }));
test("les segments sont repris comme un seul séjour et leurs autres options sont conservées", () =>
  fixture(async (gite) => {
    const group = randomUUID();
    const a = await stay(gite, {
      stay_group_id: group,
      nb_nuits: 1,
      date_sortie: new Date("2026-09-11"),
      prix_total: 50,
      options: JSON.stringify({
        menage: { enabled: true, offert: false, inclus: false },
      }),
    });
    const b = await stay(gite, {
      stay_group_id: group,
      nb_nuits: 1,
      date_entree: new Date("2026-09-11"),
      prix_total: 50,
    });
    const preview = await reapply.previewTouristTaxReapply(scope);
    assert.equal(preview.rows.length, 1);
    assert.equal(preview.rows[0].after.tax, 3.2);
    await reapply.applyTouristTaxReapply({
      ...scope,
      fingerprint: preview.fingerprint,
    });
    assert.ok(
      JSON.parse(
        (
          await db.default.reservation.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).options,
      ).menage.enabled,
    );
    assert.equal(
      JSON.parse(
        (
          await db.default.reservation.findUniqueOrThrow({
            where: { id: b.id },
          })
        ).options,
      ).tourist_tax.collector,
      "host",
    );
  }));
test("les exceptions manuelles sont conservées sauf remplacement explicitement demandé", () =>
  fixture(async (gite) => {
    const tax = {
      ...createTouristTaxStayForSource(
        policy,
        "Direct",
        DEFAULT_TOURIST_TAX_COLLECTION,
      ),
      collector: "platform" as const,
      platform: "Collecteur exceptionnel",
      collector_mode: "manual" as const,
      settings: { ...policy, included: false },
      price_mode: "manual" as const,
    };
    await stay(gite, { options: JSON.stringify({ tourist_tax: tax }) });
    const preserved = await reapply.previewTouristTaxReapply(scope);
    assert.equal(preserved.rows[0].after.collector, "platform");
    assert.equal(preserved.rows[0].after.total, 100);
    const replaced = await reapply.previewTouristTaxReapply({
      ...scope,
      override_manual: true,
    });
    assert.equal(replaced.rows[0].after.collector, "host");
    assert.equal(replaced.rows[0].after.tax, 3.2);
  }));
test("un lien actif et une facture regroupée protègent les réservations de la reprise", () =>
  fixture(async (gite) => {
    const r = await stay(gite);
    await db.default.reservationPaymentLink.create({
      data: {
        reservation_id: r.id,
        stripe_mode: "test",
        code: randomUUID(),
        purpose: "full",
        amount_cents: 10000,
        total_cents: 10000,
        deposit_cents: 0,
        offline_received_cents: 0,
        terms_json: "{}",
        status: "active",
        expires_at: new Date("2040-01-01"),
      },
    });
    assert.match(
      (await reapply.previewTouristTaxReapply(scope)).rows[0].reason!,
      /Lien actif/,
    );
    await db.default.reservationPaymentLink.updateMany({
      data: { status: "cancelled" },
    });
    await db.default.facture.create({
      data: {
        numero_facture: "TEST-TAX",
        gite_id: gite,
        locataire_nom: "TEST",
        locataire_adresse: "Test",
        locataire_tel: "",
        nb_adultes: 2,
        nb_enfants_2_17: 0,
        date_debut: r.date_entree,
        date_fin: r.date_sortie,
        heure_arrivee: "17:00",
        heure_depart: "12:00",
        nb_nuits: 2,
        prix_par_nuit: 50,
        options: "{}",
        arrhes_montant: 0,
        arrhes_date_limite: r.date_entree,
        solde_montant: 100,
        caution_montant: 0,
        cheque_menage_montant: 0,
        clauses: "{}",
        pdf_path: "fixture.pdf",
        reservation_items: JSON.stringify([{ reservation_id: r.id }]),
      },
    });
    assert.match(
      (await reapply.previewTouristTaxReapply(scope)).rows[0].reason!,
      /facture/,
    );
    assert.equal(
      (await db.default.reservation.findUniqueOrThrow({ where: { id: r.id } }))
        .options,
      "{}",
    );
  }));
test("changer l’origine actualise la collecte automatique mais ne remplace pas les choix manuels", () =>
  fixture(async (gite) => {
    const tax = await settings.newReservationTouristTax(gite, "Direct");
    const r = await stay(gite, {
      options: JSON.stringify({ tourist_tax: tax }),
    });
    const { setReservationBookingSource } =
      await import("../src/modules/reservationPayments/ledger.js");
    await setReservationBookingSource(r.id, "Airbnb");
    const updated = await db.default.reservation.findUniqueOrThrow({
      where: { id: r.id },
    });
    assert.equal(JSON.parse(updated.options).tourist_tax.collector, "platform");
    assert.equal(reservationAmountToCollect(updated), 100);
  }));
