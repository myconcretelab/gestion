import crypto from "node:crypto";
import type Stripe from "stripe";
import prisma from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getOrganizationId } from "../organizations/context.js";
import {
  bookingStripeConfig,
  bookingPaymentsEnabled,
  getBookingStripe,
} from "./provider.js";
import { reservationBalance, paymentError } from "./reservationBalance.js";
import {
  sendBookingPaymentEmails,
  type BookingRequestEmailPayload,
} from "../../services/bookingRequestEmail.js";
import {
  paidBookingForReservation,
  reservationPaymentPrefill,
} from "./contracts.js";
import { fromJsonString } from "../../utils/jsonFields.js";

export const paymentLinkUrl = (code: string) => {
  const base = new URL(env.APP_PUBLIC_URL);
  if (
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !(
        env.NODE_ENV !== "production" &&
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(base.hostname)
      ))
  )
    throw paymentError(
      "L’adresse publique de Gestion doit être configurée pour les liens de paiement.",
      503,
    );
  return new URL(`/p/${code}`, base).href;
};
const dto = (row: any) => ({
  id: row.id,
  purpose: row.purpose,
  amount: row.amount_cents / 100,
  status: row.status,
  expires_at: row.expires_at,
  url: paymentLinkUrl(row.code),
});
export const paymentLinkChoices = async (reservationId: string) => {
  const state = await reservationBalance(reservationId);
  const links = await prisma.reservationPaymentLink.findMany({
    where: {
      reservation_id: reservationId,
      stripe_mode: bookingStripeConfig()?.mode ?? "disabled",
      status: { in: ["active", "revoking"] },
      expires_at: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    enabled: bookingPaymentsEnabled(),
    mode: bookingStripeConfig()?.mode ?? null,
    total: state.total / 100,
    received: state.received / 100,
    deposit_due: state.depositDue / 100,
    balance_due: state.balanceDue / 100,
    source: state.contract ? "contract" : "reservation",
    platform: /airbnb|booking\.com/i.test(
      state.reservation.source_paiement || "",
    ),
    links: links.map(dto),
  };
};
export const createReservationPaymentLink = async (
  reservationId: string,
  purpose: "deposit" | "balance",
) => {
  if (!bookingPaymentsEnabled())
    throw paymentError(
      "Le paiement Stripe n’est pas configuré pour cet organisme.",
      503,
    );
  return prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: reservationId },
      data: { updatedAt: new Date() },
    });
    const state = await reservationBalance(reservationId, tx);
    const amount = purpose === "deposit" ? state.depositDue : state.balanceDue;
    if (amount < 50)
      throw paymentError(
        "Ce montant est déjà réglé ou inférieur au minimum de paiement par carte.",
      );
    const active = await tx.reservationPaymentLink.findFirst({
      where: {
        reservation_id: reservationId,
        stripe_mode: bookingStripeConfig()!.mode,
        status: { in: ["active", "revoking"] },
      },
      include: {
        payments: { where: { status: { in: ["creating", "pending"] } } },
      },
    });
    if (active) {
      if (active.status === "revoking")
        throw paymentError(
          "L’annulation du lien précédent doit être terminée avant de créer un autre lien.",
        );
      if (
        active.expires_at > new Date() &&
        active.purpose === purpose &&
        JSON.parse(active.terms_json).fingerprint === state.fingerprint
      )
        return dto(active);
      if (active.payments.length)
        throw paymentError(
          "Un paiement est en cours sur le lien existant. Annulez ce lien avant d’en créer un autre.",
        );
      await tx.reservationPaymentLink.update({
        where: { id: active.id },
        data: { status: "revoked" },
      });
    }
    const row = await tx.reservationPaymentLink.create({
      data: {
        reservation_id: reservationId,
        stripe_mode: bookingStripeConfig()!.mode,
        code: crypto.randomBytes(16).toString("base64url"),
        purpose,
        amount_cents: amount,
        total_cents: state.total,
        deposit_cents: state.deposit,
        offline_received_cents: state.offline,
        terms_json: JSON.stringify({
          ...state.terms,
          fingerprint: state.fingerprint,
        }),
        expires_at: new Date(Date.now() + 7 * 86400000),
      },
    });
    return dto(row);
  });
};
export const loadPaymentLink = async (code: string) => {
  if (!/^[A-Za-z0-9_-]{22}$/.test(code))
    throw paymentError("Lien de paiement introuvable.", 404);
  const link = await prisma.reservationPaymentLink.findUnique({
    where: { code },
    include: {
      reservation: { include: { gite: true } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!link) throw paymentError("Lien de paiement introuvable.", 404);
  if (link.stripe_mode !== bookingStripeConfig()?.mode)
    throw paymentError(
      "Ce lien appartient à un autre environnement de paiement. Contactez le propriétaire pour obtenir un nouveau lien.",
      410,
    );
  return link;
};
export const startReservationLinkCheckout = async (code: string) => {
  const { stripe } = await getBookingStripe();
  const link = await loadPaymentLink(code);
  if (link.status !== "active" || +link.expires_at <= Date.now() + 32 * 60000)
    throw paymentError(
      "Ce lien est payé, annulé ou expiré. Contactez le propriétaire pour un nouveau lien.",
    );
  const result = await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: link.reservation_id },
      data: { updatedAt: new Date() },
    });
    const current = await tx.reservationPaymentLink.findUniqueOrThrow({
      where: { id: link.id },
    });
    if (current.status !== "active")
      throw paymentError("Ce lien n’est plus actif.");
    const state = await reservationBalance(link.reservation_id, tx);
    if (state.fingerprint !== JSON.parse(link.terms_json).fingerprint)
      throw paymentError(
        "La réservation ou ses règlements ont changé. Contactez le propriétaire pour actualiser le lien.",
      );
    const pending = await tx.bookingPayment.findFirst({
      where: {
        payment_link_id: link.id,
        status: { in: ["creating", "pending"] },
      },
    });
    if (pending) return { payment: pending, existing: true };
    const payment = await tx.bookingPayment.create({
      data: {
        reservation_id: link.reservation_id,
        stripe_mode: link.stripe_mode,
        payment_link_id: link.id,
        purpose: link.purpose,
        amount_cents: link.amount_cents,
        total_cents: link.total_cents,
        access_token_hash: crypto.randomBytes(32).toString("hex"),
        status: "creating",
        expires_at: new Date(Math.floor(Date.now() / 1000) * 1000 + 31 * 60000),
      },
    });
    return { payment, existing: false };
  });
  if (result.existing) {
    if (!result.payment.stripe_session_id)
      throw paymentError(
        "Le paiement est en cours de préparation. Réessayez dans un instant.",
      );
    const session = await stripe.checkout.sessions.retrieve(
      result.payment.stripe_session_id,
    );
    if (session.status !== "open" || session.payment_status === "paid")
      throw paymentError(
        "Le paiement est déjà traité. Revenez au récapitulatif du lien.",
      );
    if (!session.url?.startsWith("https://checkout.stripe.com/"))
      throw paymentError("Paiement indisponible.");
    return session.url;
  }
  const payment = result.payment;
  const url = paymentLinkUrl(code);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      allowed_payment_method_types: ["card"],
      locale: "fr",
      customer_email: link.reservation.email || undefined,
      client_reference_id: payment.id,
      metadata: {
        booking_payment_id: payment.id,
        organization_id: getOrganizationId(),
      },
      payment_intent_data: { metadata: { booking_payment_id: payment.id } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: payment.amount_cents,
            product_data: {
              name: `${link.purpose === "deposit" ? "Arrhes" : "Règlement du séjour"} — ${link.reservation.gite?.nom || "Gîte"}`,
              description: `Du ${link.reservation.date_entree.toISOString().slice(0, 10)} au ${link.reservation.date_sortie.toISOString().slice(0, 10)}`,
            },
          },
        },
      ],
      expires_at: Math.floor(+payment.expires_at / 1000),
      success_url: url + "?retour=succes",
      cancel_url: url + "?retour=annulation",
    },
    { idempotencyKey: `reservation-payment-${payment.id}` },
  );
  await prisma.bookingPayment.updateMany({
    where: { id: payment.id, status: "creating", paid_at: null },
    data: { stripe_session_id: session.id, status: "pending" },
  });
  if (!session.url?.startsWith("https://checkout.stripe.com/"))
    throw paymentError("Paiement indisponible.");
  return session.url;
};
export const applyReservationLinkSession = async (
  session: Stripe.Checkout.Session,
  paymentId: string,
) => {
  const config = bookingStripeConfig();
  if (!config || session.livemode !== config.livemode) return "ignored";
  return prisma.$transaction(async (tx) => {
    const initial = await tx.bookingPayment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    if (
      initial.stripe_mode !== config.mode ||
      !initial.reservation_id ||
      !initial.payment_link_id
    )
      return "ignored";
    await tx.reservation.update({
      where: { id: initial.reservation_id },
      data: { updatedAt: new Date() },
    });
    const payment = await tx.bookingPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { payment_link: true },
    });
    if (payment.paid_at) return "duplicate";
    if (session.status === "expired" && session.payment_status !== "paid") {
      await tx.bookingPayment.update({
        where: { id: paymentId },
        data: { status: "expired", stripe_session_id: session.id },
      });
      return "expired";
    }
    if (session.payment_status !== "paid") return "unpaid";
    const intent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!intent) return "ignored";
    const link = payment.payment_link!;
    let review: string | null =
      session.amount_total !== payment.amount_cents ||
      session.currency !== payment.currency
        ? "Le montant ou la devise Stripe diffère du lien."
        : null;
    if (
      payment.refunded_amount_cents ||
      !["active", "revoking"].includes(link.status)
    )
      review = "Paiement reçu sur un lien clôturé ou remboursé.";
    let state: Awaited<ReturnType<typeof reservationBalance>> | null = null;
    try {
      state = await reservationBalance(initial.reservation_id, tx);
      if (state.fingerprint !== JSON.parse(link.terms_json).fingerprint)
        review =
          "La réservation ou ses règlements ont changé depuis la création du lien.";
    } catch (error) {
      if (!(error instanceof Error && "statusCode" in error)) throw error;
      review = error.message;
    }
    await tx.bookingPayment.update({
      where: { id: paymentId },
      data: {
        stripe_session_id: session.id,
        stripe_payment_intent: intent,
        paid_amount_cents: session.amount_total || 0,
        paid_at: new Date(),
        status: review ? "requires_review" : "paid",
        review_reason: review,
      },
    });
    await tx.reservationPaymentLink.update({
      where: { id: link.id },
      data: { status: review ? "requires_review" : "paid" },
    });
    if (review || !state) return "requires_review";
    if (state.contract) {
      const received = state.received + payment.amount_cents;
      const depositReceived = received >= state.deposit;
      const preserveManualDeposit =
        state.contract.statut_paiement_arrhes === "recu" &&
        state.contract.mode_paiement_arrhes !== "Stripe";
      await tx.contrat.update({
        where: { id: state.contract.id },
        data: {
          statut_paiement_arrhes: depositReceived
            ? "recu"
            : state.contract.statut_paiement_arrhes,
          date_paiement_arrhes: depositReceived
            ? state.contract.date_paiement_arrhes || new Date()
            : state.contract.date_paiement_arrhes,
          mode_paiement_arrhes:
            depositReceived && !preserveManualDeposit
              ? "Stripe"
              : state.contract.mode_paiement_arrhes,
          statut_paiement_solde:
            received >= state.total
              ? "regle"
              : state.contract.statut_paiement_solde,
        },
      });
    }
    return "recorded";
  });
};
export const revokeReservationPaymentLink = async (
  reservationId: string,
  id: string,
) => {
  const link = await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: reservationId },
      data: { updatedAt: new Date() },
    });
    const row = await tx.reservationPaymentLink.findUniqueOrThrow({
      where: { id, reservation_id: reservationId },
    });
    if (row.stripe_mode !== bookingStripeConfig()?.mode)
      throw paymentError(
        "Ce lien appartient à un autre environnement de paiement.",
      );
    if (row.status === "paid" || row.status === "requires_review")
      throw paymentError(
        "Un paiement a déjà été reçu. Le lien ne peut plus être annulé.",
      );
    if (row.status === "active")
      await tx.reservationPaymentLink.update({
        where: { id },
        data: { status: "revoking" },
      });
    return tx.reservationPaymentLink.findUniqueOrThrow({
      where: { id },
      include: {
        payments: { where: { status: { in: ["creating", "pending"] } } },
      },
    });
  });
  if (link.payments.length) {
    const { stripe } = await getBookingStripe();
    for (const payment of link.payments) {
      if (!payment.stripe_session_id)
        throw paymentError(
          "Le paiement est en préparation. Réessayez l’annulation dans quelques instants.",
        );
      let session = await stripe.checkout.sessions.retrieve(
        payment.stripe_session_id,
      );
      if (session.status === "open") {
        try {
          session = await stripe.checkout.sessions.expire(session.id);
        } catch {
          session = await stripe.checkout.sessions.retrieve(session.id);
        }
      }
      await applyReservationLinkSession(session, payment.id);
      if (session.payment_status === "paid")
        throw paymentError(
          "Ce paiement a déjà été reçu. Le lien ne peut plus être annulé.",
        );
      if (session.status !== "expired")
        throw paymentError(
          "Stripe n’a pas encore confirmé l’annulation. Réessayez dans quelques instants.",
        );
    }
  }
  await prisma.reservationPaymentLink.updateMany({
    where: { id, status: "revoking" },
    data: { status: "revoked" },
  });
};
export const buildReservationLinkReceipt = async (payment: any) => {
  const reservation = payment.reservation;
  const terms = fromJsonString<any>(payment.payment_link?.terms_json, {});
  const options = terms.options || fromJsonString(reservation.options, {});
  const original = await paidBookingForReservation(reservation.id);
  const originalQuote =
    original && original.request.options === reservation.options
      ? fromJsonString<any>(original.request.pricing_snapshot, {})
      : null;
  const fees =
    typeof terms.fees === "number"
      ? terms.fees
      : Number(reservation.frais_optionnels_montant);
  const detail =
    originalQuote?.total_options === fees
      ? originalQuote.options_detail
      : undefined;
  const selected = [
    ["draps", "draps"],
    ["linge_toilette", "linge"],
    ["menage", "menage"],
    ["depart_tardif", "depart_tardif"],
    ["chiens", "chiens"],
  ].filter(([key]) => options[key]?.enabled);
  const summary = await reservationPaymentPrefill(reservation.id);
  const payload: BookingRequestEmailPayload = {
    id: reservation.id,
    hote_nom: reservation.hote_nom,
    email: reservation.email,
    telephone: reservation.telephone,
    gite: reservation.gite,
    date_entree: terms.start || reservation.date_entree,
    date_sortie: terms.end || reservation.date_sortie,
    nb_adultes: reservation.nb_adultes,
    nb_enfants_2_17: reservation.nb_enfants_2_17,
    hold_expires_at: payment.expires_at,
    options,
    pricing_snapshot: {
      nb_nuits: Math.round(
        (+new Date(terms.end || reservation.date_sortie) -
          +new Date(terms.start || reservation.date_entree)) /
          86400000,
      ),
      montant_hebergement:
        typeof terms.price === "number"
          ? terms.price - terms.discount
          : reservation.prix_total - reservation.remise_montant,
      total_options: fees,
      total_global: payment.total_cents / 100,
      arrhes_theoriques: (payment.payment_link?.deposit_cents || 0) / 100,
      ...(detail
        ? {
            options_detail: detail,
            options_unit_prices: originalQuote.options_unit_prices,
          }
        : selected.length === 1
          ? { options_detail: { [selected[0][1]]: fees } as any }
          : {}),
    },
  };
  return {
    payload,
    paymentInfo: {
      ...payment,
      remaining_cents: summary
        ? Math.round(summary.remaining * 100)
        : undefined,
    },
  };
};
export const sendReservationLinkReceipt = async (payment: any) => {
  const content = await buildReservationLinkReceipt(payment);
  await sendBookingPaymentEmails(content.payload, content.paymentInfo, true);
};
