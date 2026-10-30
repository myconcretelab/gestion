import assert from "node:assert/strict";
import { airbnbFixture } from "../../packages/shared/tests/fixtures/airbnb.js";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  evaluateReport,
  reportPeriodKey,
  snapshotDiffers,
  buildReportReminders,
  type ReportCommand,
  type ReportWorkspaceData,
} from "@contrats/shared";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "finance-reports-"));
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/modules/organizations/context.js");
let reports: typeof import("../src/modules/finance/reports/service.js");
let otaImport: typeof import("../src/modules/finance/reports/otaImport.js");
let paymentSettings: typeof import("../src/services/reservationPaymentSettings.js");
let ledger: typeof import("../src/modules/reservationPayments/ledger.js");
let factsModule: typeof import("../src/modules/finance/reports/facts.js");
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
  const result = spawnSync(
    process.execPath,
    ["scripts/prisma.mjs", "migrate", "deploy"],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  db = await import("../src/db/prisma.js");
  context = await import("../src/modules/organizations/context.js");
  reports = await import("../src/modules/finance/reports/service.js");
  ledger = await import("../src/modules/reservationPayments/ledger.js");
  otaImport = await import("../src/modules/finance/reports/otaImport.js");
  paymentSettings =
    await import("../src/services/reservationPaymentSettings.js");
  factsModule = await import("../src/modules/finance/reports/facts.js");
});
after(async () => {
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});
const inOrg = <T>(organizationId: string, fn: () => T) =>
  context.runWithOrganization({ organizationId, source: "test" }, fn);
async function fixture(
  work: (ids: { org: string; gite: string; entity: string }) => Promise<void>,
) {
  const org = `org_reports_${randomUUID()}`;
  await db.systemPrisma.organization.create({
    data: { id: org, slug: org, name: "Rapports test" },
  });
  await inOrg(org, async () => {
    const entity = await db.default.fiscalEntity.create({
      data: {
        legal_name: "Entreprise de test",
        vat_regime: "franchise_en_base",
      },
    });
    const establishment = await db.default.fiscalEstablishment.create({
      data: { fiscal_entity_id: entity.id, name: "Établissement" },
    });
    const gite = await db.default.gite.create({
      data: {
        nom: "Logement de test",
        prefixe_contrat: "R",
        adresse_ligne1: "Test",
        capacite_max: 10,
        proprietaires_noms: "Test",
        proprietaires_adresse: "Test",
        telephones: "",
        taxe_sejour_par_personne_par_nuit: 0,
        iban: "",
        titulaire: "Test",
        fiscal_establishment_id: establishment.id,
      },
    });
    await work({ org, gite: gite.id, entity: entity.id });
  });
}
const stay = (gite: string, patch: Record<string, unknown> = {}) =>
  db.default.reservation.create({
    data: {
      gite_id: gite,
      hote_nom: "Voyageur de test",
      date_entree: new Date("2026-10-30"),
      date_sortie: new Date("2026-11-03"),
      nb_nuits: 4,
      nb_adultes: 2,
      nb_enfants_2_17: 1,
      prix_par_nuit: 25,
      prix_total: 100,
      booking_source: "Direct",
      ...patch,
    },
  });
const pay = (reservation: string, amount: number, patch = {}) =>
  ledger.addReservationPayment(reservation, {
    id: randomUUID(),
    amount,
    method: "Virement",
    purpose: "payment",
    paid_on: "2026-10-01",
    ...patch,
  } as never);
const social = (state: ReportWorkspaceData) =>
  state.reports.find((row) => row.kind === "social")!;
const result = (
  state: ReportWorkspaceData,
  month = "2026-10",
  report = social(state),
) =>
  evaluateReport(
    report,
    month,
    state.overrides[reportPeriodKey(report, month)],
    state.operations,
    state,
  );
const mutate = (
  state: ReportWorkspaceData,
  command: ReportCommand,
  month = "2026-10",
) =>
  reports.mutateReportWorkspace(
    {
      revision: state.revision,
      factsRevision: state.factsRevision,
      month,
      command,
    },
    "test-user",
  );

test("les recettes proviennent des paiements reçus, y compris espèces, et non des réservations impayées", () =>
  fixture(async ({ gite }) => {
    const paid = await stay(gite);
    await stay(gite, { prix_total: 9000 });
    await pay(paid.id, 25, { method: "Espèces" });
    await pay(paid.id, 30, { paid_on: "2026-11-01" });
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 2500);
    assert.equal(result(state, "2026-11").total, 3000);
    assert.equal(result(state).reviewCount, 0);
    assert.equal(
      state.operations.filter(
        (row) => row.basis === "payment" && row.paymentMethod === "cash",
      ).length,
      1,
    );
  }));
test("les nuitées sont réparties entre les mois et ne sont pas multipliées par les paiements", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite);
    await pay(r.id, 10);
    await pay(r.id, 20);
    const state = await reports.getReportWorkspace();
    const report = state.reports.find((row) => row.kind === "tourist")!;
    assert.equal(result(state, "2026-10", report).total, 6);
    assert.equal(result(state, "2026-11", report).total, 6);
    assert.equal(
      result(state, "2026-12", { ...report, cadence: "quarterly" }).total,
      12,
    );
  }));
test("les options historiques restent incluses indépendamment de l’ancien indicateur", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite, {
      frais_optionnels_montant: 20,
      frais_optionnels_declares: false,
      options: JSON.stringify({ menage: { enabled: true } }),
    });
    await pay(r.id, 120);
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 12000);
    assert.equal(
      result(state).rows.find((row) => row.category === "cleaning")
        ?.amountCents,
      2000,
    );
  }));
