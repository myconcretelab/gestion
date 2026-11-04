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
  buildReportWorklist,
  createReport,
  nightRegisterCsv,
  type ReportCommand,
  type ReportWorkspaceData,
} from "@contrats/shared";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "finance-reports-"));
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/modules/organizations/context.js");
let reports: typeof import("../src/modules/finance/reports/service.js");
let nightSummaries: typeof import("../src/modules/finance/reports/nightSummaries.js");
let nightRegister: typeof import("../src/modules/finance/reports/nightRegister.js");
let otaImport: typeof import("../src/modules/finance/reports/otaImport.js");
let paymentSettings: typeof import("../src/services/reservationPaymentSettings.js");
let ledger: typeof import("../src/modules/reservationPayments/ledger.js");
let factsModule: typeof import("../src/modules/finance/reports/facts.js");
let reportCache: typeof import("../src/modules/finance/reports/cache.js");
let reportAutomation: typeof import("../src/services/reportAutomation.js");
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
  nightSummaries =
    await import("../src/modules/finance/reports/nightSummaries.js");
  nightRegister =
    await import("../src/modules/finance/reports/nightRegister.js");
  ledger = await import("../src/modules/reservationPayments/ledger.js");
  otaImport = await import("../src/modules/finance/reports/otaImport.js");
  paymentSettings =
    await import("../src/services/reservationPaymentSettings.js");
  factsModule = await import("../src/modules/finance/reports/facts.js");
  reportCache = await import("../src/modules/finance/reports/cache.js");
  reportAutomation = await import("../src/services/reportAutomation.js");
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

test("le début du suivi est conservé sans créer de fausses déclarations et reste isolé par organisation", () =>
  fixture(async ({ gite }) => {
    await stay(gite, {
      date_entree: new Date("2017-01-06"),
      date_sortie: new Date("2017-01-10"),
    });
    const initial = await reports.getReportWorkspace();
    const state = await mutate(initial, {
      type: "worklist-start",
      startMonth: "2026-09",
    });
    assert.equal(state.worklistStartMonth, "2026-09");
    assert.deepEqual(state.progress, initial.progress);
    assert.deepEqual(state.legacyDeclarations, initial.legacyDeclarations);
    const reloaded = await reports.getReportWorkspace();
    const pending = buildReportWorklist(
      reloaded,
      new Date("2026-10-31T12:00:00Z"),
    );
    assert.equal(pending.length, 2);
    assert.ok(pending.every((item) => item.month === "2026-09"));
    const audit = await db.default.auditLog.findFirst({
      where: { action: "report.worklist-start" },
    });
    assert.equal(audit?.resource_id, "worklist");
    await assert.rejects(
      mutate(initial, { type: "worklist-start", startMonth: "2026-08" }),
      /Les données ont changé/,
    );
    await assert.rejects(
      mutate(reloaded, { type: "worklist-start", startMonth: "2026-13" }),
    );
    await fixture(async () => {
      const other = await reports.getReportWorkspace();
      assert.equal(other.worklistStartMonth, undefined);
    });
  }));

test("le début du suivi propre à un rapport est enregistré, audité et permet sa confirmation", () =>
  fixture(async ({ gite }) => {
    for (const month of ["07", "08"])
      await stay(gite, {
        date_entree: new Date(`2026-${month}-10`),
        date_sortie: new Date(`2026-${month}-14`),
      });
    let state = await mutate(await reports.getReportWorkspace(), {
      type: "worklist-start",
      startMonth: "2026-09",
    });
    const report = state.reports.find((row) => row.kind === "tourist")!;
    const others = state.reports.filter((row) => row.id !== report.id);
    state = await mutate(state, {
      type: "save",
      definition: { ...report, worklistStartMonth: "2026-07" },
    });
    state = await reports.getReportWorkspace();
    assert.equal(state.worklistStartMonth, "2026-09");
    assert.deepEqual(
      state.reports.filter((row) => row.id !== report.id),
      others,
    );
    const pending = buildReportWorklist(
      state,
      new Date("2026-10-31T12:00:00Z"),
    );
    assert.deepEqual(
      pending
        .filter((item) => item.month < "2026-09")
        .map((item) => [item.report.id, item.month]),
      [
        [report.id, "2026-07"],
        [report.id, "2026-08"],
      ],
    );
    const audit = await db.default.auditLog.findFirst({
      where: { action: "report.save", resource_id: report.id },
    });
    assert.equal(
      JSON.parse(audit!.metadata_json).command.definition.worklistStartMonth,
      "2026-07",
    );
    await assert.rejects(
      mutate(state, {
        type: "save",
        definition: { ...report, worklistStartMonth: "2026-13" },
      }),
    );
    state = await mutate(
      state,
      { type: "ready", reportId: report.id },
      "2026-07",
    );
    state = await mutate(
      state,
      { type: "confirm", reportId: report.id },
      "2026-07",
    );
    assert.deepEqual(
      buildReportWorklist(state, new Date("2026-10-31T12:00:00Z"))
        .filter((item) => item.month < "2026-09")
        .map((item) => item.month),
      ["2026-08"],
    );
  }));

test("Réservations lit des résumés persistés, sans calcul initial ni recalcul après une modification", () =>
  fixture(async ({ gite }) => {
    const now = new Date("2026-11-05T12:00:00Z");
    const reservation = await stay(gite);
    await pay(reservation.id, 25);
    assert.deepEqual(await reportCache.getStoredReportReminders(2026, now), {
      reminders: [],
      stale: true,
      calculatedAt: null,
    });
    assert.equal(
      (await db.default.financeReportCache.findFirst())?.workspace_json,
      null,
    );
    const first = await reports.getReportWorkspace({ now });
    const stored = await reportCache.getStoredReportReminders(2026, now);
    assert.equal(stored.stale, false);
    assert.equal(
      stored.reminders.find((row) => row.kind === "social")?.total,
      2500,
    );
    assert.equal(
      stored.reminders.find((row) => row.kind === "social")?.canCopy,
      true,
    );
    const cached = await reports.getReportWorkspace({
      now: new Date("2026-11-05T16:59:59Z"),
    });
    assert.equal(cached.calculatedAt, first.calculatedAt);
    await pay(reservation.id, 15);
    const stale = await reportCache.getStoredReportReminders(2026, now);
    assert.equal(stale.stale, true);
    assert.equal(stale.calculatedAt, stored.calculatedAt);
    assert.equal(
      stale.reminders.find((row) => row.kind === "social")?.total,
      2500,
    );
    assert.ok(stale.reminders.every((row) => !row.canCopy));
    const fresh = await reports.getReportWorkspace({ now });
    assert.equal(result(fresh).total, 4000);
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      false,
    );
    const forced = await reports.getReportWorkspace({
      force: true,
      now: new Date("2026-11-07T12:00:00Z"),
    });
    assert.equal(forced.calculatedAt, "2026-11-07T12:00:00.000Z");
    const [, simultaneousForce] = await Promise.all([
      reports.getReportWorkspace({ now }),
      reports.getReportWorkspace({
        force: true,
        now: new Date("2026-11-08T12:00:00Z"),
      }),
    ]);
    assert.equal(simultaneousForce.calculatedAt, "2026-11-08T12:00:00.000Z");
  }));

test("les rapports recalculent les versements de plateforme au passage de 18 h sans modification des données", () =>
  fixture(async ({ gite }) => {
    await stay(gite, {
      booking_source: "Airbnb",
      date_entree: new Date("2026-12-11"),
      date_sortie: new Date("2026-12-13"),
    });
    const beforeTime = new Date("2026-12-11T16:59:59.999Z");
    const before = await reports.getReportWorkspace({ now: beforeTime });
    assert.equal(result(before, "2026-12").total, 0);
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, beforeTime)).stale,
      false,
    );
    const afterTime = new Date("2026-12-11T17:00:00Z");
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, afterTime)).stale,
      true,
    );
    const after = await reports.getReportWorkspace({ now: afterTime });
    assert.equal(result(after, "2026-12").total, 10000);
    assert.equal(after.calculatedAt, afterTime.toISOString());
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, afterTime)).stale,
      false,
    );
    const nextMorning = await reports.getReportWorkspace({
      now: new Date("2026-12-12T08:00:00Z"),
    });
    assert.equal(nextMorning.calculatedAt, after.calculatedAt);
  }));

test("un échec de calcul conserve le dernier résumé et la tentative suivante peut reprendre", () =>
  fixture(async ({ gite }) => {
    const now = new Date("2026-11-05T12:00:00Z");
    const reservation = await stay(gite);
    await pay(reservation.id, 25);
    await reports.getReportWorkspace({ now });
    const before = await reportCache.getStoredReportReminders(2026, now);
    await db.default.organizationRuntimeSetting.create({
      data: { key: "reservation-payments", value_json: "{}" },
    });
    await assert.rejects(reports.getReportWorkspace({ now }));
    const after = await reportCache.getStoredReportReminders(2026, now);
    assert.equal(after.stale, true);
    assert.equal(after.calculatedAt, before.calculatedAt);
    assert.equal(
      after.reminders.find((row) => row.kind === "social")?.total,
      2500,
    );
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: true,
    });
    await reports.getReportWorkspace({ now });
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      false,
    );
  }));

