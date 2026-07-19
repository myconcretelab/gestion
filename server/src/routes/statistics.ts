import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import {
  importLegacyRevenueWorkbook,
  LegacyRevenueConflictError,
} from "../services/legacyRevenueDatabaseImport.js";
import { readLegacyRevenueWorkbook } from "../services/legacyRevenueImport.js";
import { buildStatisticsPayload } from "../services/statistics.js";
import { toNumber } from "../utils/money.js";

const router = Router();
const legacyRevenueImportSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  data: z.string().min(1),
  apply: z.boolean().default(false),
  allowExistingConflicts: z.boolean().default(false),
});

const hydrateStatisticsReservation = (reservation: any) => ({
  ...reservation,
  prix_par_nuit: toNumber(reservation.prix_par_nuit),
  prix_total: toNumber(reservation.prix_total),
  frais_optionnels_montant: toNumber(reservation.frais_optionnels_montant),
});

router.post("/legacy-revenue-import", async (req, res, next) => {
  try {
    const payload = legacyRevenueImportSchema.parse(req.body);
    if (!payload.filename.toLowerCase().endsWith(".xlsx")) {
      return res.status(400).json({ error: "Le fichier doit être au format .xlsx." });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data)) {
      return res.status(400).json({ error: "Le contenu du fichier est invalide." });
    }

    const workbook = Buffer.from(payload.data, "base64");
    if (workbook.length === 0 || workbook.length > 12 * 1024 * 1024) {
      return res.status(400).json({ error: "Le fichier doit peser moins de 12 Mo." });
    }

    const parsed = await readLegacyRevenueWorkbook(workbook);
    const report = await importLegacyRevenueWorkbook(parsed, {
      apply: payload.apply,
      allowExistingConflicts: payload.apply && payload.allowExistingConflicts,
    });
    return res.json(report);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Requête d'import invalide.", details: error.flatten() });
    }
    if (error instanceof LegacyRevenueConflictError) {
      return res.status(409).json({ error: error.message, details: { report: error.report } });
    }
    if (error instanceof Error && /classeur|feuille|format attendu|aucun séjour|gîte.*introuvable/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
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
          date_debut_activite: true,
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