test("les petits acomptes conservent chaque centime entre logements et catégories", () =>
  fixture(async ({ gite }) => {
    const group = randomUUID();
    const r = await stay(gite, {
      stay_group_id: group,
      prix_total: 1,
      frais_optionnels_montant: 0.01,
    });
    await stay(gite, {
      stay_group_id: group,
      prix_total: 2,
      frais_optionnels_montant: 0.02,
      date_entree: new Date("2026-11-03"),
      date_sortie: new Date("2026-11-07"),
    });
    for (let i = 0; i < 3; i++) await pay(r.id, 1.01);
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 303);
    assert.equal(
      state.operations
        .filter((row) => row.basis === "payment")
        .reduce((sum, row) => sum + row.amountCents, 0),
      303,
    );
    assert.deepEqual(factsModule.allocateCents(2, [1, 1, 1]), [1, 1, 0]);
  }));
test("une ventilation inconnue ne transforme pas les tarifs actuels en prix historiques", () =>
  fixture(async ({ gite }) => {
    await db.default.gite.update({
      where: { id: gite },
      data: {
        options_menage_forfait: 999,
        options_linge_toilette_par_personne: 888,
      },
    });
    const r = await stay(gite, {
      frais_optionnels_montant: 20,
      options: JSON.stringify({
        menage: { enabled: true },
        linge_toilette: { enabled: true, nb_personnes: 2 },
      }),
    });
    await pay(r.id, 120);
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 12000);
    assert.equal(
      result(state, "2026-10", { ...social(state), categories: ["cleaning"] })
        .reviewCount,
      1,
    );
    assert.equal(
      state.operations
        .filter((row) => row.basis === "payment" && row.categoryUncertain)
        .reduce((n, row) => n + row.amountCents, 0),
      2000,
    );
  }));
test("un versement de plateforme estimé ne devient pas un encaissement daté", () =>
  fixture(async ({ gite }) => {
    await stay(gite, { booking_source: "Airbnb", source_paiement: "Airbnb" });
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 0);
    assert.equal(result(state).reviewCount, 1);
    assert.equal(result(state, "2026-12").reviewCount, 0);
    assert.match(result(state).rows[0].reason, /estimé/);
  }));
test("un règlement annulé est retiré et les changements de source invalident la préparation", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite);
    const tracking = await pay(r.id, 100);
    let state = await reports.getReportWorkspace();
    state = await mutate(state, { type: "ready", reportId: social(state).id });
    await ledger.voidReservationPayment(r.id, tracking.entries[0].id);
    state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 0);
    assert.equal(
      state.progress[reportPeriodKey(social(state), "2026-10")].ready,
      false,
    );
    await assert.rejects(
      mutate(state, { type: "confirm", reportId: social(state).id }),
    );
  }));
test("les confirmations sont calculées côté serveur, immuables et conservées après une correction", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite);
    await pay(r.id, 50);
    let state = await reports.getReportWorkspace();
    const reportId = social(state).id;
    await assert.rejects(mutate(state, { type: "confirm", reportId }));
    state = await mutate(state, { type: "ready", reportId });
    state = await mutate(state, { type: "confirm", reportId });
    const key = reportPeriodKey(social(state), "2026-10");
    const frozen = state.progress[key].snapshot!;
    assert.equal(frozen.result.total, 5000);
    assert.equal(frozen.confirmedBy, "test-user");
    await pay(r.id, 50);
    state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 10000);
    assert.deepEqual(state.progress[key].snapshot, frozen);
    assert.equal(snapshotDiffers(frozen, result(state)), true);
    await assert.rejects(mutate(state, { type: "confirm", reportId }));
    assert.equal(
      await db.default.auditLog.count({ where: { action: "report.confirm" } }),
      1,
    );
  }));
test("les anciennes déclarations sont reprises sans reconstruction de leurs opérations", () =>
  fixture(async ({ gite }) => {
    const manager = await db.default.gestionnaire.create({
      data: { prenom: "Ancien", nom: "Propriétaire" },
    });
    await db.default.gite.update({
      where: { id: gite },
      data: { gestionnaire_id: manager.id },
    });
    await db.default.urssafDeclaration.create({
      data: {
        year: 2025,
        month: 12,
        gestionnaire_id: manager.id,
        amount: 123.45,
      },
    });
    await db.default.guestNightDeclaration.create({
      data: { year: 2025, month: 12, gite_id: gite, guest_nights: 12 },
    });
    const state = await reports.getReportWorkspace();
    assert.equal(
      state.legacyDeclarations.find((row) => row.kind === "social")?.value,
      12345,
    );
    assert.equal(
      state.legacyDeclarations.find((row) => row.kind === "tourist")?.value,
      12,
    );
    assert.deepEqual(state.progress, {});
    assert.deepEqual(
      state.legacyDeclarations.map((row) => row.propertyIds),
      [[gite], [gite]],
    );
    assert.deepEqual(
      buildReportReminders(state, 2026, new Date("2026-01-05T12:00:00Z")),
      [],
    );
  }));
test("les définitions persistent, les versions concurrentes et les faits périmés sont refusés", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite);
    await pay(r.id, 20);
    const original = await reports.getReportWorkspace();
    const saved = await mutate(original, {
      type: "save",
      definition: { ...social(original), name: "Mon rapport" },
    });
    assert.equal(
      (await reports.getReportWorkspace()).reports[0].name,
      "Mon rapport",
    );
    await assert.rejects(
      mutate(original, {
        type: "favorite",
        reportId: social(original).id,
        favorite: false,
      }),
    );
    await pay(r.id, 10);
    await assert.rejects(
      mutate(saved, { type: "ready", reportId: social(saved).id }),
    );
  }));
