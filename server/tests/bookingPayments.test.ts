import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { before, after, test } from "node:test";
import express from "express";
import Stripe from "stripe";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "booking-payments-"));
const org = "booking-payment-test",
  otherOrg = "booking-payment-other";
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/modules/organizations/context.js");
let service: typeof import("../src/modules/bookingPayments/service.js");
let contracts: typeof import("../src/modules/bookingPayments/contracts.js");
let provider: typeof import("../src/modules/bookingPayments/provider.js");
const inOrg = <T>(fn: () => T, organizationId = org) =>
  context.runWithOrganization(
    { organizationId, source: "test" },
    async () => await fn(),
  );
const quote = {
  nb_nuits: 4,
  montant_hebergement: 300,
  total_options: 60,
  taxe_sejour: 0,
  total_global: 360,
  arrhes_theoriques: 90,
  nightly_breakdown: [],
  options_detail: {
    draps: 0,
    linge: 0,
    menage: 0,
    depart_tardif: 0,
    chiens: 60,
  },
  options_unit_prices: { chiens: 15 },
};
let sequence = 0;
const fixture = async (purpose: "deposit" | "full" = "deposit") =>
  inOrg(async () => {
    const n = ++sequence;
    const date = new Date(Date.UTC(2040, 0, n * 8));
    const prepared = service.prepareBookingPayment(quote as any, purpose);
    const request = await db.default.bookingRequest.create({
      data: {
        gite_id: "gite-payment-test",
        hote_nom: "Client fictif",
        date_entree: date,
        date_sortie: new Date(+date + 4 * 86400000),
        nb_nuits: 4,
        nb_adultes: 2,
        options: JSON.stringify({ chiens: { enabled: true, nb: 1 } }),
        pricing_snapshot: JSON.stringify(quote),
        hold_expires_at: new Date(Date.now() + 34 * 60000),
        payment: { create: prepared.data },
      },
      include: { payment: true },
    });
    const session = {
      id: `cs_test_${request.id}`,
      object: "checkout.session",
      mode: "payment",
      livemode: false,
      metadata: {
        booking_payment_id: request.payment!.id,
        organization_id: org,
      },
      client_reference_id: request.payment!.id,
      payment_status: "paid",
      status: "complete",
      amount_total: request.payment!.amount_cents,
      currency: "eur",
      payment_intent: `pi_${request.id}`,
    } as Stripe.Checkout.Session;
    return { request, session, token: prepared.token };
  });
