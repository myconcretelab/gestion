import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ota-pricing-"));
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/modules/organizations/context.js");
let pricing: typeof import("../src/modules/reservationPayments/pricing.js");
let settings: typeof import("../src/services/reservationPaymentSettings.js");
let ledger: typeof import("../src/modules/reservationPayments/ledger.js");
let facts: typeof import("../src/modules/finance/reports/facts.js");
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
  pricing = await import("../src/modules/reservationPayments/pricing.js");
  settings = await import("../src/services/reservationPaymentSettings.js");
  ledger = await import("../src/modules/reservationPayments/ledger.js");
  facts = await import("../src/modules/finance/reports/facts.js");
});
after(async () => {
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});
const empty = {
  menage: 0,
  draps: 0,
  linge_toilette: 0,
  depart_tardif: 0,
  chiens: 0,
};
const channel = {
  name: "Gites de France",
  automatic: true,
  storedPriceBasis: "gross",
  rateDateBasis: "arrival",
  commissionRounding: "euro",
  commissionScope: "accommodation",
  rates: [{ effectiveFrom: "2026-01-01", percent: 10 }],
};
async function fixture(work: (gite: string, org: string) => Promise<void>) {
  const org = `ota_${randomUUID()}`;
  await db.systemPrisma.organization.create({
    data: { id: org, slug: org, name: "Test commissions" },
  });
  await context.runWithOrganization(
    { organizationId: org, source: "test" },
    async () => {
      const gite = await db.default.gite.create({
        data: {
          nom: "Gîte",
          prefixe_contrat: org,
          adresse_ligne1: "Test",
          capacite_max: 10,
          proprietaires_noms: "Test",
          proprietaires_adresse: "Test",
          telephones: "",
          taxe_sejour_par_personne_par_nuit: 0,
          iban: "",
          titulaire: "Test",
          options_menage_forfait: 120,
          options_draps_par_lit: 15,
        },
      });
      await settings.saveReservationPaymentSettings({
        platform_payments_received_automatically: true,
        platforms: [channel],
      });
      await work(gite.id, org);
    },
  );
}
const stay = (gite: string, data: Record<string, unknown> = {}) =>
  db.default.reservation.create({
    data: {
      gite_id: gite,
      hote_nom: "Voyageur",
      date_entree: new Date("2026-07-27"),
      date_sortie: new Date("2026-08-01"),
      nb_nuits: 5,
      nb_adultes: 9,
      prix_par_nuit: 350,
      prix_total: 1750,
      booking_source: "Gites de France",
      ...data,
    },
  });
test("saisie réelle : trois relevés, trois bases, aucune option facturée deux fois, rapports brut/net ventilés", () =>
  fixture(async (gite) => {
    for (const [rental, cleaning, linen, fee, net] of [
      [175000, 12000, 13500, 17500, 183000],
      [52200, 0, 0, 5200, 47000],
      [60900, 0, 3000, 6100, 57800],
    ]) {
      for (const basis of ["rental", "gross", "net"] as const) {
        const reservation = await stay(gite, {
          prix_total: rental / 100,
          frais_optionnels_montant: (cleaning + linen) / 100,
          options: JSON.stringify({
            menage: { enabled: cleaning > 0 },
            draps: { enabled: linen > 0, nb_lits: linen / 1500 },
          }),
        });
        const before = await pricing.getOtaPricing(reservation.id);
        const saved = await pricing.saveOtaPricing(reservation.id, {
          revision: before.revision,
          basis,
          amountCents:
            basis === "rental"
              ? rental
              : basis === "gross"
                ? rental + cleaning + linen
                : net,
          included: { ...empty, menage: cleaning, draps: linen },
        });
        assert.equal(saved.saved?.netCents, net);
        const row = await db.default.reservation.findFirstOrThrow({
          where: { id: reservation.id },
        });
        assert.equal(Number(row.prix_total), (rental + cleaning + linen) / 100);
        assert.equal(Number(row.frais_optionnels_montant), 0);
        const tracking = await ledger.getReservationPaymentTracking(
          reservation.id,
        );
        assert.equal(tracking.remaining, 0);
        assert.equal(tracking.total, (rental + cleaning + linen) / 100);
        assert.deepEqual(
          [
            tracking.entries[0].ota?.grossCents,
            tracking.entries[0].ota?.feeCents,
            tracking.entries[0].ota?.netCents,
          ],
          [rental + cleaning + linen, fee, net],
        );
        const state = await facts.loadReportFacts();
        const operations = state.operations.filter(
          (op) => op.reservationId === row.id && op.basis === "payment",
        );
        assert.equal(
          operations.reduce((sum, op) => sum + op.ota!.grossCents, 0),
          rental + cleaning + linen,
        );
        assert.equal(
          operations.reduce((sum, op) => sum + op.ota!.netCents, 0),
          net,
        );
        assert.equal(
          operations.find((op) => op.category === "accommodation")?.ota
            ?.feeCents,
          fee,
        );
        assert.ok(
          operations
            .filter((op) => op.category !== "accommodation")
            .every((op) => op.ota?.feeCents === 0),
        );
      }
    }
  }));