test("un propriétaire historique reste à confirmer comme exploitant", () =>
  fixture(async ({ gite }) => {
    const manager = await db.default.gestionnaire.create({
      data: { prenom: "Propriétaire", nom: "Contact" },
    });
    await db.default.gite.update({
      where: { id: gite },
      data: { fiscal_establishment_id: null, gestionnaire_id: manager.id },
    });
    const r = await stay(gite);
    await pay(r.id, 100);
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 0);
    assert.equal(result(state).reviewCount, 1);
    assert.match(result(state).rows[0].reason, /établissement facturant/);
  }));
test("les rapports sont isolés entre organisations et refusent les logements d’une autre organisation", () =>
  fixture(async ({ gite, org }) => {
    const r = await stay(gite);
    await pay(r.id, 100);
    const a = await reports.getReportWorkspace();
    await fixture(async ({ gite: otherGite }) => {
      const b = await reports.getReportWorkspace();
      assert.equal(result(b).total, 0);
      assert.equal(
        b.operations.some((row) => row.reservationId === r.id),
        false,
      );
      await assert.rejects(
        mutate(b, {
          type: "save",
          definition: { ...social(b), propertyIds: [gite] },
        }),
      );
      await mutate(b, {
        type: "favorite",
        reportId: social(b).id,
        favorite: false,
      });
      assert.equal(await db.default.financeReportStore.count(), 1);
      assert.notEqual(otherGite, gite);
    });
    assert.equal(await db.default.financeReportStore.count(), 0);
    assert.equal((await reports.getReportWorkspace()).organizationId, org);
    assert.equal(
      a.operations.some((row) => row.reservationId === r.id),
      true,
    );
  }));
test("les commandes refusent les montants et copies fournis par le navigateur", () =>
  fixture(async ({ gite }) => {
    const state = await reports.getReportWorkspace();
    const forged = {
      revision: state.revision,
      factsRevision: state.factsRevision,
      month: "2026-10",
      command: {
        type: "confirm",
        reportId: social(state).id,
        result: { total: 1 },
      },
    };
    await assert.rejects(reports.mutateReportWorkspace(forged));
    await assert.rejects(
      mutate(state, {
        type: "override",
        reportId: social(state).id,
        operationId: "receipt",
        override: { status: "excluded", note: "Test" },
      }),
    );
    assert.equal(
      await db.default.reservation.count({ where: { gite_id: gite } }),
      0,
    );
  }));

test("la ventilation manuelle est persistée, contrôlée au centime et périmée si le total change", () =>
  fixture(async ({ gite }) => {
    const allocation =
      await import("../src/modules/finance/reports/allocation.js");
    const r = await stay(gite, { frais_optionnels_montant: 20 });
    await pay(r.id, 120);
    const before = await allocation.getReportAllocation(r.id);
    await assert.rejects(
      allocation.saveReportAllocation(r.id, {
        updatedAt: before.updatedAt,
        amounts: { cleaning: 1500, linen: 600, extras: 0 },
      }),
    );
    await allocation.saveReportAllocation(
      r.id,
      {
        updatedAt: before.updatedAt,
        amounts: { cleaning: 1500, linen: 500, extras: 0 },
      },
      "test-user",
    );
    let state = await reports.getReportWorkspace();
    assert.equal(
      result(state, "2026-10", { ...social(state), categories: ["cleaning"] })
        .total,
      1500,
    );
    await assert.rejects(
      allocation.saveReportAllocation(r.id, {
        updatedAt: before.updatedAt,
        amounts: { cleaning: 1000, linen: 1000, extras: 0 },
      }),
    );
    await db.default.reservation.update({
      where: { id: r.id },
      data: { frais_optionnels_montant: 25 },
    });
    state = await reports.getReportWorkspace();
    assert.equal(
      state.operations.some(
        (row) => row.basis === "payment" && row.categoryUncertain,
      ),
      true,
    );
    assert.equal((await allocation.getReportAllocation(r.id)).amounts, null);
    assert.equal(
      (await db.default.reservation.findFirstOrThrow({ where: { id: r.id } }))
        .frais_optionnels_declares,
      false,
    );
  }));
test("les remboursements partiels ou complets restent visibles avec leur date à rapprocher", () =>
  fixture(async ({ gite }) => {
    for (const refunded of [5000, 10000]) {
      const r = await stay(gite);
      await db.default.bookingPayment.create({
        data: {
          reservation_id: r.id,
          stripe_mode: "live",
          purpose: "full",
          amount_cents: 10000,
          total_cents: 10000,
          paid_amount_cents: 10000,
          refunded_amount_cents: refunded,
          status: "refunded",
          access_token_hash: randomUUID(),
          expires_at: new Date("2026-10-01"),
          paid_at: new Date("2026-10-01T10:00:00Z"),
        },
      });
    }
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 0);
    assert.equal(
      state.operations.filter((row) => row.id.startsWith("refund-pending:"))
        .length,
      2,
    );
    assert.equal(result(state, "2026-12").reviewCount, 0);
  }));
test("les règlements par carte sont rattachés à la date civile en France", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite);
    await db.default.bookingPayment.create({
      data: {
        reservation_id: r.id,
        stripe_mode: "live",
        purpose: "full",
        amount_cents: 10000,
        total_cents: 10000,
        paid_amount_cents: 10000,
        status: "paid",
        access_token_hash: randomUUID(),
        expires_at: new Date("2026-11-01"),
        paid_at: new Date("2026-10-31T23:30:00Z"),
      },
    });
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 0);
    assert.equal(result(state, "2026-11").total, 10000);
  }));