test("l’invalidation couvre les suppressions et respecte les transactions, sans réagir à l’énergie ni au ménage", () =>
  fixture(async ({ gite }) => {
    const now = new Date("2026-11-05T12:00:00Z");
    const reservation = await stay(gite);
    await pay(reservation.id, 25);
    await reports.getReportWorkspace({ now });
    const before = await db.default.financeReportCache.findFirstOrThrow();
    await db.default.reservation.update({
      where: { id: reservation.id },
      data: {
        energy_consumption_kwh: 8,
        energy_cost_eur: 2,
        arrival_cleaning_checked_at: new Date(),
      },
    });
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      false,
    );
    await assert.rejects(
      db.default.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { prix_total: 250 },
        });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal(
      (await db.default.financeReportCache.findFirstOrThrow()).source_revision,
      before.source_revision,
    );
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      false,
    );
    await db.default
      .$executeRaw`UPDATE reservations SET hote_nom = ${"Nom importé"} WHERE id = ${reservation.id}`;
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      true,
    );
    await reports.getReportWorkspace({ now });
    const payment =
      await db.default.reservationRecordedPayment.findFirstOrThrow({
        where: { reservation_id: reservation.id },
      });
    await db.default.reservationRecordedPayment.delete({
      where: { id: payment.id },
    });
    const stale = await reportCache.getStoredReportReminders(2026, now);
    assert.equal(stale.stale, true);
    assert.equal(
      stale.reminders.find((row) => row.kind === "social")?.total,
      2500,
    );
    assert.equal(result(await reports.getReportWorkspace({ now })).total, 0);
  }));

test("les sources fiscales, les règles et les réglages de paiement invalident le cache de leur seul compte", () =>
  fixture(async ({ org, gite, entity }) => {
    const now = new Date("2026-11-05T12:00:00Z");
    await stay(gite);
    await reports.getReportWorkspace({ now });
    await db.default.organizationRuntimeSetting.create({
      data: { key: "unrelated", value_json: "{}" },
    });
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      false,
    );
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: false,
    });
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      true,
    );
    await reports.getReportWorkspace({ now });
    await db.default.fiscalEntity.update({
      where: { id: entity },
      data: { vat_regime: "unknown" },
    });
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, now)).stale,
      true,
    );
    await reports.getReportWorkspace({ now });
    await fixture(async ({ gite: otherGite }) => {
      await stay(otherGite);
      assert.equal(
        (await reportCache.getStoredReportReminders(2026, now)).calculatedAt,
        null,
      );
      await reports.getReportWorkspace({ now });
      await db.default.gite.update({
        where: { id: otherGite },
        data: { nom: "Autre nom" },
      });
      assert.equal(
        (await reportCache.getStoredReportReminders(2026, now)).stale,
        true,
      );
      const original = await inOrg(org, () =>
        reportCache.getStoredReportReminders(2026, now),
      );
      assert.equal(original.stale, false);
      assert.ok(
        original.reminders.every((row) => !row.propertyIds.includes(otherGite)),
      );
    });
  }));

test("le calcul mensuel rattrape une clôture à l’heure de Paris et attend le mois suivant pour les modifications", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite);
    await pay(reservation.id, 25);
    const before = new Date("2026-10-31T22:59:59Z");
    const after = new Date("2026-10-31T23:00:01Z");
    assert.deepEqual(
      await reportAutomation.runMonthlyReportCalculation(before),
      { calculated: true },
    );
    await pay(reservation.id, 15);
    assert.deepEqual(
      await reportAutomation.runMonthlyReportCalculation(before),
      { calculated: false },
    );
    assert.equal(
      (await reportCache.getStoredReportReminders(2026, before)).stale,
      true,
    );
    assert.deepEqual(
      await reportAutomation.runMonthlyReportCalculation(after),
      { calculated: true },
    );
    const summary = await reportCache.getStoredReportReminders(2026, after);
    assert.equal(summary.stale, false);
    assert.equal(
      summary.reminders.find((row) => row.kind === "social")?.total,
      4000,
    );
    assert.equal(
      summary.reminders.find((row) => row.kind === "tourist")?.total,
      4,
    );
    assert.deepEqual(
      await reportAutomation.runMonthlyReportCalculation(after),
      { calculated: false },
    );
    assert.equal(await db.default.financeReportStore.count(), 1);
  }));

test("le rattrapage mensuel prépare aussi les trimestres et années clôturés sans confirmer une transmission", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite);
    await pay(reservation.id, 25);
    let state = await reports.getReportWorkspace();
    state = await mutate(state, {
      type: "save",
      definition: { ...social(state), cadence: "yearly" },
    });
    const tourist = state.reports.find((row) => row.kind === "tourist")!;
    state = await mutate(state, {
      type: "save",
      definition: { ...tourist, cadence: "quarterly" },
    });
    const configuration = (
      await db.default.financeReportStore.findFirstOrThrow()
    ).data_json;
    const now = new Date("2027-01-01T00:01:00Z");
    await reportAutomation.runMonthlyReportCalculation(now);
    const reminders = await reportCache.getStoredReportReminders(2027, now);
    assert.equal(reminders.stale, false);
    assert.equal(
      reminders.reminders.find((row) => row.kind === "social")?.total,
      2500,
    );
    assert.equal(
      reminders.reminders.find((row) => row.kind === "tourist")?.total,
      8,
    );
    assert.equal(
      (await db.default.financeReportStore.findFirstOrThrow()).data_json,
      configuration,
    );
  }));

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

test("les chargements simultanés partagent le calcul uniquement dans le même compte et les relectures restent fraîches", () =>
  fixture(async ({ org, gite }) => {
    const reservation = await stay(gite);
    await pay(reservation.id, 25);
    const [first, simultaneous] = await Promise.all([
      reports.getReportWorkspace(),
      reports.getReportWorkspace(),
    ]);
    assert.strictEqual(first, simultaneous);
    assert.equal(result(first).total, 2500);
    await pay(reservation.id, 15);
    const refreshed = await reports.getReportWorkspace();
    assert.notStrictEqual(refreshed, first);
    assert.equal(result(refreshed).total, 4000);
    await fixture(async ({ org: otherOrg, gite: otherGite }) => {
      const otherReservation = await stay(otherGite);
      await pay(otherReservation.id, 10);
      const [a, b] = await Promise.all([
        inOrg(org, () => reports.getReportWorkspace()),
        inOrg(otherOrg, () => reports.getReportWorkspace()),
      ]);
      assert.notStrictEqual(a, b);
      assert.equal(a.organizationId, org);
      assert.equal(b.organizationId, otherOrg);
      assert.equal(result(a).total, 4000);
      assert.equal(result(b).total, 1000);
      assert.ok(a.properties.every((row) => row.id !== otherGite));
      assert.ok(b.properties.every((row) => row.id !== gite));
    });
  }));
test("les nuitées sont réparties entre les mois et ne sont pas multipliées par les paiements", () =>
  fixture(async ({ gite }) => {
    const r = await stay(gite);
    await pay(r.id, 10);
    await pay(r.id, 20);
    const state = await reports.getReportWorkspace();
    const report = state.reports.find((row) => row.kind === "tourist")!;
    assert.equal(result(state, "2026-10", report).total, 4);
    assert.equal(result(state, "2026-11", report).total, 4);
    assert.equal(
      result(state, "2026-12", { ...report, cadence: "quarterly" }).total,
      8,
    );
  }));