test("révisions périmées, montants invalides et net ambigu sont refusés sans écriture", () =>
  fixture(async (gite) => {
    const row = await stay(gite);
    const initial = await pricing.getOtaPricing(row.id);
    const payload = {
      revision: initial.revision,
      basis: "net",
      amountCents: 450,
      included: empty,
    };
    await assert.rejects(
      pricing.saveOtaPricing(row.id, payload),
      /Plusieurs prix/,
    );
    await assert.rejects(
      pricing.saveOtaPricing(row.id, { ...payload, amountCents: -1 }),
    );
    assert.equal(
      Number(
        (
          await db.default.reservation.findFirstOrThrow({
            where: { id: row.id },
          })
        ).prix_total,
      ),
      1750,
    );
    await db.default.reservation.update({
      where: { id: row.id },
      data: { commentaire: "Changement" },
    });
    await assert.rejects(
      pricing.saveOtaPricing(row.id, {
        ...payload,
        basis: "rental",
        amountCents: 175000,
      }),
      /changé/,
    );
  }));
test("règles et valeurs des options sont figées ; une modification de prix devient à vérifier", () =>
  fixture(async (gite) => {
    const row = await stay(gite, {
      frais_optionnels_montant: 135,
      options: JSON.stringify({ draps: { enabled: true, nb_lits: 9 } }),
    });
    const initial = await pricing.getOtaPricing(row.id);
    await pricing.saveOtaPricing(row.id, {
      revision: initial.revision,
      basis: "net",
      amountCents: 171000,
      included: { ...empty, draps: 13500 },
    });
    await settings.saveReservationPaymentSettings({
      platform_payments_received_automatically: true,
      platforms: [
        { ...channel, rates: [{ effectiveFrom: "2026-01-01", percent: 30 }] },
      ],
    });
    await db.default.gite.update({
      where: { id: gite },
      data: { options_draps_par_lit: 50 },
    });
    const tracking = await ledger.getReservationPaymentTracking(row.id);
    assert.equal(tracking.entries[0].ota?.netCents, 171000);
    await db.default.reservation.update({
      where: { id: row.id },
      data: { prix_total: 2000 },
    });
    assert.equal(
      (await ledger.getReservationPaymentTracking(row.id)).requires_review,
      true,
    );
    assert.equal(
      (await ledger.getReservationPaymentTracking(row.id)).entries[0].ota,
      undefined,
    );
  }));
test("les paiements existants ne sont pas réécrits et les organisations restent isolées", () =>
  fixture(async (gite, org) => {
    const row = await stay(gite, { payments_managed: true });
    await db.default.reservationRecordedPayment.create({
      data: {
        id: randomUUID(),
        reservation_id: row.id,
        amount_cents: 175000,
        method: "Versement plateforme",
        purpose: "full",
        paid_on: new Date("2026-07-30"),
      },
    });
    const initial = await pricing.getOtaPricing(row.id);
    assert.ok(initial.blockedReason);
    await assert.rejects(
      pricing.saveOtaPricing(row.id, {
        revision: initial.revision,
        basis: "gross",
        amountCents: 175000,
        included: empty,
      }),
      /déjà un règlement/,
    );
    await context.runWithOrganization(
      { organizationId: org + "_other", source: "test" },
      async () => {
        await assert.rejects(pricing.getOtaPricing(row.id), /introuvable/);
      },
    );
  }));