test("la taxe collectée pour la collectivité ne gonfle pas les recettes sociales", () =>
  fixture(async ({ gite }) => {
    const policy = {
      version: 1,
      classified: true,
      stars: 2,
      included: false,
      fixed_rate: 1,
      percentage: 0,
      cap: 0,
      additional_percentage: 0,
      accommodation_vat_rate: 0,
      authority: "Collectivité",
      effective_from: "2026-01-01",
    };
    const r = await stay(gite, {
      options: JSON.stringify({
        tourist_tax: {
          settings: policy,
          collector: "host",
          platform: "",
          infants: 0,
          exempt_adults: 0,
          exemption_reason: "",
        },
      }),
    });
    await pay(r.id, 108);
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 10000);
    assert.equal(
      state.operations
        .filter(
          (row) => row.basis === "payment" && row.category === "tourist_tax",
        )
        .reduce((sum, row) => sum + row.amountCents, 0),
      800,
    );
  }));
test("la TVA inconnue ou non ventilée empêche de confirmer un total social TTC", () =>
  fixture(async ({ gite, entity }) => {
    const r = await stay(gite);
    await pay(r.id, 100);
    for (const vat_regime of ["unknown", "reel_normal"]) {
      await db.default.fiscalEntity.update({
        where: { id: entity },
        data: { vat_regime },
      });
      const state = await reports.getReportWorkspace();
      assert.equal(result(state).total, 0);
      assert.equal(result(state).reviewCount, 1);
      assert.equal(result(state).rows[0].issues[0].kind, "fiscal");
      await assert.rejects(
        mutate(state, { type: "ready", reportId: social(state).id }),
      );
    }
  }));
test("un rapport sans recettes peut être confirmé à zéro", () =>
  fixture(async () => {
    let state = await reports.getReportWorkspace();
    const reportId = social(state).id;
    state = await mutate(state, { type: "ready", reportId });
    state = await mutate(state, { type: "confirm", reportId });
    assert.equal(
      state.progress[reportPeriodKey(social(state), "2026-10")].snapshot?.result
        .total,
      0,
    );
  }));

test("les corrections internes gardent une identité stable et sont à revoir si les montants changent", () =>
  fixture(async ({ gite }) => {
    const allocation =
      await import("../src/modules/finance/reports/allocation.js");
    const r = await stay(gite, {
      frais_optionnels_montant: 20,
      options: JSON.stringify({ menage: { enabled: true } }),
    });
    await pay(r.id, 120);
    let state = await reports.getReportWorkspace();
    const internal = {
      ...social(state),
      id: "internal",
      kind: "custom" as const,
    };
    state = await mutate(state, { type: "save", definition: internal });
    const cleaning = result(state, "2026-10", internal).rows.find(
      (row) => row.category === "cleaning",
    )!;
    state = await mutate(state, {
      type: "override",
      reportId: internal.id,
      operationId: cleaning.id,
      override: { status: "excluded", note: "Correction interne motivée" },
    });
    assert.equal(
      result(state, "2026-10", internal).rows.find(
        (row) => row.id === cleaning.id,
      )?.status,
      "excluded",
    );
    const source = await allocation.getReportAllocation(r.id);
    await allocation.saveReportAllocation(r.id, {
      updatedAt: source.updatedAt,
      amounts: { cleaning: 1500, linen: 500, extras: 0 },
    });
    state = await reports.getReportWorkspace();
    const changed = result(state, "2026-10", internal).rows.find(
      (row) => row.id === cleaning.id,
    )!;
    assert.equal(changed.category, "cleaning");
    assert.equal(changed.amountCents, 1500);
    assert.equal(changed.status, "review");
    assert.equal(changed.issues[0].kind, "correction");
    const linen = result(state, "2026-10", internal).rows.find(
      (row) => row.category === "linen",
    )!;
    assert.notEqual(linen.id, cleaning.id);
    assert.equal(linen.status, "included");
  }));
test("les favoris ne remettent pas en cause un rapport déjà vérifié", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite);
    await pay(r.id, 100);
    let state = await reports.getReportWorkspace();
    const reportId = social(state).id;
    state = await mutate(state, { type: "ready", reportId });
    state = await mutate(state, {
      type: "favorite",
      reportId,
      favorite: false,
    });
    assert.equal(
      state.progress[reportPeriodKey(social(state), "2026-10")].ready,
      true,
    );
    state = await mutate(state, { type: "confirm", reportId });
    assert.equal(
      state.progress[reportPeriodKey(social(state), "2026-10")].snapshot?.result
        .total,
      10000,
    );
  }));

test("les paiements Stripe en mode test ne deviennent pas des recettes réelles", () =>
  fixture(async ({ gite }) => {
    for (const stripe_mode of ["test", "live"]) {
      const r = await stay(gite);
      await db.default.bookingPayment.create({
        data: {
          reservation_id: r.id,
          stripe_mode,
          purpose: "full",
          amount_cents: 10000,
          total_cents: 10000,
          paid_amount_cents: 10000,
          status: "paid",
          access_token_hash: randomUUID(),
          expires_at: new Date("2026-10-01"),
          paid_at: new Date("2026-10-01T10:00:00Z"),
        },
      });
    }
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 10000);
    assert.equal(
      state.operations.filter((row) => row.basis === "payment").length,
      1,
    );
  }));

test("un remboursement groupé reste à vérifier dans chaque logement concerné", () =>
  fixture(async ({ gite }) => {
    const original = await db.default.gite.findFirstOrThrow({
      where: { id: gite },
    });
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...fields
    } = original;
    const second = await db.default.gite.create({
      data: { ...fields, nom: "Second logement", prefixe_contrat: "R2" },
    });
    const group = randomUUID();
    const r = await stay(gite, { stay_group_id: group, prix_total: 40 });
    await stay(second.id, { stay_group_id: group, prix_total: 60 });
    await db.default.bookingPayment.create({
      data: {
        reservation_id: r.id,
        stripe_mode: "live",
        purpose: "full",
        amount_cents: 10000,
        total_cents: 10000,
        paid_amount_cents: 10000,
        refunded_amount_cents: 5000,
        status: "partially_refunded",
        access_token_hash: randomUUID(),
        expires_at: new Date("2026-10-01"),
        paid_at: new Date("2026-10-01T10:00:00Z"),
      },
    });
    const state = await reports.getReportWorkspace();
    const pending = state.operations.filter((row) =>
      row.id.startsWith("refund-pending:"),
    );
    assert.equal(pending.length, 2);
    assert.equal(
      pending.reduce((sum, row) => sum + row.amountCents, 0),
      -5000,
    );
    assert.equal(
      result(state, "2026-10", { ...social(state), propertyIds: [second.id] })
        .reviewCount,
      2,
    );
    assert.equal(result(state, "2026-12").reviewCount, 0);
  }));