before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `file:${temp}/test.db`,
    DATABASE_URL_SQLITE: `file:${temp}/test.db`,
    SMTP_HOST: "",
    SMTP_FROM: "",
    BOOKING_STRIPE_SECRET_KEY: "sk_test_fake_no_network",
    BOOKING_STRIPE_ACCOUNT_ID: "acct_fake",
    BOOKING_STRIPE_ORGANIZATION_ID: org,
    BOOKING_STRIPE_RETURN_URL: "http://gites.local/confirmation/",
    BOOKING_STRIPE_WEBHOOK_SECRET: "whsec_local_fixture",
  });
  fs.writeFileSync(`${temp}/test.db`, "");
  const serverRoot = process.cwd().endsWith("/server")
    ? process.cwd()
    : path.join(process.cwd(), "server");
  const result = spawnSync(
    process.execPath,
    ["scripts/prisma.mjs", "migrate", "deploy"],
    { cwd: serverRoot, env: process.env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  db = await import("../src/db/prisma.js");
  context = await import("../src/modules/organizations/context.js");
  service = await import("../src/modules/bookingPayments/service.js");
  contracts = await import("../src/modules/bookingPayments/contracts.js");
  provider = await import("../src/modules/bookingPayments/provider.js");
  await inOrg(() =>
    db.default.gite.create({
      data: {
        id: "gite-payment-test",
        nom: "Gîte fictif",
        prefixe_contrat: "PAY",
        adresse_ligne1: "Test",
        capacite_max: 4,
        proprietaires_noms: "Test",
        proprietaires_adresse: "Test",
        telephones: "",
        taxe_sejour_par_personne_par_nuit: 0,
        iban: "",
        titulaire: "Test",
      },
    }),
  );
});
after(async () => {
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("les arrhes gardent le calcul du gîte ; la totalité inclut toutes les options", () => {
  assert.deepEqual(service.paymentAmounts(quote as any, "deposit"), {
    amount: 9000,
    total: 36000,
  });
  assert.deepEqual(service.paymentAmounts(quote as any, "full"), {
    amount: 36000,
    total: 36000,
  });
  assert.throws(() =>
    service.paymentAmounts(
      { ...quote, arrhes_theoriques: 0 } as any,
      "deposit",
    ),
  );
  assert.throws(() =>
    service.paymentAmounts(
      { ...quote, arrhes_theoriques: 400 } as any,
      "deposit",
    ),
  );
  assert.throws(() => service.cents(NaN));
});
test("configuration désactivée pour un autre organisme et pour les clés réelles", async () => {
  assert.equal(await inOrg(() => provider.bookingPaymentsEnabled()), true);
  assert.equal(
    await inOrg(() => provider.bookingPaymentsEnabled(), otherOrg),
    false,
  );
  const key = process.env.BOOKING_STRIPE_SECRET_KEY;
  process.env.BOOKING_STRIPE_SECRET_KEY = "sk_live_forbidden";
  try {
    assert.equal(provider.bookingStripeConfig(), null);
  } finally {
    process.env.BOOKING_STRIPE_SECRET_KEY = key;
  }
});
test("paiement des arrhes : une seule réservation, options conservées, contrat déjà renseigné", async () => {
  const f = await fixture();
  await inOrg(async () => {
    assert.equal(await service.applyVerifiedSession(f.session), "confirmed");
    assert.equal(await service.applyVerifiedSession(f.session), "duplicate");
    const request = await db.default.bookingRequest.findUniqueOrThrow({
      where: { id: f.request.id },
    });
    assert.equal(request.status, "approved");
    const reservation = await db.default.reservation.findUniqueOrThrow({
      where: { id: request.approved_reservation_id! },
    });
    assert.equal(reservation.prix_total, 300);
    assert.equal(reservation.frais_optionnels_montant, 60);
    assert.equal(JSON.parse(reservation.options).chiens.nb, 1);
    assert.equal(
      await db.default.reservation.count({
        where: { origin_reference: f.request.id },
      }),
      1,
    );
    const tracking = await contracts.contractStripeTracking(reservation.id, {
      giteId: request.gite_id,
      dateDebut: request.date_entree,
      dateFin: request.date_sortie,
      total: 360,
      arrhes: 90,
    });
    assert.equal(tracking.statut_paiement_arrhes, "recu");
    assert.equal(tracking.statut_paiement_solde, "non_regle");
    assert.equal(tracking.mode_paiement_arrhes, "Stripe");
    await assert.rejects(
      () =>
        contracts.contractStripeTracking(reservation.id, {
          giteId: request.gite_id,
          dateDebut: request.date_entree,
          dateFin: request.date_sortie,
          total: 400,
          arrhes: 90,
        }),
      /déjà été payée/,
    );
    assert.equal(
      await db
        .getTenantPrisma(otherOrg)
        .bookingPayment.findUnique({ where: { id: f.request.payment!.id } }),
      null,
    );
    await assert.rejects(
      () => service.publicPaymentStatus(f.request.payment!.id, "x".repeat(43)),
      /introuvable/,
    );
  });
});
test("paiement complet : le solde du contrat est marqué réglé", async () => {
  const f = await fixture("full");
  await inOrg(async () => {
    assert.equal(await service.applyVerifiedSession(f.session), "confirmed");
    const request = await db.default.bookingRequest.findUniqueOrThrow({
      where: { id: f.request.id },
    });
    const tracking = await contracts.contractStripeTracking(
      request.approved_reservation_id,
      {
        giteId: request.gite_id,
        dateDebut: request.date_entree,
        dateFin: request.date_sortie,
        total: 360,
        arrhes: 90,
      },
    );
    assert.equal(tracking.statut_paiement_solde, "regle");
  });
});
test("webhook non payé, réel, autre organisme ou référence différente : aucune confirmation", async () => {
  const f = await fixture();
  await inOrg(async () => {
    for (const delta of [
      { payment_status: "unpaid" },
      { livemode: true },
      { client_reference_id: "other" },
      { metadata: { ...f.session.metadata, organization_id: otherOrg } },
    ])
      await service.applyVerifiedSession({ ...f.session, ...delta } as any);
    assert.equal(
      (
        await db.default.bookingRequest.findUniqueOrThrow({
          where: { id: f.request.id },
        })
      ).status,
      "pending",
    );
  });
});
test("montant ou devise incorrects : argent conservé dans le suivi, aucune réservation automatique", async () => {
  for (const delta of [{ amount_total: 100 }, { currency: "usd" }]) {
    const f = await fixture();
    await inOrg(async () => {
      assert.equal(
        await service.applyVerifiedSession({ ...f.session, ...delta } as any),
        "requires_review",
      );
      const payment = await db.default.bookingPayment.findUniqueOrThrow({
        where: { id: f.request.payment!.id },
      });
      assert.ok(payment.paid_at);
      assert.ok(payment.review_reason);
      assert.equal(
        (
          await db.default.bookingRequest.findUniqueOrThrow({
            where: { id: f.request.id },
          })
        ).approved_reservation_id,
        null,
      );
    });
  }
});
test("paiement tardif : dates libres confirmées, dates réattribuées signalées sans double réservation", async () => {
  for (const conflict of [false, true]) {
    const f = await fixture();
    await inOrg(async () => {
      await db.default.bookingRequest.update({
        where: { id: f.request.id },
        data: { status: "expired" },
      });
      if (conflict)
        await db.default.bookingRequest.create({
          data: {
            ...Object.fromEntries(
              Object.entries(f.request).filter(
                ([key]) =>
                  !["id", "payment", "createdAt", "updatedAt"].includes(key),
              ),
            ),
            status: "pending",
          } as any,
        });
      assert.equal(
        await service.applyVerifiedSession(f.session),
        conflict ? "requires_review" : "confirmed",
      );
    });
  }
});
test("livraisons concurrentes puis répétées : une seule allocation du séjour", async () => {
  const f = await fixture();
  await inOrg(async () => {
    await Promise.allSettled([
      service.applyVerifiedSession(f.session),
      service.applyVerifiedSession(f.session),
    ]);
    await service.applyVerifiedSession(f.session);
    assert.equal(
      await db.default.reservation.count({
        where: { origin_reference: f.request.id },
      }),
      1,
    );
  });
});
test("expiration répétée ne déconfirme jamais un paiement reçu", async () => {
  const f = await fixture();
  await inOrg(async () => {
    await service.applyVerifiedSession({
      ...f.session,
      status: "expired",
      payment_status: "unpaid",
    });
    assert.equal(
      (
        await db.default.bookingRequest.findUniqueOrThrow({
          where: { id: f.request.id },
        })
      ).status,
      "expired",
    );
    await service.applyVerifiedSession(f.session);
    await service.applyVerifiedSession({
      ...f.session,
      status: "expired",
      payment_status: "unpaid",
    });
    assert.equal(
      (
        await db.default.bookingRequest.findUniqueOrThrow({
          where: { id: f.request.id },
        })
      ).status,
      "approved",
    );
  });
});
test("webhook HTTP : signature obligatoire, corps brut et remboursement idempotent", async () => {
  const { bookingStripeWebhook } =
    await import("../src/modules/bookingPayments/routes.js");
  const app = express();
  app.post(
    "/hook",
    express.raw({ type: "application/json" }),
    bookingStripeWebhook,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}/hook`;
  const stripe = new Stripe("sk_test_fake");
  const f = await fixture("full");
  const post = async (type: string, data: unknown, valid = true) => {
    const payload = JSON.stringify({
      id: crypto.randomUUID(),
      type,
      livemode: false,
      data: { object: data },
    });
    return fetch(origin, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": valid
          ? stripe.webhooks.generateTestHeaderString({
              payload,
              secret: process.env.BOOKING_STRIPE_WEBHOOK_SECRET!,
            })
          : "bad",
      },
      body: payload,
    });
  };
  try {
    assert.equal(
      (await post("checkout.session.completed", f.session, false)).status,
      400,
    );
    assert.equal(
      (await post("checkout.session.completed", f.session)).status,
      200,
    );
    const refund = {
      payment_intent: f.session.payment_intent,
      amount_refunded: 36000,
      refunded: true,
    };
    assert.equal((await post("charge.refunded", refund)).status, 200);
    assert.equal(
      (
        await post("charge.refunded", {
          ...refund,
          amount_refunded: 100,
          refunded: false,
        })
      ).status,
      200,
    );
    await inOrg(async () => {
      const payment = await db.default.bookingPayment.findUniqueOrThrow({
        where: { id: f.request.payment!.id },
      });
      assert.equal(payment.status, "refunded");
      assert.equal(payment.refunded_amount_cents, 36000);
      const request = await db.default.bookingRequest.findUniqueOrThrow({
        where: { id: f.request.id },
      });
      const tracking = await contracts.contractStripeTracking(
        request.approved_reservation_id,
        {
          giteId: request.gite_id,
          dateDebut: request.date_entree,
          dateFin: request.date_sortie,
          total: 360,
          arrhes: 90,
        },
      );
      assert.equal(tracking.statut_paiement_arrhes, "non_recu");
      assert.equal(tracking.statut_paiement_solde, "non_regle");
    });
    const earlyRefund = await fixture("full");
    assert.equal(
      (
        await post("charge.refunded", {
          payment_intent: earlyRefund.session.payment_intent,
          metadata: { booking_payment_id: earlyRefund.request.payment!.id },
          amount_refunded: 36000,
          refunded: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (await post("checkout.session.completed", earlyRefund.session)).status,
      200,
    );
    await inOrg(async () => {
      const payment = await db.default.bookingPayment.findUniqueOrThrow({
        where: { id: earlyRefund.request.payment!.id },
      });
      assert.equal(payment.status, "requires_review");
      assert.equal(payment.refunded_amount_cents, 36000);
      assert.equal(
        (
          await db.default.bookingRequest.findUniqueOrThrow({
            where: { id: earlyRefund.request.id },
          })
        ).approved_reservation_id,
        null,
      );
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
