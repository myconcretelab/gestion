import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "reservation-ledger-"));
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/modules/organizations/context.js");
let ledger: typeof import("../src/modules/reservationPayments/ledger.js");
const org = "org_ledger_test";
const inOrg = <T>(fn: () => T, organizationId = org) =>
  context.runWithOrganization(
    { organizationId, source: "test" },
    async () => await fn(),
  );
let sequence = 0;
const stay = (overrides: Record<string, unknown> = {}) =>
  inOrg(() =>
    db.default.reservation.create({
      data: {
        id: randomUUID(),
        gite_id: "ledger-gite",
        hote_nom: "Client fictif",
        date_entree: new Date("2040-01-01"),
        date_sortie: new Date("2040-01-05"),
        nb_nuits: 4,
        nb_adultes: 2,
        prix_par_nuit: 250,
        prix_total: 1000,
        source_paiement: "Direct",
        booking_source: "Direct",
        ...overrides,
      },
    }),
  );
const payment = (amount: number, overrides = {}) => ({
  id: randomUUID(),
  amount,
  method: "Virement",
  purpose: "payment",
  paid_on: "2026-10-26",
  ...overrides,
});
const contractFor = (id: string, overrides: Record<string, unknown> = {}) =>
  inOrg(() =>
    db.default.contrat.create({
      data: {
        numero_contrat: `LEDGER-${++sequence}`,
        reservation_id: id,
        gite_id: "ledger-gite",
        locataire_nom: "Test",
        locataire_adresse: "Test",
        locataire_tel: "",
        nb_adultes: 2,
        nb_enfants_2_17: 0,
        date_debut: new Date("2040-01-01"),
        date_fin: new Date("2040-01-05"),
        heure_arrivee: "17:00",
        heure_depart: "12:00",
        nb_nuits: 4,
        prix_par_nuit: 250,
        options: "{}",
        arrhes_montant: 200,
        arrhes_date_limite: new Date("2039-12-01"),
        solde_montant: 800,
        caution_montant: 0,
        cheque_menage_montant: 0,
        clauses: "{}",
        pdf_path: "fixture.pdf",
        ...overrides,
      },
    }),
  );
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
  ledger = await import("../src/modules/reservationPayments/ledger.js");
  await db.systemPrisma.organization.create({
    data: { id: org, slug: org, name: "Test" },
  });
  await inOrg(() =>
    db.default.gite.create({
      data: {
        id: "ledger-gite",
        nom: "Test",
        prefixe_contrat: "L",
        adresse_ligne1: "Test",
        capacite_max: 8,
        proprietaires_noms: "Test",
        proprietaires_adresse: "Test",
        telephones: "",
        taxe_sejour_par_personne_par_nuit: 0,
        iban: "",
        titulaire: "Test",
        arrhes_taux_defaut: 0.2,
      },
    }),
  );
});
after(async () => {
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("arrhes par chèque puis solde par virement, annulation de saisie et contrat synchronisé", async () => {
  const r = await stay();
  await contractFor(r.id);
  await inOrg(async () => {
    const deposit = payment(200, { method: "Chèque", purpose: "deposit" });
    let state = await ledger.addReservationPayment(r.id, deposit);
    assert.equal(state.received, 200);
    assert.equal(state.remaining, 800);
    assert.equal(state.entries[0].method, "Chèque");
    const balance = payment(800, { purpose: "balance" });
    state = await ledger.addReservationPayment(r.id, balance);
    assert.equal(state.remaining, 0);
    assert.equal(state.received, 1000);
    const contract = await db.default.contrat.findFirstOrThrow({
      where: { reservation_id: r.id },
    });
    assert.equal(contract.statut_paiement_arrhes, "recu");
    assert.equal(contract.statut_paiement_solde, "regle");
    assert.equal(contract.mode_paiement_arrhes, "Chèque");
    state = await ledger.voidReservationPayment(r.id, balance.id);
    assert.equal(state.remaining, 800);
    assert.equal(
      state.entries.find((row) => row.id === balance.id)?.voided_at !== null,
      true,
    );
    assert.equal(
      (
        await db.default.contrat.findUniqueOrThrow({
          where: { id: contract.id },
        })
      ).statut_paiement_solde,
      "non_regle",
    );
    assert.equal(
      (await ledger.voidReservationPayment(r.id, balance.id)).received,
      200,
    );
    assert.equal(
      (await ledger.addReservationPayment(r.id, balance)).received,
      200,
      "un retry n'annule pas l'annulation",
    );
  });
});
test("plusieurs versements sans contrat et sans gîte", async () => {
  const r = await stay({ gite_id: null });
  await inOrg(async () => {
    await ledger.addReservationPayment(
      r.id,
      payment(125, { method: "Espèces" }),
    );
    await ledger.addReservationPayment(r.id, payment(375, { method: "Carte" }));
    const state = await ledger.addReservationPayment(r.id, payment(500));
    assert.equal(state.remaining, 0);
    assert.equal(state.entries.length, 3);
  });
});
test("une source historique ne crée aucun règlement fictif", async () => {
  const r = await stay({ source_paiement: "Chèque", booking_source: null });
  await inOrg(async () => {
    const state = await ledger.getReservationPaymentTracking(r.id);
    assert.equal(state.entries.length, 0);
    assert.equal(state.received, 0);
    assert.equal(state.managed, false);
    assert.equal(ledger.getBookingSource(r), "Direct");
  });
});
test("reprise des arrhes du contrat sans inventer leur date ni doubler les sommes", async () => {
  const r = await stay({ source_paiement: "Chèque", booking_source: null });
  const c = await contractFor(r.id, {
    statut_paiement_arrhes: "recu",
    mode_paiement_arrhes: null,
    date_paiement_arrhes: null,
  });
  await inOrg(async () => {
    const before = await ledger.getReservationPaymentTracking(r.id);
    assert.equal(before.entries[0].method, "Chèque");
    assert.equal(before.entries[0].paid_on, null);
    const state = await ledger.addReservationPayment(
      r.id,
      payment(800, { purpose: "balance" }),
    );
    assert.equal(state.received, 1000);
    assert.equal(state.entries.length, 2);
    assert.equal(
      state.entries.find((entry) => entry.origin === "legacy")?.paid_on,
      null,
    );
    const updated = await db.default.contrat.findUniqueOrThrow({
      where: { id: c.id },
    });
    assert.equal(updated.date_paiement_arrhes, null);
    await assert.rejects(
      ledger.assertLegacyTrackingEditable(updated),
      /suivis sur la réservation/,
    );
    const next = await ledger.voidReservationPayment(
      r.id,
      state.entries.find((entry) => entry.origin === "legacy")!.id,
    );
    assert.equal(next.remaining, 200);
  });
});
test("un règlement historique peut être annulé avant le premier nouveau versement", async () => {
  const r = await stay();
  await contractFor(r.id, {
    statut_paiement_arrhes: "recu",
    mode_paiement_arrhes: "Chèque",
  });
  await inOrg(async () => {
    const state = await ledger.getReservationPaymentTracking(r.id);
    const next = await ledger.voidReservationPayment(r.id, state.entries[0].id);
    assert.equal(next.received, 0);
    assert.equal(next.managed, true);
    assert.equal(next.entries.length, 1);
    assert.equal(
      (await ledger.voidReservationPayment(r.id, state.entries[0].id)).received,
      0,
    );
  });
});
test("les retries sont idempotents et une modification du même identifiant est refusée", async () => {
  const r = await stay();
  const input = payment(123.45);
  await inOrg(async () => {
    await ledger.addReservationPayment(r.id, input);
    assert.equal(
      (await ledger.addReservationPayment(r.id, input)).received,
      123.45,
    );
    await assert.rejects(
      ledger.addReservationPayment(r.id, { ...input, amount: 125 }),
      /déjà été utilisée/,
    );
    await assert.rejects(
      ledger.addReservationPayment(r.id, payment(900)),
      /dépasse le reste/,
    );
    assert.equal(
      (await ledger.getReservationPaymentTracking(r.id)).entries.length,
      1,
    );
  });
});
test("les anciens segments d'un séjour partagent les règlements et le total complet", async () => {
  const group = randomUUID();
  const a = await stay({ stay_group_id: group, prix_total: 600, nb_nuits: 2 });
  const b = await stay({
    stay_group_id: group,
    prix_total: 400,
    nb_nuits: 2,
    date_entree: new Date("2040-01-03"),
  });
  await inOrg(async () => {
    const first = await ledger.addReservationPayment(b.id, payment(300));
    const second = await ledger.getReservationPaymentTracking(a.id);
    assert.equal(first.total, 1000);
    assert.equal(second.received, 300);
    assert.equal(second.remaining, 700);
    assert.equal(
      (await db.default.reservation.findUniqueOrThrow({ where: { id: b.id } }))
        .payments_managed,
      true,
    );
    assert.equal(
      (await ledger.addReservationPayment(a.id, payment(700))).remaining,
      0,
    );
  });
});
test("les reçus Stripe restent distincts des versements manuels et un remboursement impose une vérification", async () => {
  const r = await stay();
  await inOrg(async () => {
    const stripe = await db.default.bookingPayment.create({
      data: {
        reservation_id: r.id,
        stripe_mode: "test",
        purpose: "deposit",
        amount_cents: 20000,
        total_cents: 100000,
        access_token_hash: randomUUID(),
        expires_at: new Date("2040-01-01"),
        paid_amount_cents: 20000,
        paid_at: new Date(),
        status: "paid",
      },
    });
    const state = await ledger.addReservationPayment(r.id, payment(800));
    assert.equal(state.received, 1000);
    assert.equal(
      state.entries.filter((entry) => entry.origin === "stripe").length,
      1,
    );
    await db.default.bookingPayment.update({
      where: { id: stripe.id },
      data: { refunded_amount_cents: 10000 },
    });
    const refunded = await ledger.getReservationPaymentTracking(r.id);
    assert.equal(refunded.received, 900);
    assert.equal(refunded.remaining, 100);
    assert.equal(refunded.requires_review, true);
    await assert.rejects(
      ledger.addReservationPayment(r.id, payment(100)),
      /remboursement/,
    );
  });
});
test("un paiement Stripe en cours bloque la saisie et le rollback ne modifie pas l'historique", async () => {
  const r = await stay();
  await inOrg(async () => {
    await db.default.bookingPayment.create({
      data: {
        reservation_id: r.id,
        stripe_mode: "test",
        purpose: "deposit",
        amount_cents: 20000,
        total_cents: 100000,
        access_token_hash: randomUUID(),
        expires_at: new Date("2040-01-01"),
        status: "pending",
      },
    });
    await assert.rejects(
      ledger.addReservationPayment(r.id, payment(200)),
      /carte est en cours/,
    );
    assert.equal(
      (await db.default.reservation.findUniqueOrThrow({ where: { id: r.id } }))
        .payments_managed,
      false,
    );
  });
});
test("le registre et ses annulations sont isolés par organisme", async () => {
  const r = await stay();
  const input = payment(100);
  await inOrg(() => ledger.addReservationPayment(r.id, input));
  await inOrg(async () => {
    await assert.rejects(
      ledger.getReservationPaymentTracking(r.id),
      /introuvable/,
    );
    await assert.rejects(
      ledger.voidReservationPayment(r.id, input.id),
      /introuvable/,
    );
    assert.equal(await db.default.reservationRecordedPayment.count(), 0);
  }, "org_ledger_other");
});
test("l'API valide les dates réelles, les centimes, les moyens et refuse un montant nul", async () => {
  const r = await stay();
  const router = (await import("../src/routes/reservationPayments.js")).default;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => inOrg(next));
  app.use("/reservations/:id/payments", router);
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.statusCode || 400).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/reservations/${r.id}/payments`;
  try {
    for (const override of [
      { paid_on: "2026-02-30" },
      { amount: 0 },
      { amount: 2.001 },
      { method: "Inconnu" },
    ]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payment(100, override)),
      });
      assert.equal(response.status, 400);
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payment(100)),
    });
    assert.equal(response.status, 201);
    assert.equal(((await response.json()) as any).remaining, 900);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("un ancien lien Stripe ne réintroduit pas un règlement manuel annulé", async () => {
  const r = await stay();
  const manual = payment(200, { purpose: "deposit" });
  await inOrg(async () => {
    await ledger.addReservationPayment(r.id, manual);
    const link = await db.default.reservationPaymentLink.create({
      data: {
        reservation_id: r.id,
        stripe_mode: "test",
        code: randomUUID(),
        purpose: "balance",
        amount_cents: 80000,
        total_cents: 100000,
        deposit_cents: 20000,
        offline_received_cents: 20000,
        terms_json: "{}",
        status: "paid",
        expires_at: new Date("2040-01-01"),
      },
    });
    await db.default.bookingPayment.create({
      data: {
        reservation_id: r.id,
        payment_link_id: link.id,
        stripe_mode: "test",
        purpose: "balance",
        amount_cents: 80000,
        total_cents: 100000,
        access_token_hash: randomUUID(),
        expires_at: new Date("2040-01-01"),
        paid_amount_cents: 80000,
        paid_at: new Date(),
        status: "paid",
      },
    });
    assert.equal(
      (await ledger.getReservationPaymentTracking(r.id)).remaining,
      0,
    );
    await ledger.voidReservationPayment(r.id, manual.id);
    const { reservationBalance } =
      await import("../src/modules/bookingPayments/reservationBalance.js");
    const balance = await reservationBalance(r.id);
    assert.equal(balance.offline, 0);
    assert.equal(balance.balanceDue, 20000);
    const { reservationPaymentPrefill } =
      await import("../src/modules/bookingPayments/contracts.js");
    const summary = await reservationPaymentPrefill(r.id);
    assert.equal(summary?.offline_received, 0);
    assert.equal(summary?.remaining, 200);
  });
});

test("les montants et dates des nouveaux contrats reprennent les règlements déjà saisis", async () => {
  const r = await stay();
  await inOrg(async () => {
    await ledger.addReservationPayment(
      r.id,
      payment(200, {
        method: "Chèque",
        purpose: "deposit",
        paid_on: "2026-10-13",
      }),
    );
    const { contractStripeTracking } =
      await import("../src/modules/bookingPayments/contracts.js");
    const tracking = await contractStripeTracking(r.id, {
      giteId: "ledger-gite",
      dateDebut: r.date_entree,
      dateFin: r.date_sortie,
      total: 1000,
      arrhes: 200,
    });
    assert.equal(tracking.statut_paiement_arrhes, "recu");
    assert.equal(tracking.mode_paiement_arrhes, "Chèque");
    assert.equal(
      tracking.date_paiement_arrhes?.toISOString().slice(0, 10),
      "2026-10-13",
    );
    assert.equal(tracking.statut_paiement_solde, "non_regle");
  });
});

test("changer l'origine conserve le classement historique et les réservations avec règlements ne sont pas supprimables", async () => {
  const r = await stay({ source_paiement: "Espèces", booking_source: null });
  await inOrg(async () => {
    await ledger.setReservationBookingSource(r.id, "Airbnb");
    const changed = await db.default.reservation.findUniqueOrThrow({
      where: { id: r.id },
    });
    assert.equal(changed.source_paiement, "Espèces");
    assert.equal(changed.booking_source, "Airbnb");
    const input = payment(100);
    await ledger.addReservationPayment(r.id, input);
    await ledger.voidReservationPayment(r.id, input.id);
    await assert.rejects(
      ledger.assertReservationPaymentsDeletable(r.id),
      /historique de règlements/,
    );
  });
});