test("les JSON et montants PostgreSQL et SQLite conservent la même ventilation", async () => {
  const { allocationSource, storedAllocation, reportOptionsSignature } =
    await import("../src/modules/finance/reports/allocation.js");
  const sqlite = {
    options:
      '{"menage":{"enabled":true,"offert":false},"draps":{"nb_lits":2,"enabled":true}}',
    frais_optionnels_montant: 20,
  };
  const postgres = {
    options: {
      draps: { enabled: true, nb_lits: 2 },
      menage: { offert: false, enabled: true },
    },
    frais_optionnels_montant: { toString: () => "20.00" },
  };
  assert.equal(
    reportOptionsSignature(sqlite.options),
    reportOptionsSignature(postgres.options),
  );
  assert.equal(allocationSource(sqlite), allocationSource(postgres));
  const amounts = { cleaning: 1500, linen: 500, extras: 0 };
  const reporting_amounts = JSON.stringify({
    source: allocationSource(sqlite),
    amounts,
  });
  assert.deepEqual(
    storedAllocation({ ...postgres, reporting_amounts }),
    amounts,
  );
});

test("import OTA : aperçu sans écriture, rattachement exact, brut/net/options, doublons et copie confirmée", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      prix_total: 85,
      frais_optionnels_montant: 15,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
      airbnb_url:
        "https://www.airbnb.com/hosting/reservations/details/HM12345678",
    });
    const content = airbnbFixture();
    const preview = await otaImport.previewOtaImport(content);
    assert.equal(preview.totals.grossCents, 11500);
    assert.equal(preview.totals.netCents, 10000);
    assert.equal(preview.rows[1].reservationId, reservation.id);
    assert.equal(await db.default.otaTransaction.count(), 0);
    const choices = preview.rows
      .filter((row) => row.type !== "payout")
      .map((row) => ({
        key: row.key,
        reservationId: reservation.id,
        settlementBasis: "net" as const,
        ...(row.type === "resolution" ? { category: "linen" as const } : {}),
      }));
    const applied = await otaImport.applyOtaImport(
      {
        content,
        fileName: "anonyme.csv",
        fingerprint: preview.fingerprint,
        choices,
      },
      "test-user",
    );
    assert.equal(applied.added, 3);
    const tracking = await ledger.getReservationPaymentTracking(reservation.id);
    assert.equal(tracking.remaining, 0);
    assert.equal(tracking.platform?.extras_remaining, 0);
    assert.equal(
      tracking.entries.filter((entry) => entry.origin === "platform").length,
      0,
    );
    let state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 11500);
    assert.equal(
      result(state, "2026-10", { ...social(state), otaAmountBasis: "net" })
        .total,
      10000,
    );
    assert.equal(
      result(state, "2026-10", { ...social(state), categories: ["linen"] })
        .total,
      1500,
    );
    assert.equal(
      (
        await db.default.reservation.findUniqueOrThrow({
          where: { id: reservation.id },
        })
      ).prix_total,
      85,
    );
    const again = await otaImport.previewOtaImport(content);
    assert.ok(again.rows.every((row) => row.status === "imported"));
    assert.equal(
      (
        await otaImport.applyOtaImport({
          content,
          fileName: "encore.csv",
          fingerprint: again.fingerprint,
          choices,
        })
      ).added,
      0,
    );
    assert.equal(await db.default.reservationRecordedPayment.count(), 2);
    state = await mutate(state, { type: "ready", reportId: social(state).id });
    state = await mutate(state, {
      type: "confirm",
      reportId: social(state).id,
    });
    const fixed =
      state.progress[reportPeriodKey(social(state), "2026-10")].snapshot!;
    const changed = await mutate(state, {
      type: "save",
      definition: { ...social(state), otaAmountBasis: "net" },
    });
    assert.equal(fixed.result.total, 11500);
    assert.equal(result(changed).total, 10000);
    assert.equal(snapshotDiffers(fixed, result(changed)), true);
  }));

test("import OTA : une révision périmée et une ligne non classée annulent toute la transaction", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      prix_total: 85,
      frais_optionnels_montant: 15,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    const content = airbnbFixture();
    const preview = await otaImport.previewOtaImport(content);
    await assert.rejects(
      otaImport.applyOtaImport({
        content,
        fileName: "test.csv",
        fingerprint: preview.fingerprint,
        choices: [],
      }),
      /catégorie/,
    );
    assert.equal(await db.default.otaTransaction.count(), 0);
    assert.equal(await db.default.reservationRecordedPayment.count(), 0);
    await db.default.reservation.update({
      where: { id: reservation.id },
      data: { prix_total: 90 },
    });
    await assert.rejects(
      otaImport.applyOtaImport({
        content,
        fileName: "test.csv",
        fingerprint: preview.fingerprint,
        choices: [],
      }),
      /changé/,
    );
  }));

