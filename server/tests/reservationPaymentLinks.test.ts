import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { before, after, test } from "node:test";
import express from "express";
import type Stripe from "stripe";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "reservation-links-"));
const org = "links-test";
let db: typeof import("../src/db/prisma.js");
let ctx: typeof import("../src/modules/organizations/context.js");
let links: typeof import("../src/modules/bookingPayments/reservationLinks.js");
let balance: typeof import("../src/modules/bookingPayments/reservationBalance.js");
let service: typeof import("../src/modules/bookingPayments/service.js");
let contracts: typeof import("../src/modules/bookingPayments/contracts.js");
const inOrg = <T>(fn: () => T, organizationId = org) =>
  ctx.runWithOrganization(
    { organizationId, source: "test" },
    async () => await fn(),
  );
before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: "file:" + temp + "/test.db",
    DATABASE_URL_SQLITE: "file:" + temp + "/test.db",
    APP_PUBLIC_URL: "http://localhost:4001",
    SMTP_HOST: "",
    SMTP_FROM: "",
    BOOKING_STRIPE_SECRET_KEY: "sk_test_no_network",
    BOOKING_STRIPE_ACCOUNT_ID: "acct_fixture",
    BOOKING_STRIPE_ORGANIZATION_ID: org,
    BOOKING_STRIPE_RETURN_URL: "http://gites.local/confirmation/",
  });
  fs.writeFileSync(temp + "/test.db", "");
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
  ctx = await import("../src/modules/organizations/context.js");
  links = await import("../src/modules/bookingPayments/reservationLinks.js");
  balance =
    await import("../src/modules/bookingPayments/reservationBalance.js");
  service = await import("../src/modules/bookingPayments/service.js");
  contracts = await import("../src/modules/bookingPayments/contracts.js");
  await inOrg(() =>
    db.default.gite.create({
      data: {
        id: "links-gite",
        nom: "<Gîte fictif>",
        prefixe_contrat: "LINK",
        adresse_ligne1: "Test",
        capacite_max: 4,
        proprietaires_noms: "Test",
        proprietaires_adresse: "Test",
        telephones: "",
        taxe_sejour_par_personne_par_nuit: 0,
        iban: "",
        titulaire: "Test",
        arrhes_taux_defaut: 0.3,
      },
    }),
  );
});
after(async () => {
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});
const fixture = () =>
  db.default.reservation.create({
    data: {
      gite_id: "links-gite",
      hote_nom: "Nom confidentiel",
      email: "secret@example.test",
      date_entree: new Date("2040-01-01"),
      date_sortie: new Date("2040-01-05"),
      nb_nuits: 4,
      nb_adultes: 2,
      prix_par_nuit: 75,
      prix_total: 300,
      frais_optionnels_montant: 60,
      options: JSON.stringify({ chiens: { enabled: true, nb: 1 } }),
    },
  });
const attempt = async (
  id: string,
  purpose: "deposit" | "balance" = "deposit",
) => {
  const dto = await links.createReservationPaymentLink(id, purpose);
  const row = await db.default.reservationPaymentLink.findUniqueOrThrow({
    where: { id: dto.id },
  });
  const payment = await db.default.bookingPayment.create({
    data: {
      reservation_id: id,
      payment_link_id: row.id,
      purpose,
      amount_cents: row.amount_cents,
      total_cents: row.total_cents,
      access_token_hash: crypto.randomBytes(32).toString("hex"),
      status: "pending",
      expires_at: new Date(Date.now() + 1800000),
    },
  });
  const session = {
    id: "cs_test_" + payment.id,
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    metadata: { booking_payment_id: payment.id, organization_id: org },
    client_reference_id: payment.id,
    payment_intent: "pi_" + payment.id,
    amount_total: payment.amount_cents,
    currency: "eur",
  } as unknown as Stripe.Checkout.Session;
  return { dto, row, payment, session };
};
test("lien court, options incluses, réutilisation et isolation des organismes", () =>
  inOrg(async () => {
    const r = await fixture();
    const choice = await links.paymentLinkChoices(r.id);
    assert.equal(choice.total, 360);
    assert.equal(choice.deposit_due, 90);
    assert.equal(choice.balance_due, 360);
    const l = await links.createReservationPaymentLink(r.id, "deposit");
    assert.match(l.url, /^http:\/\/localhost:4001\/p\/[A-Za-z0-9_-]{22}$/);
    assert.equal(l.amount, 90);
    assert.equal(
      (await links.createReservationPaymentLink(r.id, "deposit")).id,
      l.id,
    );
    await assert.rejects(
      () =>
        inOrg(() => links.loadPaymentLink(l.url.split("/").pop()!), "other"),
      /introuvable/,
    );
    await assert.rejects(
      () =>
        inOrg(
          () => links.createReservationPaymentLink(r.id, "balance"),
          "other",
        ),
      /configuré/,
    );
    const old = await db.default.reservationPaymentLink.findUniqueOrThrow({
      where: { id: l.id },
    });
    assert.ok(+old.expires_at > Date.now() + 6 * 86400000);
  }));
