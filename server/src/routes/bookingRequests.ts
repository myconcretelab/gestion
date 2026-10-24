import { bookingReservationData } from "../modules/bookingPayments/reservation.js";
import { lockBookingGite, assertTransactionAvailability } from "../modules/bookingPayments/locking.js";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import {
  BookedValidationError,
  assertBookedAvailability,
  computeBookedQuote,
  encodeBookingRequestPricingSnapshot,
  ensureBookingRequestPending,
  expireStaleBookingRequests,
  getBookingRequestHoldExpiresAt,
  hydrateBookingRequest,
  parseBookedDateInput,
  reviseBookingRequestOptions,
  type BookingQuote,
} from "../services/booked.js";
import { buildBookingRequestApprovedSms, sendBookingRequestApprovedEmail, sendBookingRequestRejectedEmail } from "../services/bookingRequestEmail.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";
import { sendOvhSms } from "../services/ovhSms.js";
import { notifyBookingRequestApprovedOnTelegram } from "../services/telegramNotifications.js";
import type { OptionsInput } from "../services/contractCalculator.js";
import { optionsSchema } from "./shared/rentalDocument.js";

const router = Router();

const decisionSchema = z.object({
  decision_note: z.string().trim().optional().default(""),
  internal_note: z.string().trim().max(20_000).optional(),
  email: z
    .object({
      recipient: z.string().trim().email().optional(),
      subject: z.string().trim().min(1).max(200).optional(),
      body: z.string().trim().min(1).max(20_000).optional(),
    })
    .optional(),
});

const internalNoteSchema = z.object({
  internal_note: z.string().trim().max(20_000).optional().default(""),
});

const dateUpdateSchema = z.object({
  date_entree: z.string().trim().min(1),
  date_sortie: z.string().trim().min(1),
});

const optionsUpdateSchema = z.object({
  options: optionsSchema.pick({ draps: true, linge_toilette: true, menage: true, depart_tardif: true, chiens: true, regle_animaux_acceptes: true }).superRefine((options, ctx) => {
    for (const [key, count] of [["draps", options.draps?.nb_lits], ["linge_toilette", options.linge_toilette?.nb_personnes], ["chiens", options.chiens?.nb]] as const) {
      if (options[key]?.enabled && !(Number(count) > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Indiquez une quantité supérieure à zéro pour l’option choisie." });
      }
    }
  }),
});

const quoteGiteSelect = {
  id: true,
  capacite_max: true,
  nb_adultes_max: true,
  nb_enfants_max: true,
  prix_nuit_liste: true,
  prix_nuit_basse_saison: true,
  prix_nuit_haute_saison: true,
  min_nuits_toute_annee: true,
  min_nuits_vacances_scolaires: true,
  min_nuits_juillet_aout: true,
  taxe_sejour_par_personne_par_nuit: true,
  taxe_sejour_config: true,
  options_draps_par_lit: true,
  options_linge_toilette_par_personne: true,
  options_menage_forfait: true,
  options_depart_tardif_forfait: true,
  options_chiens_forfait: true,
  arrhes_taux_defaut: true,
  regle_animaux_acceptes: true,
  regle_bois_premiere_flambee: true,
  regle_tiers_personnes_info: true,
} as const;

const bookingRequestGiteSelect = {
  id: true,
  nom: true,
  nom_avec_preposition: true,
  email: true,
  adresse_ligne1: true,
  adresse_ligne2: true,
  telephones: true,
  photos: {
    orderBy: [{ is_primary: "desc" }, { ordre: "asc" }, { createdAt: "asc" }],
    take: 1,
  },
} satisfies Prisma.GiteSelect;

const bookingRequestInclude = {
  payment: { select: { id: true, status: true, purpose: true, amount_cents: true, paid_amount_cents: true, total_cents: true, refunded_amount_cents: true, paid_at: true, review_reason: true } },
  gite: { select: bookingRequestGiteSelect },
  approved_reservation: {
    select: {
      id: true,
      hote_nom: true,
      date_entree: true,
      date_sortie: true,
    },
  },
} satisfies Prisma.BookingRequestInclude;

const mapBookedError = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return { status: 409, body: { error: "La demande a été modifiée entre-temps. Rechargez sa fiche avant de réessayer.", code: "request_changed" } };
  }
  if (error instanceof BookedValidationError) {
    return {
      status: error.statusCode,
      body: {
        error: error.message,
        code: error.code,
        details: error.details,
      },
    };
  }
  return null;
};

const toBookingRequestPayload = (bookingRequest: any) => hydrateBookingRequest({
  ...bookingRequest,
  gite: bookingRequest.gite,
  approved_reservation: bookingRequest.approved_reservation,
});

const loadBookingRequest = async (id: string) =>
  prisma.bookingRequest.findUnique({
    where: { id },
    include: bookingRequestInclude,
  });

