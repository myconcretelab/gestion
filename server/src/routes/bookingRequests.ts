import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import {
  BookedValidationError,
  assertBookedAvailability,
  ensureBookingRequestPending,
  expireStaleBookingRequests,
  formatBookedDateInput,
  hydrateBookingRequest,
  type BookingQuote,
} from "../services/booked.js";
import { sendBookingRequestApprovedEmail, sendBookingRequestRejectedEmail } from "../services/bookingRequestEmail.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";
import { buildReservationOriginData } from "../utils/reservationOrigin.js";
import { round2 } from "../utils/money.js";
import type { OptionsInput } from "../services/contractCalculator.js";

const router = Router();

const decisionSchema = z.object({
  decision_note: z.string().trim().optional().default(""),
});

const buildOptionalFeesLabel = (options: OptionsInput) => {
  const labels: string[] = [];
  if (options.draps?.enabled) labels.push("Draps");
  if (options.linge_toilette?.enabled) labels.push("Linge");
  if (options.menage?.enabled) labels.push("Ménage");
  if (options.depart_tardif?.enabled) labels.push("Départ tardif");
  if (options.chiens?.enabled) labels.push("Chiens");
  return labels.join(" · ") || null;
};

const mapBookedError = (error: unknown) => {
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
    include: {
      gite: {
        select: {
          id: true,
          nom: true,
          email: true,
        },
      },
      approved_reservation: {
        select: {
          id: true,
          hote_nom: true,
          date_entree: true,
          date_sortie: true,
        },
      },
    },
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
      include: {
        gite: {
          select: {
            id: true,
            nom: true,
            email: true,
          },
        },
        approved_reservation: {
          select: {
            id: true,
            hote_nom: true,
            date_entree: true,
            date_sortie: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    res.json(requests.map(toBookingRequestPayload));
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

router.post("/:id/approve", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const { decision_note } = decisionSchema.parse(req.body ?? {});
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }

    ensureBookingRequestPending(bookingRequest);

    await assertBookedAvailability({
      giteId: bookingRequest.gite_id,
      dateEntree: bookingRequest.date_entree,
      dateSortie: bookingRequest.date_sortie,
      excludeBookingRequestId: bookingRequest.id,
    });

    const hydrated = toBookingRequestPayload(bookingRequest);
    const pricingSnapshot = hydrated.pricing_snapshot as BookingQuote;
    const options = fromJsonString<OptionsInput>(bookingRequest.options, {});
    const averageNightly = pricingSnapshot.nb_nuits > 0
      ? round2(pricingSnapshot.montant_hebergement / pricingSnapshot.nb_nuits)
      : 0;
    const stayGroupId = crypto.randomUUID();

    const updated = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: {
          gite_id: bookingRequest.gite_id,
          stay_group_id: stayGroupId,
          placeholder_id: null,
          ...buildReservationOriginData({
            originSystem: "booked",
            originReference: bookingRequest.id,
            exportToIcal: true,
          }),
          airbnb_url: null,
          hote_nom: bookingRequest.hote_nom,
          telephone: bookingRequest.telephone ?? null,
          email: bookingRequest.email ?? null,
          date_entree: bookingRequest.date_entree,
          date_sortie: bookingRequest.date_sortie,
          nb_nuits: bookingRequest.nb_nuits,
          nb_adultes: bookingRequest.nb_adultes,
          nb_enfants_2_17: bookingRequest.nb_enfants_2_17,
          prix_par_nuit: averageNightly,
          prix_total: pricingSnapshot.montant_hebergement,
          source_paiement: "A définir",
          commentaire: bookingRequest.message_client ?? null,
          remise_montant: 0,
          commission_channel_mode: "euro",
          commission_channel_value: 0,
          frais_optionnels_montant: pricingSnapshot.total_options,
          frais_optionnels_libelle: buildOptionalFeesLabel(options),
          frais_optionnels_declares: pricingSnapshot.total_options > 0,
          options: encodeJsonField(options),
        },
      });

      return tx.bookingRequest.update({
        where: { id: bookingRequest.id },
        data: {
          status: "approved",
          decided_at: new Date(),
          decision_note: decision_note || null,
          approved_reservation_id: reservation.id,
        },
        include: {
          gite: {
            select: {
              id: true,
              nom: true,
              email: true,
            },
          },
          approved_reservation: {
            select: {
              id: true,
              hote_nom: true,
              date_entree: true,
              date_sortie: true,
            },
          },
        },
      });
    });

    try {
      await sendBookingRequestApprovedEmail(toBookingRequestPayload(updated));
    } catch (emailError) {
      console.error("[booked] booking request approval email failed:", emailError);
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

router.post("/:id/reject", async (req, res, next) => {
  try {
    await expireStaleBookingRequests();
    const { decision_note } = decisionSchema.parse(req.body ?? {});
    const bookingRequest = await loadBookingRequest(req.params.id);
    if (!bookingRequest) {
      return res.status(404).json({ error: "Demande introuvable." });
    }

    ensureBookingRequestPending(bookingRequest);

    const updated = await prisma.bookingRequest.update({
      where: { id: bookingRequest.id },
      data: {
        status: "rejected",
        decided_at: new Date(),
        decision_note: decision_note || null,
      },
      include: {
        gite: {
          select: {
            id: true,
            nom: true,
            email: true,
          },
        },
        approved_reservation: {
          select: {
            id: true,
            hote_nom: true,
            date_entree: true,
            date_sortie: true,
          },
        },
      },
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
