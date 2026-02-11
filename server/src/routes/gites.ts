import { Router } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import prisma from "../db/prisma.js";
import { fromJsonString, encodeJsonField } from "../utils/jsonFields.js";

const router = Router();

const giteSchema = z.object({
  nom: z.string().min(1),
  prefixe_contrat: z.string().min(2),
  adresse_ligne1: z.string().min(1),
  adresse_ligne2: z.string().optional().nullable(),
  capacite_max: z.number().int().min(1),
  proprietaires_noms: z.string().min(1),
  proprietaires_adresse: z.string().min(1),
  site_web: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  caracteristiques: z.string().optional().nullable(),
  telephones: z.array(z.string()).default([]),
  taxe_sejour_par_personne_par_nuit: z.number().min(0),
  iban: z.string().min(1),
  bic: z.string().optional().nullable(),
  titulaire: z.string().min(1),
  regle_animaux_acceptes: z.boolean().default(false),
  regle_bois_premiere_flambee: z.boolean().default(false),
  regle_tiers_personnes_info: z.boolean().default(false),
  options_draps_par_lit: z.number().min(0).default(0),
  options_linge_toilette_par_personne: z.number().min(0).default(0),
  options_menage_forfait: z.number().min(0).default(0),
  options_depart_tardif_forfait: z.number().min(0).default(0),
  options_chiens_forfait: z.number().min(0).default(0),
  caution_montant_defaut: z.number().min(0).default(0),
  cheque_menage_montant_defaut: z.number().min(0).default(0),
  arrhes_taux_defaut: z.number().min(0).max(1).default(0.2),
  prix_nuit_liste: z.array(z.number().min(0)).optional().default([]),
});

const hydrateGite = (gite: any) => {
  const { _count, ...rest } = gite ?? {};
  return {
    ...rest,
    telephones: fromJsonString<string[]>(gite.telephones, []),
    prix_nuit_liste: fromJsonString<number[]>(gite.prix_nuit_liste, []),
    contrats_count: typeof _count?.contrats === "number" ? _count.contrats : gite.contrats_count,
  };
};

router.get("/", async (_req, res, next) => {
  try {
    const gites = await prisma.gite.findMany({
      orderBy: { nom: "asc" },
      include: { _count: { select: { contrats: true } } },
    });
    res.json(gites.map(hydrateGite));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const gite = await prisma.gite.findUnique({ where: { id: req.params.id } });
    if (!gite) return res.status(404).json({ error: "Gite introuvable" });
    res.json(hydrateGite(gite));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = giteSchema.parse(req.body);
    const gite = await prisma.gite.create({
      data: {
        ...parsed,
        telephones: encodeJsonField(parsed.telephones),
        prix_nuit_liste: encodeJsonField(parsed.prix_nuit_liste),
      },
    });
    res.status(201).json(hydrateGite(gite));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const parsed = giteSchema.parse(req.body);
    const gite = await prisma.gite.update({
      where: { id: req.params.id },
      data: {
        ...parsed,
        telephones: encodeJsonField(parsed.telephones),
        prix_nuit_liste: encodeJsonField(parsed.prix_nuit_liste),
      },
    });
    res.json(hydrateGite(gite));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/duplicate", async (req, res, next) => {
  try {
    const existing = await prisma.gite.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Gite introuvable" });

    const prefixes = await prisma.gite.findMany({ select: { prefixe_contrat: true } });
    const prefixSet = new Set(prefixes.map((p) => p.prefixe_contrat));
    const basePrefix = existing.prefixe_contrat;
    let suffix = 2;
    let nextPrefix = `${basePrefix}${suffix}`;
    while (prefixSet.has(nextPrefix)) {
      suffix += 1;
      nextPrefix = `${basePrefix}${suffix}`;
    }

    const duplicated = await prisma.gite.create({
      data: {
        nom: `${existing.nom} (copie)`,
        prefixe_contrat: nextPrefix,
        adresse_ligne1: existing.adresse_ligne1,
        adresse_ligne2: existing.adresse_ligne2,
        capacite_max: existing.capacite_max,
        proprietaires_noms: existing.proprietaires_noms,
        proprietaires_adresse: existing.proprietaires_adresse,
        site_web: existing.site_web,
        email: existing.email,
        caracteristiques: existing.caracteristiques,
        telephones: encodeJsonField(fromJsonString<string[]>(existing.telephones, [])),
        taxe_sejour_par_personne_par_nuit: existing.taxe_sejour_par_personne_par_nuit,
        iban: existing.iban,
        bic: existing.bic,
        titulaire: existing.titulaire,
        regle_animaux_acceptes: existing.regle_animaux_acceptes,
        regle_bois_premiere_flambee: existing.regle_bois_premiere_flambee,
        regle_tiers_personnes_info: existing.regle_tiers_personnes_info,
        options_draps_par_lit: existing.options_draps_par_lit,
        options_linge_toilette_par_personne: existing.options_linge_toilette_par_personne,
        options_menage_forfait: existing.options_menage_forfait,
        options_depart_tardif_forfait: existing.options_depart_tardif_forfait,
        options_chiens_forfait: existing.options_chiens_forfait,
        caution_montant_defaut: existing.caution_montant_defaut,
        cheque_menage_montant_defaut: existing.cheque_menage_montant_defaut,
        arrhes_taux_defaut: existing.arrhes_taux_defaut,
        prix_nuit_liste: encodeJsonField(fromJsonString<number[]>(existing.prix_nuit_liste, [])),
      },
    });

    res.status(201).json(hydrateGite(duplicated));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const giteId = req.params.id;
    const existing = await prisma.gite.findUnique({ where: { id: giteId } });
    if (!existing) return res.status(404).json({ error: "Gite introuvable" });

    const contrats = await prisma.contrat.findMany({
      where: { gite_id: giteId },
      select: { id: true, pdf_path: true },
    });

    await prisma.$transaction([
      prisma.contrat.deleteMany({ where: { gite_id: giteId } }),
      prisma.contratCounter.deleteMany({ where: { giteId } }),
      prisma.gite.delete({ where: { id: giteId } }),
    ]);

    await Promise.all(
      contrats.map((contrat) =>
        fs.unlink(path.join(process.cwd(), contrat.pdf_path)).catch(() => undefined)
      )
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