test("une option locale de même catégorie reste à encaisser après les options incluses", () =>
  fixture(async (gite) => {
    await db.default.gite.update({
      where: { id: gite },
      data: { options_linge_toilette_par_personne: 5 },
    });
    const row = await stay(gite, {
      frais_optionnels_montant: 150,
      options: JSON.stringify({
        draps: { enabled: true, nb_lits: 9 },
        linge_toilette: { enabled: true, nb_personnes: 3 },
      }),
    });
    const initial = await pricing.getOtaPricing(row.id);
    await pricing.saveOtaPricing(row.id, {
      revision: initial.revision,
      basis: "rental",
      amountCents: 175000,
      included: { ...empty, draps: 13500 },
    });
    assert.equal(
      (await ledger.getReservationPaymentTracking(row.id)).remaining,
      15,
    );
    await ledger.addReservationPayment(row.id, {
      id: randomUUID(),
      amount: 15,
      method: "Virement",
      purpose: "extras",
      paid_on: "2026-07-30",
      note: null,
    });
    const state = await facts.loadReportFacts();
    const payments = state.operations.filter(
      (op) => op.reservationId === row.id && op.basis === "payment",
    );
    assert.equal(
      payments
        .filter((op) => op.category === "accommodation")
        .reduce((n, op) => n + op.amountCents, 0),
      175000,
    );
    assert.equal(
      payments
        .filter((op) => op.category === "linen")
        .reduce((n, op) => n + op.amountCents, 0),
      15000,
    );
    assert.equal(
      (await ledger.getReservationPaymentTracking(row.id)).remaining,
      0,
    );
  }));

test("les séjours groupés conservent les totaux de chaque logement et chaque catégorie au centime", () =>
  fixture(async (gite) => {
    const group = randomUUID();
    const rows = [];
    for (let i = 0; i < 3; i++)
      rows.push(
        await stay(gite, {
          stay_group_id: group,
          date_entree: new Date(Date.UTC(2026, 6, 27 + i)),
          date_sortie: new Date(Date.UTC(2026, 6, 28 + i)),
          nb_nuits: 1,
          prix_total: i ? 0.33 : 0.34,
          frais_optionnels_montant: i ? 0 : 0.02,
          options: JSON.stringify({
            menage: { enabled: true },
            draps: { enabled: true, nb_lits: 1 },
          }),
        }),
      );
    const initial = await pricing.getOtaPricing(rows[1].id);
    await pricing.saveOtaPricing(rows[1].id, {
      revision: initial.revision,
      basis: "gross",
      amountCents: 100,
      included: { ...empty, menage: 1, draps: 1 },
    });
    const state = await facts.loadReportFacts();
    for (const [i, row] of rows.entries())
      for (const basis of ["stay", "payment"]) {
        const operations = state.operations.filter(
          (op) => op.reservationId === row.id && op.basis === basis,
        );
        assert.equal(
          operations.reduce((n, op) => n + op.amountCents, 0),
          i ? 33 : 34,
        );
        assert.equal(
          new Set(operations.map((op) => op.id)).size,
          operations.length,
        );
      }
  }));

test("un brut explicite prime sur l'ancienne base nette du canal", () =>
  fixture(async (gite) => {
    await settings.saveReservationPaymentSettings({
      platform_payments_received_automatically: true,
      platforms: [{ ...channel, storedPriceBasis: "net" }],
    });
    const row = await stay(gite);
    const initial = await pricing.getOtaPricing(row.id);
    await pricing.saveOtaPricing(row.id, {
      revision: initial.revision,
      basis: "rental",
      amountCents: 52200,
      included: empty,
    });
    const tracking = await ledger.getReservationPaymentTracking(row.id);
    assert.equal(tracking.entries[0].ota?.grossCents, 52200);
    assert.equal(tracking.entries[0].ota?.netCents, 47000);
    assert.equal(tracking.entries[0].ota?.effectiveRate?.percent, 10);
  }));