test("arrhes puis solde : deux reçus, une réservation, aucun montant demandé deux fois", () =>
  inOrg(async () => {
    const r = await fixture();
    const before = await db.default.reservation.count();
    const a = await attempt(r.id);
    assert.equal(await service.applyVerifiedSession(a.session), "recorded");
    assert.equal(await service.applyVerifiedSession(a.session), "duplicate");
    assert.equal((await balance.reservationBalance(r.id)).balanceDue, 27000);
    assert.equal((await balance.reservationBalance(r.id)).depositDue, 0);
    await assert.rejects(
      () => links.createReservationPaymentLink(r.id, "deposit"),
      /déjà réglé/,
    );
    const b = await attempt(r.id, "balance");
    assert.equal(b.dto.amount, 270);
    assert.equal(await service.applyVerifiedSession(b.session), "recorded");
    assert.equal((await balance.reservationBalance(r.id)).balanceDue, 0);
    const summary = await contracts.reservationPaymentPrefill(r.id);
    assert.equal(summary!.amount_paid, 360);
    assert.equal(summary!.remaining, 0);
    assert.equal(summary!.request_id, null);
    const tracking = await contracts.contractStripeTracking(r.id, {
      giteId: r.gite_id!,
      dateDebut: r.date_entree,
      dateFin: r.date_sortie,
      total: 360,
      arrhes: 90,
    });
    assert.equal(tracking.statut_paiement_solde, "regle");
    assert.equal(await db.default.reservation.count(), before);
    assert.equal(await db.default.bookingRequest.count(), 0);
    await assert.rejects(
      () => links.createReservationPaymentLink(r.id, "balance"),
      /déjà réglé/,
    );
  }));
test("les arrhes manuelles sont conservées lors du paiement du solde et de la réédition du contrat", () =>
  inOrg(async () => {
    const r = await fixture();
    const contract = await db.default.contrat.create({
      data: {
        numero_contrat: "MANUAL",
        reservation_id: r.id,
        gite_id: r.gite_id!,
        locataire_nom: r.hote_nom,
        locataire_adresse: "",
        locataire_tel: "",
        nb_adultes: 2,
        nb_enfants_2_17: 0,
        date_debut: r.date_entree,
        heure_arrivee: "16:00",
        date_fin: r.date_sortie,
        heure_depart: "10:00",
        nb_nuits: 4,
        prix_par_nuit: 75,
        options: r.options,
        arrhes_montant: 90,
        arrhes_date_limite: new Date(),
        solde_montant: 270,
        caution_montant: 0,
        cheque_menage_montant: 0,
        clauses: "",
        pdf_path: "",
        statut_paiement_arrhes: "recu",
        mode_paiement_arrhes: "Chèque",
      },
    });
    assert.equal((await links.paymentLinkChoices(r.id)).received, 90);
    const a = await attempt(r.id, "balance");
    assert.equal(a.dto.amount, 270);
    await service.applyVerifiedSession(a.session);
    assert.equal((await balance.reservationBalance(r.id)).received, 36000);
    const updated = await db.default.contrat.findUniqueOrThrow({
      where: { id: contract.id },
    });
    assert.equal(updated.mode_paiement_arrhes, "Chèque");
    assert.equal(updated.statut_paiement_solde, "regle");
    const summary = await contracts.reservationPaymentPrefill(r.id);
    assert.equal(summary!.remaining, 0);
    assert.equal(summary!.amount_paid, 270);
    const tracking = await contracts.contractStripeTracking(r.id, {
      giteId: r.gite_id!,
      dateDebut: r.date_entree,
      dateFin: r.date_sortie,
      total: 360,
      arrhes: 90,
    });
    assert.equal(tracking.mode_paiement_arrhes, "Chèque");
  }));
