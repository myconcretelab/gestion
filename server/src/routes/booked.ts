import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { optionsSchema } from "./shared/rentalDocument.js";
import {
  assertBookedAvailability,
  computeSeasonQuote,
  encodeBookingRequestOptions,
  encodeBookingRequestPricingSnapshot,
  expireStaleBookingRequests,
  formatBookedDateInput,
  getBookingRequestHoldExpiresAt,
  hydrateBookingRequest,
  hydrateSeasonRate,
  loadBookedConflicts,
  loadSeasonRatesForGite,
  parseBookedDateInput,
  type BookedValidationError,
} from "../services/booked.js";
import { sendBookingRequestCreatedEmails } from "../services/bookingRequestEmail.js";

const router = Router();

const emptyStringToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const quoteSchema = z.object({
  date_entree: z.string().trim().min(1),
  date_sortie: z.string().trim().min(1),
  nb_adultes: z.coerce.number().int().min(1),
  nb_enfants_2_17: z.coerce.number().int().min(0).default(0),
  options: optionsSchema.optional().default({}),
});

const bookingRequestCreateSchema = quoteSchema.extend({
  gite_id: z.string().trim().min(1),
  hote_nom: z.string().trim().min(1),
  telephone: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
  email: z.preprocess(emptyStringToNull, z.string().trim().email().nullable()).optional(),
  message_client: z.preprocess(emptyStringToNull, z.string().trim().nullable()).optional(),
});

const mapBookedError = (error: unknown) => {
  if (error instanceof Error && "statusCode" in error && "code" in error) {
    const bookedError = error as BookedValidationError & { details?: Record<string, unknown> };
    return {
      status: bookedError.statusCode,
      body: {
        error: bookedError.message,
        code: bookedError.code,
        details: bookedError.details,
      },
    };
  }

  return null;
};

const loadPublicGite = async (giteId: string) =>
  prisma.gite.findUnique({
    where: { id: giteId },
    select: {
      id: true,
      nom: true,
      capacite_max: true,
      nb_adultes_max: true,
      nb_enfants_max: true,
      email: true,
      arrhes_taux_defaut: true,
      taxe_sejour_par_personne_par_nuit: true,
      options_draps_par_lit: true,
      options_linge_toilette_par_personne: true,
      options_menage_forfait: true,
      options_depart_tardif_forfait: true,
      options_chiens_forfait: true,
      regle_animaux_acceptes: true,
      regle_bois_premiere_flambee: true,
      regle_tiers_personnes_info: true,
    },
  });