test("les filtres de gestionnaire et de source sont persistés pour chaque modèle et les copies restent figées", () =>
  fixture(async ({ gite, entity }) => {
    await paymentSettings.saveReservationPaymentSettings({
      platform_payments_received_automatically: false,
    });
    const manager = await db.default.gestionnaire.create({
      data: { prenom: "Camille", nom: "Martin" },
    });
    const otherManager = await db.default.gestionnaire.create({
      data: { prenom: "Alex", nom: "Durand" },
    });
    await db.default.gite.update({
      where: { id: gite },
      data: { gestionnaire_id: manager.id },
    });
    const original = await db.default.gite.findUniqueOrThrow({
      where: { id: gite },
    });
    const second = await db.default.gite.create({
      data: {
        nom: "Autre logement",
        prefixe_contrat: "S",
        adresse_ligne1: "Test",
        capacite_max: 10,
        proprietaires_noms: "Test",
        proprietaires_adresse: "Test",
        telephones: "",
        taxe_sejour_par_personne_par_nuit: 0,
        iban: "",
        titulaire: "Test",
        fiscal_establishment_id: original.fiscal_establishment_id,
        gestionnaire_id: otherManager.id,
      },
    });
    const direct = await stay(gite);
    const airbnb = await stay(gite, { booking_source: "Airbnb" });
    const outside = await stay(second.id);
    await pay(direct.id, 100);
    await pay(airbnb.id, 100);
    await pay(outside.id, 100);
    let state = await reports.getReportWorkspace();
    assert.equal(
      state.properties.find((row) => row.id === gite)?.managerId,
      manager.id,
    );
    assert.equal(state.propertyOperators[gite], entity);
    assert.equal(state.propertyManagers?.[gite], manager.id);
    assert.ok(
      state.managers?.some(
        (row) => row.id === manager.id && row.name === "Camille Martin",
      ),
    );
    for (const kind of ["social", "tourist", "owner", "custom"] as const) {
      const definition = {
        ...createReport(kind, `filtered-${kind}`),
        recipient: "Camille Martin",
        operatorId: kind === "social" ? entity : null,
        managerId: manager.id,
        propertyIds: [gite],
        categories: ["accommodation" as const],
        bookingSources: ["Direct"],
      };
      state = await mutate(state, { type: "save", definition });
      const total = kind === "tourist" ? 4 : 10000;
      assert.equal(result(state, "2026-10", definition).total, total);
      assert.equal(result(state, "2026-10", definition).reviewCount, 0);
      state = await mutate(state, { type: "ready", reportId: definition.id });
      state = await mutate(state, { type: "confirm", reportId: definition.id });
      const key = reportPeriodKey(definition, "2026-10");
      assert.equal(state.progress[key].snapshot?.result.total, total);
      state = await mutate(state, {
        type: "save",
        definition: { ...definition, bookingSources: ["Direct", "Airbnb"] },
      });
      const reloaded = await reports.getReportWorkspace();
      const saved = reloaded.reports.find((row) => row.id === definition.id)!;
      assert.deepEqual(saved.bookingSources, ["Direct", "Airbnb"]);
      assert.equal(saved.managerId, manager.id);
      assert.equal(result(reloaded, "2026-10", saved).total, total * 2);
      assert.deepEqual(
        reloaded.progress[key].snapshot?.definition.bookingSources,
        ["Direct"],
      );
      assert.equal(reloaded.progress[key].snapshot?.result.total, total);
      await assert.rejects(
        mutate(state, {
          type: "save",
          definition: { ...definition, propertyIds: [second.id] },
        }),
        /gestionnaire choisi/,
      );
      await assert.rejects(
        mutate(state, {
          type: "save",
          definition: { ...definition, managerId: "foreign-manager" },
        }),
        /Gestionnaire introuvable/,
      );
    }
    const report = state.reports.find((row) => row.id === "filtered-tourist")!;
    await db.default.gite.update({
      where: { id: gite },
      data: { gestionnaire_id: otherManager.id },
    });
    state = await reports.getReportWorkspace();
    assert.equal(result(state, "2026-11", report).reviewCount, 2);
    await assert.rejects(
      mutate(state, { type: "ready", reportId: report.id }, "2026-11"),
      /rattachement au gestionnaire/,
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
test("les versements OTA arrivés sont inclus à J+1, y compris les changements de mois ou d’année", () =>
  fixture(async ({ gite }) => {
    const cases = [
      ["Airbnb", "2026-10-30", "2026-10-31"],
      ["Abritel", "2026-10-31", "2026-11-01"],
      ["Gites de France", "2026-12-31", "2027-01-01"],
      ["Booking.com", "2028-02-28", "2028-02-29"],
    ];
    const ids: string[] = [];
    for (const [source, arrival] of cases) {
      const departure = new Date(arrival);
      departure.setUTCDate(departure.getUTCDate() + 4);
      const reservation = await stay(gite, {
        booking_source: source,
        source_paiement: source,
        date_entree: new Date(arrival),
        date_sortie: departure,
      });
      ids.push(reservation.id);
    }
    const state = await reports.getReportWorkspace({
      now: new Date("2028-03-01T12:00:00Z"),
    });
    for (const [index, [, , date]] of cases.entries()) {
      const period = result(state, date.slice(0, 7));
      const payment = period.rows.find(
        (row) => row.reservationId === ids[index],
      )!;
      assert.equal(payment.effectiveDate, date);
      assert.equal(payment.paymentDateEstimated, true);
      assert.equal(payment.status, "included");
      assert.equal(period.total, 10000);
      assert.equal(period.reviewCount, 0);
    }
    assert.equal(result(state, "2026-12").total, 0);
    assert.equal(await db.default.reservationRecordedPayment.count(), 0);
    await db.default.reservation.update({
      where: { id: ids[0] },
      data: { date_entree: new Date("2026-10-31") },
    });
    const changed = await reports.getReportWorkspace({
      now: new Date("2028-03-01T12:00:00Z"),
    });
    assert.equal(result(changed).total, 0);
    assert.equal(result(changed, "2026-11").total, 20000);
  }));
test("les anciens versements OTA non datés gardent leur estimation après la saisie d’un complément", () =>
  fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      booking_source: "Airbnb",
      frais_optionnels_montant: 20,
      payments_managed: true,
    });
    const payment = await db.default.reservationRecordedPayment.create({
      data: {
        reservation_id: reservation.id,
        amount_cents: 10000,
        method: "Versement plateforme",
        purpose: "full",
        origin: "legacy",
      },
    });
    await pay(reservation.id, 20, { method: "Espèces", purpose: "extras" });
    const state = await reports.getReportWorkspace();
    const row = result(state).rows.find((row) => row.id.includes(payment.id))!;
    assert.equal(row.effectiveDate, "2026-10-31");
    assert.equal(row.paymentDateEstimated, true);
    assert.equal(result(state).total, 12000);
    assert.equal(result(state).reviewCount, 0);
    assert.equal(
      (
        await db.default.reservationRecordedPayment.findUniqueOrThrow({
          where: { id: payment.id },
        })
      ).paid_on,
      null,
    );
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
    assert.equal(await db.default.financeReportStore.count(), 1);
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

for (const outcome of ["corrected", "kept"] as const) {
  test(`résolution ${outcome} : copie d’origine conservée, retrait de la file et des rappels, historique cumulatif`, () =>
    fixture(async ({ gite }) => {
      const reservation = await stay(gite);
      await pay(reservation.id, 25);
      let state = await reports.getReportWorkspace();
      const reportId = social(state).id;
      const key = reportPeriodKey(social(state), "2026-10");
      const resolve: ReportCommand = {
        type: "resolve",
        reportId,
        outcome,
        note: "Correction vérifiée auprès du destinataire",
      };
      await assert.rejects(mutate(state, resolve), /Aucun écart/);
      state = await mutate(state, { type: "ready", reportId });
      state = await mutate(state, { type: "confirm", reportId });
      const original = structuredClone(state.progress[key].snapshot);
      await assert.rejects(mutate(state, resolve), /Aucun écart/);
      await pay(reservation.id, 15);
      // Source concurrency is checked even when the client did not refresh.
      await assert.rejects(mutate(state, resolve), /données ont changé/);
      state = await reports.getReportWorkspace();
      const now = new Date("2026-11-05T12:00:00Z");
      assert.ok(
        buildReportWorklist(state, now).some((item) => item.key === key),
      );
      state = await mutate(state, resolve);
      assert.deepEqual(state.progress[key].snapshot, original);
      const resolution = state.progress[key].resolutions![0];
      assert.equal(resolution.outcome, outcome);
      assert.equal(resolution.note, resolve.note);
      assert.equal(resolution.resolvedBy, "test-user");
      assert.equal(resolution.result.total, 4000);
      assert.ok(resolution.resolvedAt);
      assert.equal(
        buildReportWorklist(state, now).some((item) => item.key === key),
        false,
      );
      assert.equal(
        buildReportReminders(state, 2026, now).some((item) => item.id === key),
        false,
      );
      assert.equal(
        (await reportCache.getStoredReportReminders(2026)).reminders.some(
          (item) => item.id === key,
        ),
        false,
      );
      state = await reports.getReportWorkspace({ force: true });
      assert.deepEqual(state.progress[key].resolutions![0], resolution);
      await assert.rejects(mutate(state, resolve), /Aucun écart/);
      await assert.rejects(
        mutate(state, { type: "confirm", reportId }),
        /copie confirmée existe/,
      );
      await pay(reservation.id, 5);
      state = await reports.getReportWorkspace();
      assert.equal(
        buildReportWorklist(state, now).find((item) => item.key === key)
          ?.status,
        "Écart à examiner",
      );
      assert.equal(
        (await reportCache.getStoredReportReminders(2026)).reminders.find(
          (item) => item.id === key,
        )?.status,
        "changed",
      );
      state = await mutate(state, resolve);
      assert.equal(state.progress[key].resolutions!.length, 2);
      assert.deepEqual(state.progress[key].resolutions![0], resolution);
      assert.equal(state.progress[key].resolutions![1].result.total, 4500);
      assert.deepEqual(state.progress[key].snapshot, original);
      assert.equal(
        await db.default.auditLog.count({
          where: { action: "report.resolve", resource_id: reportId },
        }),
        2,
      );
      await fixture(async () => {
        const other = await reports.getReportWorkspace();
        await assert.rejects(mutate(other, resolve), /introuvable/);
        assert.equal(
          await db.default.auditLog.count({
            where: { action: "report.resolve" },
          }),
          0,
        );
      });
    }));
}

test("la résolution refuse les motifs vides, les chiffres fournis par le navigateur et les opérations à vérifier", () =>
  fixture(async ({ gite, entity }) => {
    const reservation = await stay(gite);
    await pay(reservation.id, 25);
    let state = await reports.getReportWorkspace();
    const reportId = social(state).id;
    state = await mutate(state, { type: "ready", reportId });
    state = await mutate(state, { type: "confirm", reportId });
    await pay(reservation.id, 15);
    state = await reports.getReportWorkspace();
    const command = {
      type: "resolve",
      reportId,
      outcome: "kept",
      note: "   ",
    } as const;
    await assert.rejects(mutate(state, command));
    await assert.rejects(
      mutate(state, {
        ...command,
        note: "Justification",
        result: { total: 0 },
      } as never),
    );
    await db.default.fiscalEntity.update({
      where: { id: entity },
      data: { vat_regime: "unknown" },
    });
    state = await reports.getReportWorkspace();
    await assert.rejects(
      mutate(state, { ...command, note: "Justification" }),
      /Vérifiez les opérations/,
    );
    assert.equal(
      state.progress[reportPeriodKey(social(state), "2026-10")].resolutions,
      undefined,
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
    assert.ok(result(state).rows.every((row) => !row.paymentDateEstimated));
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
    const platformOperation = state.operations.find(
      (operation) => operation.ota,
    )!;
    assert.equal(platformOperation.channel, "Airbnb");
    assert.equal(platformOperation.bookingSource, "Direct");
    assert.equal(
      result(state, "2026-10", { ...social(state), bookingSources: ["Direct"] })
        .total,
      5000,
    );
    assert.equal(
      result(state, "2026-10", { ...social(state), bookingSources: ["Airbnb"] })
        .total,
      0,
    );
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

test("les macarons partagent le calcul et les filtres du rapport sans charger l’espace financier", () =>
  fixture(async ({ gite }) => {
    await stay(gite, {
      nb_enfants_2_17: 3,
      options: JSON.stringify({
        tourist_tax: {
          settings: {
            classified: true,
            stars: 2,
            included: false,
            fixed_rate: 0,
            percentage: 0,
            cap: 0,
            additional_percentage: 0,
            accommodation_vat_rate: 0,
            authority: "Test",
            effective_from: "2026-01-01",
          },
          collector: "host",
          platform: "",
          infants: 1,
          exempt_adults: 0,
          exemption_reason: "",
        },
      }),
    });
    const summary = await nightSummaries.getNightSummaries(2026);
    const october = summary.properties.find((row) => row.id === gite)!
      .months[9];
    assert.deepEqual(october, {
      month: 10,
      total: 4,
      included: 4,
      reviewCount: 0,
    });
    assert.equal(
      (await db.default.financeReportCache.findFirst())?.workspace_json,
      null,
    );
    assert.deepEqual(await nightSummaries.getNightSummaries(2026), summary);
    let state = await reports.getReportWorkspace();
    const report = state.reports.find((row) => row.kind === "tourist")!;
    assert.equal(result(state, "2026-10", report).total, october.included);
    state = await mutate(state, { type: "ready", reportId: report.id });
    state = await mutate(state, { type: "confirm", reportId: report.id });
    const confirmed = structuredClone(
      state.progress[reportPeriodKey(report, "2026-10")].snapshot,
    );
    state = await mutate(state, {
      type: "save",
      definition: { ...report, nightGuests: ["adults", "children", "infants"] },
    });
    const updated = await nightSummaries.getNightSummaries(2026);
    assert.equal(updated.properties[0].months[9].included, 12);
    assert.equal(
      result(
        state,
        "2026-10",
        state.reports.find((row) => row.id === report.id)!,
      ).total,
      12,
    );
    assert.deepEqual(
      state.progress[reportPeriodKey(report, "2026-10")].snapshot,
      confirmed,
    );
    assert.equal(
      (await nightSummaries.getNightSummaries(2027)).properties[0].months[9]
        .total,
      0,
    );
    await db.default.reservation.updateMany({ data: { nb_adultes: 4 } });
    assert.equal(
      (await nightSummaries.getNightSummaries(2026)).properties[0].months[9]
        .included,
      16,
    );
  }));

test("le rapport de référence est unique et les nuitées sont isolées par organisation", () =>
  fixture(async ({ gite }) => {
    await stay(gite);
    let state = await reports.getReportWorkspace();
    state = await mutate(state, {
      type: "save",
      definition: {
        ...createReport("tourist", "reference-new"),
        recipient: "Nouveau",
        propertyIds: [gite],
        nightReference: true,
      },
    });
    assert.equal(state.reports.filter((row) => row.nightReference).length, 1);
    assert.equal(
      (await nightSummaries.getNightSummaries(2026)).report?.id,
      "reference-new",
    );
    await fixture(async ({ gite: other }) => {
      await stay(other, { nb_adultes: 5 });
      const summary = await nightSummaries.getNightSummaries(2026);
      assert.equal(
        summary.properties.some((row) => row.id === gite),
        false,
      );
      assert.equal(summary.properties[0].months[9].total, 10);
    });
  }));

test("la mise à niveau des anciens rapports conserve la copie confirmée et choisit les adultes", () =>
  fixture(async ({ gite }) => {
    const definition = {
      ...createReport("tourist", "old-night"),
      recipient: "Historique",
      propertyIds: [gite],
      nightGuests: undefined,
    };
    const snapshot = {
      confirmedAt: "2026-10-01T12:00:00.000Z",
      definition,
      result: {
        rows: [],
        total: 42,
        includedCount: 0,
        excludedCount: 0,
        reviewCount: 0,
      },
    };
    await db.default.financeReportStore.create({
      data: {
        organization_id: context.getOrganizationId(),
        data_json: JSON.stringify({
          reports: [definition],
          overrides: {},
          progress: { historical: { snapshot } },
        }),
      },
    });
    const state = await reports.getReportWorkspace();
    assert.deepEqual(state.reports[0].nightGuests, ["adults"]);
    assert.equal(state.reports[0].nightReference, true);
    assert.equal(state.progress.historical.snapshot?.result.total, 42);
    assert.equal(
      state.progress.historical.snapshot?.definition.nightGuests,
      undefined,
    );
  }));

test("les anciennes exclusions sont reprises sans confondre une plateforme avec un moyen de paiement", async () => {
  const { upgradeNightConfiguration } =
    await import("../src/modules/finance/reports/configuration.js");
  const config = {
    reports: [
      {
        ...createReport("tourist", "guest-nights"),
        bookingSources: undefined,
        nightGuests: undefined,
      },
      { ...createReport("tourist", "personal"), bookingSources: ["Airbnb"] },
    ],
    overrides: {},
    progress: {},
  };
  upgradeNightConfiguration(config, ["airbnb", "Gîtes de France", "Espèces"]);
  assert.deepEqual(config.reports[0].excludedBookingSources, [
    "Airbnb",
    "Gites de France",
  ]);
  assert.deepEqual(config.reports[1].bookingSources, ["Airbnb"]);
  assert.deepEqual(
    (config as { nightSettingsWarnings?: string[] }).nightSettingsWarnings,
    ["Espèces"],
  );
  const upgraded = JSON.stringify(config);
  upgradeNightConfiguration(config, ["Direct"]);
  assert.equal(JSON.stringify(config), upgraded);
});

const registerTax = {
  settings: {
    version: 1,
    classified: true,
    stars: 2,
    included: false,
    fixed_rate: 1,
    percentage: 5,
    cap: 4,
    additional_percentage: 0,
    accommodation_vat_rate: 0,
    authority: "Collectivité de test",
    effective_from: "2026-01-01",
  },
  collector: "host",
  platform: "",
  infants: 0,
  exempt_adults: 0,
  exemption_reason: "",
};
test("un règlement global confirme sa taxe sans doubler l’encaissement ni réduire les recettes de l’acompte", async () => {
  await fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      date_entree: new Date("2026-09-10"),
      date_sortie: new Date("2026-09-12"),
      nb_nuits: 2,
      prix_par_nuit: 50,
      prix_total: 100,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await pay(reservation.id, 20, {
      purpose: "deposit",
      paid_on: "2026-09-01",
    });
    let tracking = await ledger.getReservationPaymentTracking(reservation.id);
    const paymentId = randomUUID();
    tracking = await ledger.addReservationPayment(reservation.id, {
      id: paymentId,
      amount: 84,
      method: "Virement",
      purpose: "balance",
      paid_on: "2026-09-12",
      tourist_tax: {
        amount_cents: 400,
        source_revision: tracking.tourist_tax!.sourceRevision,
      },
    });
    assert.equal(tracking.entries.length, 2);
    assert.equal(tracking.received, 104);
    assert.equal(tracking.remaining, 0);
    let state = await reports.getReportWorkspace();
    assert.equal(result(state, "2026-09").total, 10000);
    const receipts = state.operations.filter((row) => row.basis === "payment");
    assert.equal(
      receipts.find(
        (row) => row.id.includes(paymentId) && row.category === "tourist_tax",
      )!.amountCents,
      400,
    );
    assert.equal(
      receipts
        .filter((row) => row.category === "accommodation")
        .reduce((total, row) => total + row.amountCents, 0),
      10000,
    );
    const definition = {
      ...createReport("tourist", "payment-tax-register"),
      propertyIds: [gite],
      nightDeclaration: true,
      nightRegistrations: { [gite]: { number: "", notApplicable: true } },
    };
    state = await mutate(state, { type: "save", definition }, "2026-09");
    let register = await nightRegister.getNightRegister(
      definition.id,
      "2026-09",
    );
    assert.equal(register.incompleteCount, 0);
    assert.equal(register.rows.length, 1);
    assert.equal(register.rows[0].collectedTaxCents, 400);
    assert.equal(register.rows[0].observedCollectionCents, 400);
    assert.equal(register.rows[0].collectionDate, "2026-09-12");
    state = await mutate(
      state,
      { type: "ready", reportId: definition.id },
      "2026-09",
    );
    state = await mutate(
      state,
      { type: "confirm", reportId: definition.id },
      "2026-09",
    );
    const frozen =
      state.progress[reportPeriodKey(definition, "2026-09")].snapshot!
        .nightRegister!;
    await ledger.updateReservationPaymentDate(reservation.id, paymentId, {
      paid_on: "2026-09-13",
      expected_paid_on: tracking.entries.find(
        (entry) => entry.id === paymentId,
      )!.paid_on,
    });
    register = await nightRegister.getNightRegister(definition.id, "2026-09");
    assert.equal(register.rows[0].collectionDate, "2026-09-13");
    assert.equal(frozen.rows[0].collectionDate, "2026-09-12");
    const before = await prismaCacheRevision();
    tracking = await ledger.getReservationPaymentTracking(reservation.id);
    await ledger.updateReservationPaymentTouristTax(reservation.id, paymentId, {
      tourist_tax: null,
      expected_revision: tracking.entries.find(
        (entry) => entry.id === paymentId,
      )!.tourist_tax_revision!,
    });
    assert.ok((await prismaCacheRevision()) > before);
    assert.ok(
      (await nightRegister.getNightRegister(definition.id, "2026-09"))
        .incompleteCount > 0,
    );
    async function prismaCacheRevision() {
      return (await db.default.financeReportCache.findFirstOrThrow())
        .source_revision;
    }
  });
});

test("ventilation proposée : perception confirmée répartie entre années, taux additionnel et copie figée", async () => {
  await fixture(async ({ gite }) => {
    const tax = {
      ...registerTax,
      settings: {
        ...registerTax.settings,
        fixed_rate: 0.33,
        additional_percentage: 10,
      },
    };
    const reservation = await stay(gite, {
      date_entree: new Date("2026-12-31"),
      date_sortie: new Date("2027-01-02"),
      nb_nuits: 2,
      options: JSON.stringify({ tourist_tax: tax }),
    });
    let tracking = await ledger.getReservationPaymentTracking(reservation.id);
    await pay(reservation.id, 101.44, {
      paid_on: "2026-12-30",
      tourist_tax: {
        amount_cents: 144,
        source_revision: tracking.tourist_tax!.sourceRevision,
      },
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "allocation-years"),
      propertyIds: [gite],
      nightDeclaration: true,
      nightRegistrations: { [gite]: { number: "", notApplicable: true } },
    };
    state = await mutate(state, { type: "save", definition }, "2026-12");
    for (const month of ["2026-12", "2027-01"]) {
      let register = await nightRegister.getNightRegister(definition.id, month);
      const row = register.rows[0],
        proposal = row.allocationProposal!;
      assert.equal(
        row.collectedTaxCents,
        null,
        "La proposition n’est pas une ventilation confirmée",
      );
      assert.equal(proposal.collectedTaxCents, 72);
      assert.equal(proposal.collectedBaseTaxCents, 66);
      assert.match(proposal.additionalTaxes, /0,06/);
      assert.equal(proposal.collectionDate, "2026-12-30");
      state = await mutate(
        state,
        {
          type: "night-register-completion",
          reportId: definition.id,
          completion: allocationCompletion(register),
        },
        month,
      );
      register = await nightRegister.getNightRegister(definition.id, month);
      assert.equal(register.incompleteCount, 0);
      assert.equal(register.summary[0].hostCollectedCents, 72);
      assert.equal(register.summary[0].baseCollectedCents, 66);
      assert.equal(register.summary[0].additionalCollectedCents, 6);
      state = await mutate(
        state,
        { type: "ready", reportId: definition.id },
        month,
      );
      state = await mutate(
        state,
        { type: "confirm", reportId: definition.id },
        month,
      );
    }
    const frozen = await nightRegister.getNightRegister(
      definition.id,
      "2026-12",
      {},
    );
    tracking = await ledger.getReservationPaymentTracking(reservation.id);
    await ledger.voidReservationPayment(reservation.id, tracking.entries[0].id);
    assert.equal(
      (await nightRegister.getNightRegister(definition.id, "2026-12")).rows[0]
        .allocationProposal,
      undefined,
    );
    assert.deepEqual(
      await nightRegister.getNightRegister(definition.id, "2026-12", {}),
      frozen,
    );
  });
});

function allocationCompletion(
  register: Awaited<ReturnType<typeof nightRegister.getNightRegister>>,
  reviewed = true,
) {
  return {
    sourceRevision: register.sourceRevision,
    note: "Répartition vérifiée sur le reçu et le contrat",
    rows: Object.fromEntries(
      register.rows.map((row) => {
        const { explanation: _explanation, ...proposal } =
          row.allocationProposal!;
        return [
          row.key,
          {
            ...proposal,
            nightlyPriceCents: row.nightlyPriceCents,
            allocationReviewed: reviewed,
          },
        ];
      }),
    ),
  };
}

test("ventilation proposée : logements successifs, conservation par perception et contrôle des doublons", async () => {
  await fixture(async ({ gite }) => {
    const model = await db.default.gite.findUniqueOrThrow({
      where: { id: gite },
    });
    const { id: _id, ...copy } = model;
    const second = await db.default.gite.create({
      data: { ...copy, nom: "Deuxième gîte", prefixe_contrat: "S" },
    });
    const group = randomUUID();
    const a = await stay(gite, {
      stay_group_id: group,
      date_entree: new Date("2026-09-29"),
      date_sortie: new Date("2026-10-01"),
      nb_nuits: 2,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await stay(second.id, {
      stay_group_id: group,
      date_entree: new Date("2026-10-01"),
      date_sortie: new Date("2026-10-04"),
      nb_nuits: 3,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    const tracking = await ledger.getReservationPaymentTracking(a.id);
    assert.equal(tracking.tourist_tax!.available, true);
    await pay(a.id, 210, {
      paid_on: "2026-10-04",
      tourist_tax: {
        amount_cents: 1000,
        source_revision: tracking.tourist_tax!.sourceRevision,
      },
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "allocation-group"),
      propertyIds: [gite, second.id],
      cadence: "yearly" as const,
      nightDeclaration: true,
      nightRegistrations: {
        [gite]: { number: "", notApplicable: true },
        [second.id]: { number: "", notApplicable: true },
      },
    };
    state = await mutate(state, { type: "save", definition });
    let register = await nightRegister.getNightRegister(
      definition.id,
      "2026-10",
    );
    assert.equal(register.rows.length, 2);
    assert.equal(new Set(register.rows.map((row) => row.key)).size, 2);
    assert.equal(new Set(register.rows.map((row) => row.collectionId)).size, 1);
    assert.deepEqual(
      register.rows.map((row) => row.allocationProposal!.collectedTaxCents),
      [400, 600],
    );
    const bad = allocationCompletion(register);
    Object.values(bad.rows).forEach((row) => {
      row.collectedTaxCents = 1000;
      row.collectedBaseTaxCents = 1000;
    });
    await assert.rejects(
      mutate(state, {
        type: "night-register-completion",
        reportId: definition.id,
        completion: bad,
      }),
      /dépasse la perception/,
    );
    state = await mutate(state, {
      type: "night-register-completion",
      reportId: definition.id,
      completion: allocationCompletion(register, false),
    });
    assert.ok(
      (await nightRegister.getNightRegister(definition.id, "2026-10"))
        .incompleteCount,
    );
    await assert.rejects(
      mutate(state, { type: "ready", reportId: definition.id }),
      /registre/,
    );
    register = await nightRegister.getNightRegister(definition.id, "2026-10");
    state = await mutate(state, {
      type: "night-register-completion",
      reportId: definition.id,
      completion: allocationCompletion(register),
    });
    assert.equal(
      (await nightRegister.getNightRegister(definition.id, "2026-10"))
        .incompleteCount,
      0,
    );
    await mutate(state, { type: "ready", reportId: definition.id });
    const filtered = {
      ...definition,
      id: "allocation-filtered",
      propertyIds: [second.id],
      nightRegistrations: { [second.id]: { number: "", notApplicable: true } },
    };
    state = await reports.getReportWorkspace();
    await mutate(state, { type: "save", definition: filtered });
    const selected = await nightRegister.getNightRegister(
      filtered.id,
      "2026-10",
    );
    assert.equal(selected.rows.length, 1);
    assert.equal(
      selected.rows[0].allocationProposal!.collectedTaxCents,
      600,
      "Le filtrage ne réaffecte pas les 400 centimes de l’autre gîte",
    );
  });
});

test("ventilation proposée : les montants déjà affectés bloquent une proposition incompatible", async () => {
  await fixture(async ({ gite }) => {
    const r = await stay(gite, {
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await pay(r.id, 8, { purpose: "tourist_tax", paid_on: "2026-10-31" });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "allocation-existing"),
      propertyIds: [gite],
    };
    state = await mutate(state, { type: "save", definition });
    const october = await nightRegister.getNightRegister(
      definition.id,
      "2026-10",
    );
    const completion = allocationCompletion(october);
    Object.values(completion.rows).forEach((row) => {
      row.collectedTaxCents = 800;
      row.collectedBaseTaxCents = 800;
    });
    await mutate(state, {
      type: "night-register-completion",
      reportId: definition.id,
      completion,
    });
    const november = await nightRegister.getNightRegister(
      definition.id,
      "2026-11",
    );
    assert.equal(november.rows[0].allocationProposal, undefined);
    assert.match(
      november.rows[0].allocationUnavailableReason!,
      /autre période/,
    );
  });
});

test("ventilation proposée : le prix variable non classé et un groupe hétérogène restent à justifier", async () => {
  await fixture(async ({ gite }) => {
    const r = await stay(gite, {
      remise_montant: 10,
      options: JSON.stringify({
        tourist_tax: {
          ...registerTax,
          settings: { ...registerTax.settings, classified: false, stars: 0 },
        },
      }),
    });
    const tracking = await ledger.getReservationPaymentTracking(r.id);
    await pay(r.id, tracking.total, {
      tourist_tax: {
        amount_cents: tracking.tourist_tax!.expectedCents,
        source_revision: tracking.tourist_tax!.sourceRevision,
      },
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "allocation-variable"),
      propertyIds: [gite],
    };
    state = await mutate(state, { type: "save", definition });
    const register = await nightRegister.getNightRegister(
      definition.id,
      "2026-10",
    );
    assert.equal(register.rows[0].allocationProposal, undefined);
    assert.match(register.rows[0].allocationUnavailableReason!, /prix exact/);
    const group = randomUUID();
    const a = await stay(gite, {
      stay_group_id: group,
      date_entree: new Date("2026-09-29"),
      date_sortie: new Date("2026-10-01"),
      nb_nuits: 2,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await stay(gite, {
      stay_group_id: group,
      date_entree: new Date("2026-10-01"),
      date_sortie: new Date("2026-10-03"),
      nb_nuits: 2,
      nb_adultes: 3,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    const grouped = await ledger.getReservationPaymentTracking(a.id);
    assert.equal(grouped.tourist_tax!.available, false);
    await assert.rejects(
      pay(a.id, 10, {
        tourist_tax: {
          amount_cents: 100,
          source_revision: grouped.tourist_tax!.sourceRevision,
        },
      }),
      /mêmes occupants/,
    );
  });
});

test("ventilation proposée : reprise d’un ancien complément sans doubler la collecte", async () => {
  await fixture(async ({ gite }) => {
    const r = await stay(gite, {
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "allocation-legacy"),
      propertyIds: [gite],
    };
    state = await mutate(state, { type: "save", definition });
    let register = await nightRegister.getNightRegister(
      definition.id,
      "2026-10",
    );
    state = await mutate(state, {
      type: "night-register-completion",
      reportId: definition.id,
      completion: {
        sourceRevision: register.sourceRevision,
        note: "Reçu de collecte saisi avant le rapprochement",
        rows: {
          [register.rows[0].key]: {
            collectionDate: "2026-10-31",
            collectedTaxCents: 400,
            collectedBaseTaxCents: 400,
            additionalTaxes: "Aucune",
            nightlyPriceCents: null,
            allocationReviewed: true,
          },
        },
      },
    });
    const oldOctober =
      state.nightRegisterCompletions![reportPeriodKey(definition, "2026-10")];
    register = await nightRegister.getNightRegister(definition.id, "2026-11");
    state = await mutate(
      state,
      {
        type: "night-register-completion",
        reportId: definition.id,
        completion: { ...oldOctober, sourceRevision: register.sourceRevision },
      },
      "2026-11",
    );
    await pay(r.id, 8, { purpose: "tourist_tax", paid_on: "2026-10-31" });
    state = await reports.getReportWorkspace();
    register = await nightRegister.getNightRegister(definition.id, "2026-11");
    assert.equal(register.rows[0].allocationProposal, undefined);
    await assert.rejects(
      mutate(
        state,
        {
          type: "night-register-completion",
          reportId: definition.id,
          completion: {
            sourceRevision: register.sourceRevision,
            note: "Répartition de novembre sur le même reçu",
            rows: {
              [register.rows[0].key]: {
                collectionDate: "2026-10-31",
                collectedTaxCents: 400,
                collectedBaseTaxCents: 400,
                additionalTaxes: "Aucune",
                nightlyPriceCents: null,
                allocationReviewed: true,
              },
            },
          },
        },
        "2026-11",
      ),
      /ancienne ventilation/,
    );
    state = await mutate(
      state,
      {
        type: "night-register-completion",
        reportId: definition.id,
        completion: {
          sourceRevision: register.sourceRevision,
          note: "Retrait de l’ancienne affectation avant rapprochement",
          rows: {},
        },
      },
      "2026-11",
    );
    register = await nightRegister.getNightRegister(definition.id, "2026-10");
    state = await mutate(state, {
      type: "night-register-completion",
      reportId: definition.id,
      completion: allocationCompletion(register),
    });
    register = await nightRegister.getNightRegister(definition.id, "2026-11");
    assert.equal(register.rows[0].allocationProposal!.collectedTaxCents, 400);
    await mutate(
      state,
      {
        type: "night-register-completion",
        reportId: definition.id,
        completion: allocationCompletion(register),
      },
      "2026-11",
    );
  });
});

test("déclaration : contrôles de complétude, compléments justifiés, copie figée et revalidation des sources", async () => {
  await fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      date_entree: new Date("2026-09-10"),
      date_sortie: new Date("2026-09-13"),
      nb_nuits: 3,
      prix_par_nuit: 50,
      prix_total: 150,
      options: JSON.stringify({
        tourist_tax: {
          ...registerTax,
          exempt_adults: 1,
          exemption_reason: "Saisonnier dans la commune",
        },
      }),
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "declaration-complete"),
      propertyIds: [gite],
      nightDeclaration: true,
      nightReference: true,
    };
    state = await mutate(state, { type: "save", definition }, "2026-09");
    await assert.rejects(
      () =>
        mutate(state, { type: "ready", reportId: definition.id }, "2026-09"),
      /registre/,
    );
    state = await mutate(
      state,
      {
        type: "save",
        definition: {
          ...definition,
          nightRegistrations: {
            [gite]: { number: "1234567890123", notApplicable: false },
          },
        },
      },
      "2026-09",
    );
    let register = await nightRegister.getNightRegister(
      definition.id,
      "2026-09",
    );
    assert.equal(register.summary[0].taxablePersonNights, 3);
    assert.equal(register.summary[0].exemptAdultPersonNights, 3);
    assert.equal(register.summary[0].exemptMinorPersonNights, 3);
    assert.equal(register.summary[0].hostCollectedCents, null);
    const completion = {
      sourceRevision: register.sourceRevision,
      note: "Encaissement de taxe vérifié sur reçu du 12 septembre",
      rows: {
        [register.rows[0].key]: {
          collectionDate: "2026-09-12",
          collectedTaxCents: 300,
          collectedBaseTaxCents: 300,
          additionalTaxes: "Aucune selon le barème enregistré",
          nightlyPriceCents: null,
          allocationReviewed: false,
        },
      },
    };
    state = await mutate(
      state,
      {
        type: "night-register-completion",
        reportId: definition.id,
        completion,
      },
      "2026-09",
    );
    register = await nightRegister.getNightRegister(definition.id, "2026-09");
    assert.equal(register.incompleteCount, 0);
    assert.equal(
      result(
        state,
        "2026-09",
        state.reports.find((row) => row.id === definition.id)!,
      ).total,
      3,
    );
    const badges = await nightSummaries.getNightSummaries(2026);
    assert.equal(badges.report?.id, definition.id);
    assert.equal(
      badges.properties.find((row) => row.id === gite)!.months[8].included,
      3,
    );
    assert.equal(register.summary[0].hostCollectedCents, 300);
    assert.equal(register.summary[0].additionalCollectedCents, 0);
    state = await mutate(
      state,
      { type: "ready", reportId: definition.id },
      "2026-09",
    );
    state = await mutate(
      state,
      { type: "confirm", reportId: definition.id },
      "2026-09",
    );
    const key = reportPeriodKey(definition, "2026-09");
    const frozen = state.progress[key].snapshot!.nightRegister!;
    assert.ok(frozen.archivedAt);
    assert.equal(frozen.summary[0].taxablePersonNights, 3);
    await db.default.reservation.update({
      where: { id: reservation.id },
      data: { nb_adultes: 3 },
    });
    state = await reports.getReportWorkspace({ force: true });
    const current = await nightRegister.getNightRegister(
      definition.id,
      "2026-09",
    );
    assert.equal(current.summary[0].taxablePersonNights, 6);
    assert.match(current.rows[0].issues.join(" "), /sources ont changé/);
    assert.equal(
      snapshotDiffers(
        state.progress[key].snapshot!,
        result(
          state,
          "2026-09",
          state.reports.find((row) => row.id === definition.id)!,
        ),
      ),
      true,
    );
    assert.deepEqual(
      await nightRegister.getNightRegister(definition.id, "2026-09", {}),
      frozen,
    );
    await assert.rejects(
      () =>
        mutate(
          state,
          {
            type: "night-register-completion",
            reportId: definition.id,
            completion,
          },
          "2026-09",
        ),
      /sources du registre ont changé/,
    );
    state = await mutate(
      state,
      {
        type: "save",
        definition: {
          ...state.reports.find((row) => row.id === definition.id)!,
          cadence: "yearly",
        },
      },
      "2026-09",
    );
    assert.deepEqual(
      await nightRegister.getNightRegister(definition.id, "2026-09", { key }),
      frozen,
    );
    await assert.rejects(
      () => nightRegister.getNightRegister("guest-nights", "2026-09", { key }),
      /copie/,
    );
  });
});

test("déclaration : impossible d’effacer une perception connue pour obtenir un registre complet", async () => {
  await fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      date_entree: new Date("2026-09-10"),
      date_sortie: new Date("2026-09-12"),
      nb_nuits: 2,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await pay(reservation.id, 4, {
      purpose: "tourist_tax",
      paid_on: "2026-09-12",
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "declaration-null"),
      propertyIds: [gite],
      nightDeclaration: true,
      nightRegistrations: { [gite]: { number: "", notApplicable: true } },
    };
    state = await mutate(state, { type: "save", definition }, "2026-09");
    const register = await nightRegister.getNightRegister(
      definition.id,
      "2026-09",
    );
    assert.equal(register.incompleteCount, 0);
    state = await mutate(
      state,
      {
        type: "night-register-completion",
        reportId: definition.id,
        completion: {
          sourceRevision: register.sourceRevision,
          note: "Saisie incomplète",
          rows: {
            [register.rows[0].key]: {
              collectionDate: null,
              collectedTaxCents: null,
              collectedBaseTaxCents: null,
              additionalTaxes: "",
              nightlyPriceCents: null,
              allocationReviewed: false,
            },
          },
        },
      },
      "2026-09",
    );
    assert.ok(
      (await nightRegister.getNightRegister(definition.id, "2026-09"))
        .incompleteCount,
    );
    await assert.rejects(
      () =>
        mutate(state, { type: "ready", reportId: definition.id }, "2026-09"),
      /registre/,
    );
  });
});

test("déclaration : le partage d’une perception entre mois ne peut pas dépasser le montant encaissé", async () => {
  await fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      options: JSON.stringify({
        tourist_tax: {
          ...registerTax,
          settings: { ...registerTax.settings, additional_percentage: 10 },
        },
      }),
    });
    await pay(reservation.id, 8.8, {
      purpose: "tourist_tax",
      paid_on: "2026-10-31",
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "declaration-allocation"),
      propertyIds: [gite],
      nightDeclaration: true,
      nightRegistrations: { [gite]: { number: "", notApplicable: true } },
    };
    state = await mutate(state, { type: "save", definition });
    const edit = async (
      month: string,
      collectedTaxCents: number,
      collectedBaseTaxCents: number,
    ) => {
      const register = await nightRegister.getNightRegister(
        definition.id,
        month,
      );
      return mutate(
        state,
        {
          type: "night-register-completion",
          reportId: definition.id,
          completion: {
            sourceRevision: register.sourceRevision,
            note: "Ventilation vérifiée entre octobre et novembre",
            rows: {
              [register.rows[0].key]: {
                collectionDate: "2026-10-31",
                collectedTaxCents,
                collectedBaseTaxCents,
                additionalTaxes: "Taxe départementale : 0,40 €",
                nightlyPriceCents: null,
                allocationReviewed: true,
              },
            },
          },
        },
        month,
      );
    };
    state = await edit("2026-10", 440, 400);
    await assert.rejects(
      () => edit("2026-11", 880, 800),
      /dépasse la perception/,
    );
    state = await edit("2026-11", 440, 400);
    for (const month of ["2026-10", "2026-11"]) {
      const register = await nightRegister.getNightRegister(
        definition.id,
        month,
      );
      assert.equal(register.incompleteCount, 0);
      assert.equal(register.summary[0].hostCollectedCents, 440);
      assert.equal(register.summary[0].additionalCollectedCents, 40);
    }
  });
});

test("déclaration : une modification des exonérations après préparation exige une nouvelle vérification", async () => {
  await fixture(async ({ gite }) => {
    const reservation = await stay(gite, {
      date_entree: new Date("2026-09-10"),
      date_sortie: new Date("2026-09-12"),
      nb_nuits: 2,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await pay(reservation.id, 4, {
      purpose: "tourist_tax",
      paid_on: "2026-09-12",
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "declaration-ready"),
      propertyIds: [gite],
      nightDeclaration: true,
      nightRegistrations: { [gite]: { number: "", notApplicable: true } },
    };
    state = await mutate(state, { type: "save", definition }, "2026-09");
    state = await mutate(
      state,
      { type: "ready", reportId: definition.id },
      "2026-09",
    );
    await db.default.reservation.update({
      where: { id: reservation.id },
      data: {
        options: JSON.stringify({
          tourist_tax: {
            ...registerTax,
            exempt_adults: 1,
            exemption_reason: "Saisonnier",
          },
        }),
      },
    });
    state = await reports.getReportWorkspace({ force: true });
    assert.equal(
      state.progress[reportPeriodKey(definition, "2026-09")].ready,
      false,
    );
    await assert.rejects(
      () =>
        mutate(state, { type: "confirm", reportId: definition.id }, "2026-09"),
      /marqué comme prêt/,
    );
  });
});

test("déclaration : tarifs variables détaillés et exonération totale sans perception inventée", async () => {
  await fixture(async ({ gite }) => {
    await stay(gite, {
      date_entree: new Date("2026-09-10"),
      date_sortie: new Date("2026-09-12"),
      nb_nuits: 2,
      remise_montant: 10,
      options: JSON.stringify({
        tourist_tax: {
          ...registerTax,
          settings: { ...registerTax.settings, classified: false, stars: 0 },
          exempt_adults: 2,
          exemption_reason: "Saisonniers dans la commune",
        },
      }),
    });
    let state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "declaration-prices"),
      propertyIds: [gite],
      nightDeclaration: true,
      nightRegistrations: { [gite]: { number: "", notApplicable: true } },
    };
    state = await mutate(state, { type: "save", definition }, "2026-09");
    let register = await nightRegister.getNightRegister(
      definition.id,
      "2026-09",
    );
    assert.equal(register.summary[0].taxablePersonNights, 0);
    assert.equal(register.summary[0].hostCollectedCents, 0);
    const completion = {
      sourceRevision: register.sourceRevision,
      note: "Prix détaillés vérifiés dans le contrat",
      rows: {
        [register.rows[0].key]: {
          collectionDate: null,
          collectedTaxCents: 0,
          collectedBaseTaxCents: 0,
          additionalTaxes: "Aucune taxe due",
          allocationReviewed: false,
          nightlyPriceCents: null,
          nightlyPrices: [
            { date: "2026-09-10", amountCents: 4000 },
            { date: "2026-09-11", amountCents: 5000 },
          ],
        },
      },
    };
    state = await mutate(
      state,
      {
        type: "night-register-completion",
        reportId: definition.id,
        completion,
      },
      "2026-09",
    );
    register = await nightRegister.getNightRegister(definition.id, "2026-09");
    assert.equal(register.incompleteCount, 0);
    assert.equal(register.rows[0].nightlyPriceCents, null);
    assert.equal(register.rows[0].nightlyPrices!.length, 2);
    assert.match(
      nightRegisterCsv(register),
      /2026-09-10 : 40,00 ; 2026-09-11 : 50,00/,
    );
    await mutate(state, { type: "ready", reportId: definition.id }, "2026-09");
  });
});

test("registre : perceptions réelles, mineurs, source et nuitées sans double compte", async () => {
  await fixture(async ({ gite, org }) => {
    await db.default.gite.update({
      where: { id: gite },
      data: {
        taxe_sejour_config: JSON.stringify({
          ...registerTax.settings,
          portal_reference: "PMM225HT@",
          classification_valid_until: "2030-10-29",
        }),
      },
    });
    const reservation = await stay(gite, {
      date_entree: new Date("2026-09-10"),
      date_sortie: new Date("2026-09-12"),
      nb_nuits: 2,
      prix_par_nuit: 50,
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await stay(gite, {
      date_entree: new Date("2026-09-15"),
      date_sortie: new Date("2026-09-17"),
      nb_nuits: 2,
      booking_source: "Booking.com",
    });
    await pay(reservation.id, 2, {
      purpose: "tourist_tax",
      paid_on: "2026-09-11",
    });
    await pay(reservation.id, 2, {
      purpose: "tourist_tax",
      paid_on: "2026-09-12",
    });
    const state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "register-test"),
      recipient: "Gestionnaire de test",
      propertyIds: [gite],
      bookingSources: ["Direct"],
    };
    await reports.mutateReportWorkspace({
      revision: state.revision,
      factsRevision: state.factsRevision,
      month: "2026-09",
      command: { type: "save", definition },
    });
    const register = await nightRegister.getNightRegister(
      definition.id,
      "2026-09",
    );
    assert.equal(register.stayCount, 1);
    assert.equal(register.rows.length, 2);
    assert.equal(register.reportNights, 4);
    assert.deepEqual(
      register.rows.map((row) => row.collectionDate),
      ["2026-09-11", "2026-09-12"],
    );
    assert.deepEqual(
      register.rows.map((row) => row.collectedTaxCents),
      [200, 200],
    );
    assert.equal(register.rows[0].collectedBaseTaxCents, 200);
    assert.equal(register.rows[0].occupants, 3);
    assert.equal(register.rows[0].personNights, 6);
    assert.match(register.rows[0].exemptionReason!, /mineures/);
    assert.equal(register.properties[0].address, "Test");
    assert.equal(register.rows[0].registrationNumber, null);
    assert.equal(register.properties[0].portalReference, "PMM225HT@");
    const csv = nightRegisterCsv(register);
    assert.match(csv, /Référence du portail de déclaration/);
    assert.match(csv, /PMM225HT@/);
    const { renderNightRegisterHtml } =
      await import("../src/modules/finance/reports/nightRegisterRender.js");
    assert.match(
      renderNightRegisterHtml(register),
      /Référence du portail de déclaration : PMM225HT@/,
    );
    assert.match(csv, /Date de perception/);
    assert.match(csv, /hors taxes additionnelles/);
    assert.doesNotMatch(csv, /Voyageur de test/);
    const again = await nightRegister.getNightRegister(
      definition.id,
      "2026-09",
    );
    assert.equal(register.revision, again.revision);
    await db.default.gite.update({
      where: { id: gite },
      data: { adresse_ligne1: "Autre adresse" },
    });
    assert.notEqual(
      (await nightRegister.getNightRegister(definition.id, "2026-09")).revision,
      register.revision,
    );
    await assert.rejects(
      () =>
        inOrg(`${org}_other`, () =>
          nightRegister.getNightRegister(definition.id, "2026-09"),
        ),
      /introuvable/,
    );
    if (process.env.NIGHT_REGISTER_QA_JSON)
      fs.writeFileSync(
        process.env.NIGHT_REGISTER_QA_JSON,
        JSON.stringify(register),
      );
  });
});

test("registre : aucune perception ni tarif historique inventés et aucune duplication monétaire entre mois", async () => {
  await fixture(async ({ gite }) => {
    const overlapping = await stay(gite, {
      options: JSON.stringify({ tourist_tax: registerTax }),
    });
    await pay(overlapping.id, 8, {
      purpose: "tourist_tax",
      paid_on: "2026-10-31",
    });
    const legacy = await stay(gite, {
      date_entree: new Date("2026-10-05"),
      date_sortie: new Date("2026-10-07"),
      nb_nuits: 2,
    });
    await pay(legacy.id, 50, { paid_on: "2026-10-04" });
    const legacyTax = await stay(gite, {
      date_entree: new Date("2026-10-09"),
      date_sortie: new Date("2026-10-11"),
      nb_nuits: 2,
      options: JSON.stringify({
        tourist_tax: { ...registerTax, infants: undefined },
      }),
    });
    const state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "register-boundaries"),
      recipient: "Registre",
      propertyIds: [gite],
    };
    await reports.mutateReportWorkspace({
      revision: state.revision,
      factsRevision: state.factsRevision,
      month: "2026-10",
      command: { type: "save", definition },
    });
    const october = await nightRegister.getNightRegister(
      definition.id,
      "2026-10",
    );
    const octoberRow = october.rows.find(
      (row) => row.reservationId === overlapping.id,
    )!;
    assert.equal(octoberRow.nights, 2);
    assert.equal(octoberRow.collectionDate, "2026-10-31");
    assert.equal(octoberRow.collectedTaxCents, null);
    assert.match(octoberRow.issues.join(" "), /plusieurs périodes/);
    const legacyRow = october.rows.find(
      (row) => row.reservationId === legacy.id,
    )!;
    assert.equal(legacyRow.collectionDate, null);
    assert.equal(legacyRow.collectedTaxCents, null);
    assert.equal(legacyRow.nightlyPriceCents, null);
    assert.equal(legacyRow.infants, null);
    assert.equal(legacyRow.classified, null);
    const legacyTaxRow = october.rows.find(
      (row) => row.reservationId === legacyTax.id,
    )!;
    assert.equal(legacyTaxRow.infants, null);
    assert.equal(legacyTaxRow.occupants, null);
    assert.equal(legacyTaxRow.personNights, null);
    assert.match(legacyTaxRow.issues.join(" "), /bébés non enregistré/);
    const november = await nightRegister.getNightRegister(
      definition.id,
      "2026-11",
    );
    assert.equal(november.rows[0].nights, 2);
    assert.equal(november.rows[0].collectedTaxCents, null);
    const empty = await nightRegister.getNightRegister(
      definition.id,
      "2026-08",
    );
    assert.equal(empty.rows.length, 0);
    assert.equal(empty.properties[0].name, "Logement de test");
    await assert.rejects(
      () =>
        nightRegister.getNightRegister(
          state.reports.find((row) => row.kind === "social")!.id,
          "2026-10",
        ),
      /rapports de nuitées/,
    );
  });
});

test("registre : CSV protégé et HTML échappé pour les noms de gîtes", async () => {
  await fixture(async ({ gite }) => {
    await db.default.gite.update({
      where: { id: gite },
      data: {
        nom: '=HYPERLINK("test")',
        adresse_ligne1: "<script>alert(1)</script>",
      },
    });
    await stay(gite);
    const state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "register-escape"),
      recipient: "Registre",
      propertyIds: [gite],
    };
    await reports.mutateReportWorkspace({
      revision: state.revision,
      factsRevision: state.factsRevision,
      month: "2026-10",
      command: { type: "save", definition },
    });
    const register = await nightRegister.getNightRegister(
      definition.id,
      "2026-10",
    );
    assert.match(nightRegisterCsv(register), /'=HYPERLINK/);
    const { renderNightRegisterHtml } =
      await import("../src/modules/finance/reports/nightRegisterRender.js");
    const html = renderNightRegisterHtml(register);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Document à compléter/);
  });
});