test("import OTA : rapprochement d’un règlement existant et annulation sans résurrection au réimport", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      prix_total: 85,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: false,
    });
    await pay(reservation.id, 85, { method: "Versement plateforme" });
    const content = airbnbFixture({}, { resolution: false });
    let preview = await otaImport.previewOtaImport(content);
    const row = preview.rows.find((row) => row.type === "reservation")!;
    const choice = {
      key: row.key,
      reservationId: reservation.id,
      settlementBasis: "net" as const,
    };
    await assert.rejects(
      otaImport.applyOtaImport({
        content,
        fileName: "test.csv",
        fingerprint: preview.fingerprint,
        choices: [choice],
      }),
      /déjà saisi|doublon/,
    );
    const existing =
      await db.default.reservationRecordedPayment.findFirstOrThrow();
    await otaImport.applyOtaImport({
      content,
      fileName: "test.csv",
      fingerprint: preview.fingerprint,
      choices: [{ ...choice, paymentId: existing.id }],
    });
    assert.equal(await db.default.reservationRecordedPayment.count(), 1);
    assert.equal(result(await reports.getReportWorkspace()).total, 10000);
    await ledger.voidReservationPayment(reservation.id, existing.id);
    preview = await otaImport.previewOtaImport(content);
    assert.equal(
      preview.rows.find((row) => row.type === "reservation")!.status,
      "conflict",
    );
    assert.equal(result(await reports.getReportWorkspace()).total, 0);
  }));

test("options encaissées par un autre canal : commission datée figée et ventilation de prestations", () =>
  fixture(async ({ gite }) => {
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: true,
      platforms: [
        {
          name: "Airbnb",
          automatic: true,
          storedPriceBasis: "net",
          rateDateBasis: "payment",
          rates: [
            { effectiveFrom: "2026-01-01", percent: 10 },
            { effectiveFrom: "2026-11-01", percent: 20 },
          ],
        },
      ],
    });
    const reservation = await stay(gite, { frais_optionnels_montant: 50 });
    await pay(reservation.id, 50, {
      method: "Versement plateforme",
      purpose: "extras",
      channel: "Airbnb",
      category: "linen",
      paid_on: "2026-10-31",
    });
    let state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 5000);
    assert.equal(
      result(state, "2026-10", { ...social(state), otaAmountBasis: "net" })
        .total,
      4500,
    );
    assert.equal(
      state.operations.find((operation) => operation.ota)?.category,
      "linen",
    );
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: true,
      platforms: [
        {
          name: "Airbnb",
          automatic: true,
          rates: [{ effectiveFrom: "2026-01-01", percent: 90 }],
        },
      ],
    });
    state = await reports.getReportWorkspace();
    assert.equal(
      state.operations.find((operation) => operation.ota)?.ota?.feeCents,
      500,
    );
    assert.equal(
      (await ledger.getReservationPaymentTracking(reservation.id)).remaining,
      100,
    );
  }));

test("import OTA : un séjour groupé conserve les logements, le ménage et les centimes", () =>
  fixture(async ({ gite }) => {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...fields
    } = await db.default.gite.findUniqueOrThrow({ where: { id: gite } });
    const second = await db.default.gite.create({
      data: { ...fields, nom: "Second logement", prefixe_contrat: "R2" },
    });
    const group = randomUUID();
    const first = await stay(gite, {
      stay_group_id: group,
      prix_total: 34,
      frais_optionnels_montant: 10,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    await stay(second.id, {
      stay_group_id: group,
      prix_total: 51,
      frais_optionnels_montant: 15,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    const content = airbnbFixture(
      { "Frais de ménage": "10.00" },
      { resolution: false },
    );
    const preview = await otaImport.previewOtaImport(content);
    const row = preview.rows.find((row) => row.type === "reservation")!;
    assert.equal(row.suggestedBasis, "net");
    assert.equal(row.existingAmountCents, 8500);
    await otaImport.applyOtaImport({
      content,
      fileName: "groupe.csv",
      fingerprint: preview.fingerprint,
      choices: [],
    });
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 10000);
    assert.equal(
      result(state, "2026-10", { ...social(state), otaAmountBasis: "net" })
        .total,
      8500,
    );
    assert.equal(
      result(state, "2026-10", { ...social(state), propertyIds: [gite] }).total,
      4000,
    );
    assert.equal(
      result(state, "2026-10", { ...social(state), propertyIds: [second.id] })
        .total,
      6000,
    );
    assert.equal(
      result(state, "2026-10", { ...social(state), categories: ["cleaning"] })
        .total,
      1000,
    );
    assert.equal(
      (await ledger.getReservationPaymentTracking(first.id)).remaining,
      25,
    );
    await pay(first.id, 25, {
      method: "Versement plateforme",
      channel: "Airbnb",
      category: "linen",
      purpose: "deposit",
      fee_amount: 0,
      paid_on: "2026-10-31",
    });
    assert.equal(
      (await ledger.getReservationPaymentTracking(first.id)).platform
        ?.extras_remaining,
      0,
    );
    const afterExtras = await reports.getReportWorkspace();
    assert.equal(
      result(afterExtras, "2026-10", {
        ...social(afterExtras),
        propertyIds: [gite],
        categories: ["linen"],
      }).total,
      1000,
    );
    assert.equal(
      result(afterExtras, "2026-10", {
        ...social(afterExtras),
        propertyIds: [second.id],
        categories: ["linen"],
      }).total,
      1500,
    );
    assert.equal(
      (await ledger.getReservationPaymentTracking(first.id)).remaining,
      0,
    );
    const changed = airbnbFixture(
      {
        "Frais de ménage": "10.00",
        "Revenus bruts": "101.00",
        "Frais de service": "16.00",
      },
      { resolution: false },
    );
    assert.equal(
      (await otaImport.previewOtaImport(changed)).rows[1].status,
      "conflict",
    );
  }));

test("import OTA : un complément déjà saisi conserve sa date et ne crée aucun doublon", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      prix_total: 85,
      frais_optionnels_montant: 15,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    await pay(reservation.id, 15, { purpose: "extras", paid_on: "2026-11-01" });
    const existing =
      await db.default.reservationRecordedPayment.findFirstOrThrow();
    const content = airbnbFixture();
    const preview = await otaImport.previewOtaImport(content);
    const choices = preview.rows
      .filter((row) => row.type !== "payout")
      .map((row) => ({
        key: row.key,
        reservationId: reservation.id,
        settlementBasis: "net" as const,
        ...(row.type === "resolution"
          ? { category: "linen" as const, paymentId: existing.id }
          : {}),
      }));
    await otaImport.applyOtaImport({
      content,
      fileName: "complement.csv",
      fingerprint: preview.fingerprint,
      choices,
    });
    assert.equal(await db.default.reservationRecordedPayment.count(), 2);
    const updated =
      await db.default.reservationRecordedPayment.findUniqueOrThrow({
        where: { id: existing.id },
      });
    assert.equal(updated.paid_on?.toISOString().slice(0, 10), "2026-11-01");
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 10000);
    assert.equal(result(state, "2026-11").total, 1500);
    assert.equal(
      (await ledger.getReservationPaymentTracking(reservation.id)).remaining,
      0,
    );
  }));