test("les cases reprennent les tarifs de l’application et retirent l’ancien supplément même si la quantité change", () =>
  fixture(async (gite) => {
    const row = await stay(gite, {
      frais_optionnels_montant: 255,
      options: JSON.stringify({
        menage: { enabled: true },
        draps: { enabled: true, nb_lits: 9 },
      }),
    });
    const initial = await pricing.getOtaPricing(row.id);
    assert.equal(initial.grossInputBasis, "rental");
    assert.equal(
      initial.options.find((option) => option.key === "draps")?.unitAmountCents,
      1500,
    );
    const input = {
      revision: initial.revision,
      basis: "rental",
      amountCents: 175000,
      included: { ...empty, menage: 12000, draps: 15000 },
      includedKeys: ["menage", "draps"],
      quantities: { draps: 10 },
      useOptionPrices: true,
    };
    await assert.rejects(
      pricing.saveOtaPricing(row.id, {
        ...input,
        included: { ...input.included, draps: 13500 },
      }),
      /tarifs/,
    );
    await assert.rejects(
      pricing.saveOtaPricing(row.id, { ...input, quantities: { draps: 0 } }),
    );
    const saved = await pricing.saveOtaPricing(row.id, input);
    assert.equal(saved.saved?.grossCents, 202000);
    assert.equal(saved.saved?.netCents, 184500);
    const stored = await db.default.reservation.findFirstOrThrow({
      where: { id: row.id },
    });
    assert.equal(Number(stored.frais_optionnels_montant), 0);
    assert.equal(JSON.parse(String(stored.options)).draps.nb_lits, 10);
    assert.equal(
      (await ledger.getReservationPaymentTracking(row.id)).remaining,
      0,
    );
  }));

test("les tarifs modifiés invalident la saisie ; une option gratuite cochée reste incluse", () =>
  fixture(async (gite) => {
    const row = await stay(gite);
    const initial = await pricing.getOtaPricing(row.id);
    await db.default.gite.update({
      where: { id: gite },
      data: { options_draps_par_lit: 16 },
    });
    const input = {
      revision: initial.revision,
      basis: "rental",
      amountCents: 175000,
      included: empty,
      includedKeys: ["linge_toilette"],
      quantities: { linge_toilette: 3 },
      useOptionPrices: true,
    };
    await assert.rejects(pricing.saveOtaPricing(row.id, input), /changé/);
    const fresh = await pricing.getOtaPricing(row.id);
    await pricing.saveOtaPricing(row.id, {
      ...input,
      revision: fresh.revision,
    });
    const stored = await db.default.reservation.findFirstOrThrow({
      where: { id: row.id },
    });
    const option = JSON.parse(String(stored.options)).linge_toilette;
    assert.deepEqual(
      [option.enabled, option.inclus, option.offert, option.nb_personnes],
      [true, true, false, 3],
    );
  }));

test("Pump fournit le net Airbnb : le suivi et la saisie retrouvent le brut sans le demander", () =>
  fixture(async (gite) => {
    await settings.saveReservationPaymentSettings({
      platform_payments_received_automatically: true,
      platforms: [
        {
          ...channel,
          name: "Airbnb",
          storedPriceBasis: "gross",
          commissionRounding: "cent",
          commissionScope: "all",
          rates: [{ effectiveFrom: "2026-01-01", percent: 15.5 }],
        },
      ],
    });
    const row = await stay(gite, {
      booking_source: "Airbnb",
      origin_system: "pump",
      prix_total: 692.9,
    });
    const initial = await pricing.getOtaPricing(row.id);
    assert.deepEqual(
      [
        initial.amountCents,
        initial.storedPriceBasis,
        initial.preferredInputBasis,
        initial.importedNet,
        initial.grossInputBasis,
      ],
      [69290, "net", "net", true, "gross"],
    );
    const tracking = await ledger.getReservationPaymentTracking(row.id);
    assert.deepEqual(
      [
        tracking.entries[0].ota?.grossCents,
        tracking.entries[0].ota?.feeCents,
        tracking.entries[0].ota?.netCents,
      ],
      [82000, 12710, 69290],
    );
    const saved = await pricing.saveOtaPricing(row.id, {
      revision: initial.revision,
      basis: "net",
      amountCents: initial.amountCents,
      included: empty,
      includedKeys: [],
      useOptionPrices: true,
    });
    assert.equal(saved.amountCents, 82000);
    assert.equal(saved.saved?.netCents, 69290);
    assert.equal(saved.importedNet, false);
    assert.equal(saved.storedPriceBasis, "gross");
    assert.equal(
      (await ledger.getReservationPaymentTracking(row.id)).entries[0].ota
        ?.grossCents,
      82000,
    );
    await db.default.reservation.update({
      where: { id: row.id },
      data: { prix_total: 850 },
    });
    const changed = await pricing.getOtaPricing(row.id);
    assert.equal(changed.storedPriceBasis, "unknown");
    assert.equal(changed.importedNet, false);
    assert.equal(changed.saved, undefined);
  }));