test("montants altérés et séjour modifié : argent tracé, vérification obligatoire", () =>
  inOrg(async () => {
    for (const changed of [false, true]) {
      const r = await fixture();
      const a = await attempt(r.id);
      if (changed)
        await db.default.reservation.update({
          where: { id: r.id },
          data: { prix_total: 400 },
        });
      else a.session.amount_total = 100;
      assert.equal(
        await service.applyVerifiedSession(a.session),
        "requires_review",
      );
      const payment = await db.default.bookingPayment.findUniqueOrThrow({
        where: { id: a.payment.id },
      });
      assert.ok(payment.paid_at);
      assert.ok(payment.review_reason);
      await assert.rejects(
        () => links.createReservationPaymentLink(r.id, "balance"),
        /vérification/,
      );
      await assert.rejects(
        () =>
          contracts.contractStripeTracking(r.id, {
            giteId: r.gite_id!,
            dateDebut: r.date_entree,
            dateFin: r.date_sortie,
            total: 360,
            arrhes: 90,
          }),
        /Vérifiez/,
      );
    }
  }));
test("expiration et annulation : réservation conservée, préparation concurrente bloquée", () =>
  inOrg(async () => {
    const r = await fixture();
    const a = await attempt(r.id);
    await assert.rejects(
      () => links.createReservationPaymentLink(r.id, "balance"),
      /en cours/,
    );
    assert.equal(
      await service.applyVerifiedSession({
        ...a.session,
        status: "expired",
        payment_status: "unpaid",
      }),
      "expired",
    );
    assert.ok(await db.default.reservation.findUnique({ where: { id: r.id } }));
    await links.revokeReservationPaymentLink(r.id, a.row.id);
    assert.equal((await links.loadPaymentLink(a.row.code)).status, "revoked");
    const b = await attempt(r.id);
    await db.default.bookingPayment.update({
      where: { id: b.payment.id },
      data: { status: "creating" },
    });
    // Revocation freezes new checkout immediately, even if Stripe has not yet returned a session.
    // Avoid any API call: simulate the state persisted before the external expiry.
    await db.default.reservationPaymentLink.update({
      where: { id: b.row.id },
      data: { status: "revoking" },
    });
    await assert.rejects(
      () => links.createReservationPaymentLink(r.id, "balance"),
      /annulation/,
    );
    assert.equal(await service.applyVerifiedSession(b.session), "recorded");
  }));
test("aperçu public : aucun Checkout créé, aucune coordonnée exposée, HTML échappé", async () => {
  const f = await inOrg(async () => {
    const r = await fixture();
    return links.createReservationPaymentLink(r.id, "balance");
  });
  const { publicReservationPaymentRouter } =
    await import("../src/modules/bookingPayments/linkRoutes.js");
  const app = express();
  app.use("/p", publicReservationPaymentRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const before = await inOrg(() => db.default.bookingPayment.count());
    const res = await fetch(
      "http://127.0.0.1:" +
        (server.address() as any).port +
        new URL(f.url).pathname,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("x-robots-tag")!, /noindex/);
    const body = await res.text();
    assert.match(body, /&lt;Gîte fictif&gt;/);
    assert.doesNotMatch(body, /Nom confidentiel|secret@example/);
    assert.match(body, /method="post"/);
    assert.equal(await inOrg(() => db.default.bookingPayment.count()), before);
    await inOrg(async () => {
      const row = await links.loadPaymentLink(
        new URL(f.url).pathname.split("/").pop()!,
      );
      const paid = await attempt(row.reservation_id, "balance");
      await service.applyVerifiedSession(paid.session);
      const origin =
        "http://127.0.0.1:" +
        (server.address() as any).port +
        new URL(f.url).pathname;
      const confirmed = await fetch(origin);
      const paidHtml = await confirmed.text();
      assert.match(paidHtml, /Votre paiement a bien été reçu/);
      assert.doesNotMatch(paidHtml, /<form/);
      await db.default.bookingPayment.update({
        where: { id: paid.payment.id },
        data: { refunded_amount_cents: 100, status: "partially_refunded" },
      });
      await assert.rejects(
        () => links.createReservationPaymentLink(row.reservation_id, "balance"),
        /remboursement/,
      );
      const refunded = await fetch(origin);
      assert.match(await refunded.text(), /suivi nécessaire/);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