test("import OTA : mêmes références isolées par organisation et rattachement étranger refusé", () =>
  fixture(async ({ gite }) => {
    const own = await stay(gite, {
      prix_total: 85,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    const content = airbnbFixture({}, { resolution: false });
    let foreignId = "";
    await fixture(async ({ gite: foreignGite }) => {
      const foreign = await stay(foreignGite, {
        prix_total: 85,
        booking_source: "Airbnb",
        origin_reference: "listing|HM12345678",
      });
      foreignId = foreign.id;
      const preview = await otaImport.previewOtaImport(content);
      await otaImport.applyOtaImport({
        content,
        fileName: "autre.csv",
        fingerprint: preview.fingerprint,
        choices: [],
      });
    });
    const preview = await otaImport.previewOtaImport(content);
    assert.equal(preview.rows[1].status, "new");
    assert.equal(preview.rows[1].reservationId, own.id);
    await assert.rejects(
      otaImport.applyOtaImport({
        content,
        fileName: "test.csv",
        fingerprint: preview.fingerprint,
        choices: [
          {
            key: preview.rows[1].key,
            reservationId: foreignId,
            settlementBasis: "net",
          },
        ],
      }),
      /rattachez/,
    );
    assert.equal(await db.default.otaTransaction.count(), 0);
    await otaImport.applyOtaImport({
      content,
      fileName: "test.csv",
      fingerprint: preview.fingerprint,
      choices: [],
    });
    assert.equal(await db.default.otaTransaction.count(), 2);
  }));

test("import OTA : régularisation explicite d’un centime, prix et relevé conservés, audit et réimport", async () => {
  for (const [price, basis, sourceAmount, delta] of [
    [85.01, "net", 8500, 1],
    [84.99, "net", 8500, -1],
    [100.01, "gross", 10000, 1],
    [99.99, "gross", 10000, -1],
  ] as const) {
    await fixture(async ({ gite }) => {
      const reservation = await stay(gite, {
        prix_total: price,
        booking_source: "Airbnb",
        origin_reference: "listing|HM12345678",
      });
      const content = airbnbFixture({}, { resolution: false });
      const preview = await otaImport.previewOtaImport(content);
      const row = preview.rows[1];
      assert.equal(row.suggestedBasis, null);
      assert.equal(row.roundingAdjustment?.basis, basis);
      assert.equal(row.roundingAdjustment?.adjustmentCents, delta);
      await assert.rejects(
        otaImport.applyOtaImport({
          content,
          fileName: "arrondi.csv",
          fingerprint: preview.fingerprint,
          choices: [],
        }),
        /choisissez le montant/,
      );
      const choice = {
        key: row.key,
        reservationId: reservation.id,
        settlementBasis: "reservation" as const,
        regularizeOneCent: true,
      };
      const applied = await otaImport.applyOtaImport({
        content,
        fileName: "arrondi.csv",
        fingerprint: preview.fingerprint,
        choices: [choice],
      });
      assert.equal(applied.regularized, 1);
      const tracking = await ledger.getReservationPaymentTracking(
        reservation.id,
      );
      assert.equal(tracking.remaining, 0);
      assert.equal(tracking.overpaid, 0);
      assert.equal(tracking.received, price);
      const receipt = tracking.entries.find((entry) => entry.ota)!;
      assert.deepEqual(receipt.ota?.settlementAdjustment, {
        basis,
        sourceAmountCents: sourceAmount,
        recordedAmountCents: Math.round(price * 100),
        adjustmentCents: delta,
      });
      assert.match(receipt.note!, /Écart d’arrondi/);
      assert.equal(
        (
          await db.default.reservation.findUniqueOrThrow({
            where: { id: reservation.id },
          })
        ).prix_total,
        price,
      );
      const state = await reports.getReportWorkspace();
      assert.equal(result(state).total, 10000);
      assert.equal(
        result(state, "2026-10", { ...social(state), otaAmountBasis: "net" })
          .total,
        8500,
      );
      const history = await otaImport.listOtaImports();
      assert.equal(history[0].regularized, 1);
      const adjustments = history[0].roundingAdjustments as Array<{
        adjustmentCents: number;
        reservationId: string;
      }>;
      assert.equal(adjustments[0].adjustmentCents, delta);
      assert.equal(adjustments[0].reservationId, reservation.id);
      const again = await otaImport.previewOtaImport(content);
      assert.equal(again.rows[1].roundingAdjustment, null);
      const reapplied = await otaImport.applyOtaImport({
        content,
        fileName: "arrondi.csv",
        fingerprint: again.fingerprint,
        choices: [choice],
      });
      assert.equal(reapplied.added, 0);
      assert.equal(reapplied.regularized, 0);
      assert.equal(await db.default.reservationRecordedPayment.count(), 1);
    });
  }
});

test("import OTA : le serveur refuse une régularisation forcée hors tolérance ou avec des dates différentes", async () => {
  for (const patch of [
    { prix_total: 85.02 },
    { prix_total: 85.01, date_entree: new Date("2026-10-29") },
  ]) {
    await fixture(async ({ gite }) => {
      const reservation = await stay(gite, {
        booking_source: "Airbnb",
        origin_reference: "listing|HM12345678",
        ...patch,
      });
      const content = airbnbFixture({}, { resolution: false });
      const preview = await otaImport.previewOtaImport(content);
      assert.equal(preview.rows[1].roundingAdjustment, null);
      await assert.rejects(
        otaImport.applyOtaImport({
          content,
          fileName: "invalide.csv",
          fingerprint: preview.fingerprint,
          choices: [
            {
              key: preview.rows[1].key,
              reservationId: reservation.id,
              settlementBasis: "reservation",
              regularizeOneCent: true,
            },
          ],
        }),
        /régularisation automatique/,
      );
      assert.equal(await db.default.otaTransaction.count(), 0);
      assert.equal(await db.default.reservationRecordedPayment.count(), 0);
    });
  }
});

test("import OTA : l’arrondi ne contourne pas un règlement existant ni une révision périmée", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      prix_total: 85.01,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: false,
    });
    await pay(reservation.id, 85.01, { method: "Versement plateforme" });
    const content = airbnbFixture({}, { resolution: false });
    const preview = await otaImport.previewOtaImport(content);
    const choice = {
      key: preview.rows[1].key,
      reservationId: reservation.id,
      settlementBasis: "reservation" as const,
      regularizeOneCent: true,
    };
    await assert.rejects(
      otaImport.applyOtaImport({
        content,
        fileName: "doublon.csv",
        fingerprint: preview.fingerprint,
        choices: [choice],
      }),
      /doublon|déjà saisi/,
    );
    assert.equal(await db.default.otaTransaction.count(), 0);
    await db.default.reservation.update({
      where: { id: reservation.id },
      data: { prix_total: 85.02 },
    });
    await assert.rejects(
      otaImport.applyOtaImport({
        content,
        fileName: "perime.csv",
        fingerprint: preview.fingerprint,
        choices: [choice],
      }),
      /changé/,
    );
  }));