router.use("/:id", async (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || req.path === "/internal-note") return next();
  try {
    const payment = await prisma.bookingPayment.findUnique({ where: { booking_request_id: req.params.id } });
    if (payment) return res.status(409).json({ error: "Cette demande est liée à un paiement en ligne. Son suivi est automatique ; contactez le client avant toute modification.", code: "online_payment_locked" });
    next();
  } catch (error) { next(error); }
});

router.get("/", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const q = String(req.query.q ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const giteId = String(req.query.gite_id ?? "").trim();
    const from = String(req.query.from ?? "").trim();
    const to = String(req.query.to ?? "").trim();

    const where: any = {};
    if (status) where.status = status;
    if (giteId) where.gite_id = giteId;
    if (from || to) {
      where.date_entree = {};
      if (from) where.date_entree.gte = new Date(`${from}T00:00:00Z`);
      if (to) where.date_entree.lte = new Date(`${to}T23:59:59Z`);
    }
    if (q) {
      where.OR = [
        { hote_nom: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { telephone: { contains: q, mode: "insensitive" } },
      ];
    }

    const requests = await prisma.bookingRequest.findMany({
      where,
      include: bookingRequestInclude,
      orderBy: [{ createdAt: "desc" }],
    });

    res.json(requests.map(toBookingRequestPayload));
  } catch (error) {
    next(error);
  }
});

router.get("/pending/count", async (_req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const count = await prisma.bookingRequest.count({ where: { status: "pending" } });
    res.json({ count });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }
    res.json(toBookingRequestPayload(bookingRequest));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/dates", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const payload = dateUpdateSchema.parse(req.body ?? {});
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }

    ensureBookingRequestPending(bookingRequest);

    const dateEntree = parseBookedDateInput(payload.date_entree, "date d'entrée");
    const dateSortie = parseBookedDateInput(payload.date_sortie, "date de sortie");

    await assertBookedAvailability({
      giteId: bookingRequest.gite_id,
      dateEntree,
      dateSortie,
      excludeBookingRequestId: bookingRequest.id,
    });

    const gite = await prisma.gite.findUnique({
      where: { id: bookingRequest.gite_id },
      select: quoteGiteSelect,
    });
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const options = fromJsonString<OptionsInput>(bookingRequest.options, {});
    const pricingSnapshot = await computeBookedQuote({
      gite,
      dateEntree,
      dateSortie,
      nbAdultes: bookingRequest.nb_adultes,
      nbEnfants: bookingRequest.nb_enfants_2_17,
      options,
      excludeBookingRequestId: bookingRequest.id,
    });

    const updated = await prisma.bookingRequest.update({
      where: { id: bookingRequest.id },
      data: {
        date_entree: dateEntree,
        date_sortie: dateSortie,
        nb_nuits: pricingSnapshot.nb_nuits,
        pricing_snapshot: encodeBookingRequestPricingSnapshot(pricingSnapshot),
      },
      include: bookingRequestInclude,
    });

    return res.json(toBookingRequestPayload(updated));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/:id/options", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const payload = optionsUpdateSchema.parse(req.body ?? {});
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) return res.status(404).json({ error: "Demande introuvable." });
    ensureBookingRequestPending(bookingRequest);
    const gite = await prisma.gite.findUnique({ where: { id: bookingRequest.gite_id }, select: quoteGiteSelect });
    if (!gite) return res.status(404).json({ error: "Gîte introuvable." });

    const previous = fromJsonString<OptionsInput>(bookingRequest.options, {});
    const options: OptionsInput = { ...previous, ...payload.options };
    for (const key of ["draps", "linge_toilette", "menage", "depart_tardif", "chiens"] as const) {
      if (payload.options[key]) options[key] = { ...previous[key], ...payload.options[key] };
    }
    const revised = reviseBookingRequestOptions({
      gite, options,
      quote: fromJsonString<BookingQuote>(bookingRequest.pricing_snapshot, {} as BookingQuote),
      nbAdultes: bookingRequest.nb_adultes,
    });
    const updated = await prisma.bookingRequest.update({
      where: {
        id: bookingRequest.id,
        status: "pending",
        hold_expires_at: { gt: new Date() },
        updatedAt: bookingRequest.updatedAt,
      },
      data: { options: encodeJsonField(revised.options), pricing_snapshot: encodeBookingRequestPricingSnapshot(revised.quote) },
      include: bookingRequestInclude,
    });
    return res.json(toBookingRequestPayload(updated));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(error);
  }
});