router.get("/gites", async (_req, res, next) => {
  try {
    const gites = await prisma.gite.findMany({
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      select: {
        id: true,
        nom: true,
        capacite_max: true,
      },
    });

    res.json({
      gites: gites.map((gite) => ({
        id: gite.id,
        nom: gite.nom,
        capacite_max: gite.capacite_max,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/gites/:id/config", async (req, res, next) => {
  try {
    const gite = await loadPublicGite(req.params.id);
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    res.json({
      id: gite.id,
      nom: gite.nom,
      capacite_max: gite.capacite_max,
      nb_adultes_max: gite.nb_adultes_max,
      nb_enfants_max: gite.nb_enfants_max,
      rules: {
        regle_animaux_acceptes: gite.regle_animaux_acceptes,
        regle_bois_premiere_flambee: gite.regle_bois_premiere_flambee,
        regle_tiers_personnes_info: gite.regle_tiers_personnes_info,
      },
      options: {
        draps: { enabled: true, prix_unitaire: Number(gite.options_draps_par_lit) || 0 },
        linge_toilette: { enabled: true, prix_unitaire: Number(gite.options_linge_toilette_par_personne) || 0 },
        menage: { enabled: true, prix_forfait: Number(gite.options_menage_forfait) || 0 },
        depart_tardif: { enabled: true, prix_forfait: Number(gite.options_depart_tardif_forfait) || 0 },
        chiens: {
          enabled: Boolean(gite.regle_animaux_acceptes),
          prix_unitaire: Number(gite.options_chiens_forfait) || 0,
        },
      },
      taxe_sejour_par_personne_par_nuit: Number(gite.taxe_sejour_par_personne_par_nuit) || 0,
      arrhes_taux_defaut: Number(gite.arrhes_taux_defaut) || 0,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/gites/:id/availability", async (req, res, next) => {
  try {
    const gite = await loadPublicGite(req.params.id);
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const from = req.query.from ? parseBookedDateInput(String(req.query.from), "from") : today;
    const to = req.query.to ? parseBookedDateInput(String(req.query.to), "to") : new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);

    await expireStaleBookingRequests();
    const [reservationBlocks, bookingRequestBlocks, seasonRates] = await Promise.all([
      prisma.reservation.findMany({
        where: {
          gite_id: gite.id,
          date_entree: { lt: to },
          date_sortie: { gt: from },
        },
        orderBy: { date_entree: "asc" },
        select: {
          id: true,
          hote_nom: true,
          date_entree: true,
          date_sortie: true,
        },
      }),
      prisma.bookingRequest.findMany({
        where: {
          gite_id: gite.id,
          status: "pending",
          hold_expires_at: { gt: new Date() },
          date_entree: { lt: to },
          date_sortie: { gt: from },
        },
        orderBy: { date_entree: "asc" },
        select: {
          id: true,
          hote_nom: true,
          date_entree: true,
          date_sortie: true,
          hold_expires_at: true,
        },
      }),
      loadSeasonRatesForGite(gite.id),
    ]);

    res.json({
      from: formatBookedDateInput(from),
      to: formatBookedDateInput(to),
      blocked_ranges: [
        ...reservationBlocks.map((item) => ({
          type: "reservation",
          id: item.id,
          hote_nom: item.hote_nom,
          date_entree: item.date_entree,
          date_sortie: item.date_sortie,
        })),
        ...bookingRequestBlocks.map((item) => ({
          type: "booking_request",
          id: item.id,
          hote_nom: item.hote_nom,
          date_entree: item.date_entree,
          date_sortie: item.date_sortie,
          hold_expires_at: item.hold_expires_at,
        })),
      ],
      season_ranges: seasonRates.map(hydrateSeasonRate),
    });
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/gites/:id/quote", async (req, res, next) => {
  try {
    const gite = await loadPublicGite(req.params.id);
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const payload = quoteSchema.parse(req.body ?? {});
    const dateEntree = parseBookedDateInput(payload.date_entree, "date_entree");
    const dateSortie = parseBookedDateInput(payload.date_sortie, "date_sortie");

    await assertBookedAvailability({
      giteId: gite.id,
      dateEntree,
      dateSortie,
    });

    const quote = await computeSeasonQuote({
      gite,
      dateEntree,
      dateSortie,
      nbAdultes: payload.nb_adultes,
      nbEnfants: payload.nb_enfants_2_17,
      options: payload.options,
    });

    res.json(quote);
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.post("/requests", async (req, res, next) => {
  try {
    const payload = bookingRequestCreateSchema.parse(req.body ?? {});
    const gite = await loadPublicGite(payload.gite_id);
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const dateEntree = parseBookedDateInput(payload.date_entree, "date_entree");
    const dateSortie = parseBookedDateInput(payload.date_sortie, "date_sortie");

    await assertBookedAvailability({
      giteId: gite.id,
      dateEntree,
      dateSortie,
    });

    const pricingSnapshot = await computeSeasonQuote({
      gite,
      dateEntree,
      dateSortie,
      nbAdultes: payload.nb_adultes,
      nbEnfants: payload.nb_enfants_2_17,
      options: payload.options,
    });

    const created = await prisma.bookingRequest.create({
      data: {
        gite_id: gite.id,
        hote_nom: payload.hote_nom,
        telephone: payload.telephone ?? null,
        email: payload.email ?? null,
        date_entree: dateEntree,
        date_sortie: dateSortie,
        nb_nuits: pricingSnapshot.nb_nuits,
        nb_adultes: payload.nb_adultes,
        nb_enfants_2_17: payload.nb_enfants_2_17,
        options: encodeBookingRequestOptions(payload.options),
        message_client: payload.message_client ?? null,
        pricing_snapshot: encodeBookingRequestPricingSnapshot(pricingSnapshot),
        status: "pending",
        hold_expires_at: getBookingRequestHoldExpiresAt(),
      },
      include: {
        gite: { select: { id: true, nom: true, email: true } },
      },
    });

    try {
      await sendBookingRequestCreatedEmails({
        ...hydrateBookingRequest(created),
        gite: created.gite,
      });
    } catch (emailError) {
      console.error("[booked] booking request email failed:", emailError);
    }

    return res.status(201).json(hydrateBookingRequest(created));
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

router.get("/gites/:id/conflicts", async (req, res, next) => {
  try {
    const dateEntree = parseBookedDateInput(String(req.query.date_entree ?? ""), "date_entree");
    const dateSortie = parseBookedDateInput(String(req.query.date_sortie ?? ""), "date_sortie");
    const conflicts = await loadBookedConflicts({
      giteId: req.params.id,
      dateEntree,
      dateSortie,
    });
    res.json(conflicts);
  } catch (error) {
    const mapped = mapBookedError(error);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    next(error);
  }
});

export default router;