test("registre HTTP : aperçu, pièces jointes réelles et refus d’une révision périmée", async () => {
  await fixture(async ({ gite, org }) => {
    await stay(gite, { options: JSON.stringify({ tourist_tax: registerTax }) });
    const state = await reports.getReportWorkspace();
    const definition = {
      ...createReport("tourist", "register-http"),
      recipient: "Registre HTTP",
      propertyIds: [gite],
    };
    await reports.mutateReportWorkspace({
      revision: state.revision,
      factsRevision: state.factsRevision,
      month: "2026-10",
      command: { type: "save", definition },
    });
    const { default: express } = await import("express");
    const { default: router } =
      await import("../src/modules/finance/reports/routes.js");
    const { closeBrowser } = await import("../src/services/pdfService.js");
    const app = express();
    app.use((_req, _res, next) => inOrg(org, next));
    app.use("/reports", router);
    app.use(((error, _req, res, _next) => {
      res
        .status(error.statusCode ?? (error.name === "ZodError" ? 400 : 500))
        .json({ error: error.message });
    }) as import("express").ErrorRequestHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/reports/${definition.id}/night-register?month=2026-10`;
      const preview = await fetch(url);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("cache-control"), "no-store");
      const register = await preview.json();
      assert.equal(register.rows.length, 1);
      const csv = await fetch(
        `${url}&format=csv&revision=${register.revision}`,
      );
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get("content-type")!, /text\/csv/);
      assert.match(
        csv.headers.get("content-disposition")!,
        /attachment;.*registre-sejours-2026-10.csv/,
      );
      assert.match(await csv.text(), /Date de perception/);
      const pdf = await fetch(
        `${url}&format=pdf&revision=${register.revision}`,
      );
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers.get("content-type")!, /application\/pdf/);
      assert.match(
        pdf.headers.get("content-disposition")!,
        /attachment;.*registre-sejours-2026-10.pdf/,
      );
      assert.equal(
        Buffer.from(await pdf.arrayBuffer())
          .subarray(0, 5)
          .toString(),
        "%PDF-",
      );
      await db.default.gite.update({
        where: { id: gite },
        data: { adresse_ligne1: "Adresse modifiée" },
      });
      const stale = await fetch(
        `${url}&format=pdf&revision=${register.revision}`,
      );
      assert.equal(stale.status, 409);
      assert.match((await stale.json()).error, /ont changé/);
      assert.equal((await fetch(`${url}&format=exe`)).status, 400);
      assert.equal(
        (await fetch(url.replace("month=2026-10", "month=invalide"))).status,
        400,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await closeBrowser();
    }
  });
});