test("import OTA : un centime régularisé sur un séjour groupé conserve les totaux de chaque base", () =>
  fixture(async ({ gite }) => {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...fields
    } = await db.default.gite.findUniqueOrThrow({ where: { id: gite } });
    const second = await db.default.gite.create({
      data: { ...fields, nom: "Second logement", prefixe_contrat: "R2" },
    });
    const group = randomUUID();
    const first = await stay(gite, {
      stay_group_id: group,
      prix_total: 34,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    await stay(second.id, {
      stay_group_id: group,
      prix_total: 51.01,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    const content = airbnbFixture({}, { resolution: false });
    const preview = await otaImport.previewOtaImport(content);
    const row = preview.rows[1];
    assert.equal(row.roundingAdjustment?.adjustmentCents, 1);
    const applied = await otaImport.applyOtaImport({
      content,
      fileName: "groupe.csv",
      fingerprint: preview.fingerprint,
      choices: [
        {
          key: row.key,
          reservationId: row.reservationId!,
          settlementBasis: "reservation",
          regularizeOneCent: true,
        },
      ],
    });
    assert.equal(applied.regularized, 1);
    const tracking = await ledger.getReservationPaymentTracking(first.id);
    assert.equal(tracking.remaining, 0);
    assert.equal(tracking.received, 85.01);
    const allocations = tracking.entries.find((entry) => entry.ota)?.ota
      ?.allocations!;
    assert.equal(
      allocations.reduce((sum, allocation) => sum + allocation.grossCents, 0),
      10000,
    );
    assert.equal(
      allocations.reduce((sum, allocation) => sum + allocation.netCents, 0),
      8500,
    );
    const state = await reports.getReportWorkspace();
    assert.equal(result(state).total, 10000);
    assert.equal(
      result(state, "2026-10", { ...social(state), otaAmountBasis: "net" })
        .total,
      8500,
    );
    assert.equal(await db.default.reservationRecordedPayment.count(), 1);
  }));

test("import OTA : un règlement existant rapproché explicitement peut solder son centime sans doublon ni changement de date", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      prix_total: 85.01,
      booking_source: "Airbnb",
      origin_reference: "listing|HM12345678",
    });
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: false,
    });
    await pay(reservation.id, 85, {
      method: "Versement plateforme",
      paid_on: "2026-10-02",
    });
    const existing =
      await db.default.reservationRecordedPayment.findFirstOrThrow();
    const content = airbnbFixture({}, { resolution: false });
    const preview = await otaImport.previewOtaImport(content);
    await otaImport.applyOtaImport({
      content,
      fileName: "rapprochement.csv",
      fingerprint: preview.fingerprint,
      choices: [
        {
          key: preview.rows[1].key,
          reservationId: reservation.id,
          settlementBasis: "reservation",
          regularizeOneCent: true,
          paymentId: existing.id,
        },
      ],
    });
    const updated =
      await db.default.reservationRecordedPayment.findUniqueOrThrow({
        where: { id: existing.id },
      });
    assert.equal(updated.amount_cents, 8501);
    assert.equal(updated.paid_on?.toISOString().slice(0, 10), "2026-10-02");
    assert.equal(await db.default.reservationRecordedPayment.count(), 1);
    assert.equal(
      (await ledger.getReservationPaymentTracking(reservation.id)).remaining,
      0,
    );
    const state = await reports.getReportWorkspace();
    assert.equal(
      result(state, "2026-10", { ...social(state), otaAmountBasis: "net" })
        .total,
      8500,
    );
  }));