router.post("/:id/refresh", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }
    if (bookingRequest.status !== "expired") {
      throw new BookedValidationError({
        code: "invalid_status",
        message: "Seule une demande expirée peut être réactivée.",
        statusCode: 409,
      });
    }

    await assertBookedAvailability({
      giteId: bookingRequest.gite_id,
      dateEntree: bookingRequest.date_entree,
      dateSortie: bookingRequest.date_sortie,
      excludeBookingRequestId: bookingRequest.id,
    });

    const gite = await prisma.gite.findUnique({
      where: { id: bookingRequest.gite_id },
      select: quoteGiteSelect,
    });
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const options = fromJsonString<OptionsInput>(bookingRequest.options, {});
    const pricingSnapshot = await computeBookedQuote({
      gite,
      dateEntree: bookingRequest.date_entree,
      dateSortie: bookingRequest.date_sortie,
      nbAdultes: bookingRequest.nb_adultes,
      nbEnfants: bookingRequest.nb_enfants_2_17,
      options,
      excludeBookingRequestId: bookingRequest.id,
    });

    const updated = await prisma.bookingRequest.update({
      where: { id: bookingRequest.id },
      data: {
        status: "pending",
        hold_expires_at: getBookingRequestHoldExpiresAt(),
        decided_at: null,
        decision_note: null,
        nb_nuits: pricingSnapshot.nb_nuits,
        pricing_snapshot: encodeBookingRequestPricingSnapshot(pricingSnapshot),
      },
      include: bookingRequestInclude,
    });

    return res.json(toBookingRequestPayload(updated));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/:id/internal-note", async (req, res, next) => {
  try {
    const { internal_note } = internalNoteSchema.parse(req.body ?? {});
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }
    if (bookingRequest.status === "approved") {
      throw new BookedValidationError({
        code: "invalid_status",
        message: "La réservation est déjà créée. Modifiez sa note depuis la page Réservations.",
        statusCode: 409,
      });
    }

    const updated = await prisma.bookingRequest.update({
      where: { id: bookingRequest.id },
      data: { internal_note: internal_note || null },
      include: bookingRequestInclude,
    });
    return res.json(toBookingRequestPayload(updated));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/:id/approve", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const { decision_note, internal_note, email } = decisionSchema.parse(req.body ?? {});
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }

    ensureBookingRequestPending(bookingRequest);
    const resolvedInternalNote =
      internal_note === undefined ? String(bookingRequest.internal_note ?? "").trim() : internal_note;

    await assertBookedAvailability({
      giteId: bookingRequest.gite_id,
      dateEntree: bookingRequest.date_entree,
      dateSortie: bookingRequest.date_sortie,
      excludeBookingRequestId: bookingRequest.id,
    });

    const updated = await prisma.$transaction(async (tx) => {
      await lockBookingGite(tx, bookingRequest.gite_id);
      await assertTransactionAvailability(tx, bookingRequest);
      const reservation = await tx.reservation.create({ data: bookingReservationData(bookingRequest, resolvedInternalNote) });

      return tx.bookingRequest.update({
        where: { id: bookingRequest.id, status: "pending", updatedAt: bookingRequest.updatedAt, hold_expires_at: { gt: new Date() } },
        data: {
          status: "approved",
          decided_at: new Date(),
          decision_note: decision_note || null,
          internal_note: resolvedInternalNote || null,
          approved_reservation_id: reservation.id,
        },
        include: bookingRequestInclude,
      });
    });

    const approvedPayload = toBookingRequestPayload(updated);
    let emailSent = false;
    try {
      emailSent = await sendBookingRequestApprovedEmail(approvedPayload, email);
    } catch (emailError) {
      console.error("[booked] booking request approval email failed:", emailError);
    }
    if (emailSent && updated.telephone?.trim()) {
      try {
        await sendOvhSms({
          recipient: updated.telephone,
          message: buildBookingRequestApprovedSms(approvedPayload),
        });
      } catch (smsError) {
        console.error("[booked] booking request approval SMS failed:", smsError);
      }
    }

    try {
      await notifyBookingRequestApprovedOnTelegram(approvedPayload);
    } catch (telegramError) {
      console.error("[booked] booking request approval Telegram notification failed:", telegramError);
    }

    return res.json(approvedPayload);
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/:id/reject", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const { decision_note, internal_note } = decisionSchema.parse(req.body ?? {});
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }

    ensureBookingRequestPending(bookingRequest);
    const resolvedInternalNote =
      internal_note === undefined ? String(bookingRequest.internal_note ?? "").trim() : internal_note;

    const updated = await prisma.bookingRequest.update({
      where: { id: bookingRequest.id },
      data: {
        status: "rejected",
        decided_at: new Date(),
        decision_note: decision_note || null,
        internal_note: resolvedInternalNote || null,
      },
      include: bookingRequestInclude,
    });

    try {
      await sendBookingRequestRejectedEmail(toBookingRequestPayload(updated), decision_note);
    } catch (emailError) {
      console.error("[booked] booking request rejection email failed:", emailError);
    }

    return res.json(toBookingRequestPayload(updated));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

export default router;
