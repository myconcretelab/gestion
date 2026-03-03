import { Router } from "express";
import prisma from "../db/prisma.js";
import { buildStatisticsPayload } from "../services/statistics.js";
import { toNumber } from "../utils/money.js";

const router = Router();

const hydrateStatisticsReservation = (reservation: any) => ({
  ...reservation,
  prix_par_nuit: toNumber(reservation.prix_par_nuit),
  prix_total: toNumber(reservation.prix_total),
  frais_optionnels_montant: toNumber(reservation.frais_optionnels_montant),
});

router.get("/", async (_req, res, next) => {
  try {
    const [gites, rawReservations] = await Promise.all([
      prisma.gite.findMany({
        select: {
          id: true,
          nom: true,
          ordre: true,
          prefixe_contrat: true,
          proprietaires_noms: true,
          gestionnaire_id: true,
          gestionnaire: {
            select: {
              id: true,
              prenom: true,
              nom: true,
            },
          },
        },
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      }),
      prisma.reservation.findMany({
        where: { gite_id: { not: null } },
        select: {
          id: true,
          gite_id: true,
          date_entree: true,
          date_sortie: true,
          nb_nuits: true,
          nb_adultes: true,
          prix_par_nuit: true,
          prix_total: true,
          source_paiement: true,
          frais_optionnels_montant: true,
          frais_optionnels_declares: true,
        },
        orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const reservations = rawReservations.map(hydrateStatisticsReservation);

    res.json(
      buildStatisticsPayload({
        gites,
        reservations,
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
