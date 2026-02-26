import fs from "fs/promises";
import { z } from "zod";
import type { OptionsInput } from "../../services/contractCalculator.js";
import { fromJsonString } from "../../utils/jsonFields.js";

export const optionsSchema = z.object({
  draps: z
    .object({
      enabled: z.boolean(),
      nb_lits: z.number().int().min(0).optional(),
      offert: z.boolean().optional(),
    })
    .optional(),
  linge_toilette: z
    .object({
      enabled: z.boolean(),
      nb_personnes: z.number().int().min(0).optional(),
      offert: z.boolean().optional(),
    })
    .optional(),
  menage: z.object({ enabled: z.boolean(), offert: z.boolean().optional() }).optional(),
  depart_tardif: z.object({ enabled: z.boolean(), offert: z.boolean().optional() }).optional(),
  chiens: z
    .object({ enabled: z.boolean(), nb: z.number().int().min(0).optional(), offert: z.boolean().optional() })
    .optional(),
  regle_animaux_acceptes: z.boolean().optional(),
  regle_bois_premiere_flambee: z.boolean().optional(),
  regle_tiers_personnes_info: z.boolean().optional(),
});

export const optionalDateString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}, z.string().optional());

type GiteRules = {
  regle_animaux_acceptes: boolean;
  regle_bois_premiere_flambee: boolean;
  regle_tiers_personnes_info: boolean;
};

const resolveContractRules = (options: OptionsInput, gite: GiteRules) => ({
  regle_animaux_acceptes: options.regle_animaux_acceptes ?? gite.regle_animaux_acceptes,
  regle_bois_premiere_flambee: options.regle_bois_premiere_flambee ?? gite.regle_bois_premiere_flambee,
  regle_tiers_personnes_info: options.regle_tiers_personnes_info ?? gite.regle_tiers_personnes_info,
});

export const normalizeOptions = (options: OptionsInput, gite: GiteRules): OptionsInput => {
  const regles = resolveContractRules(options, gite);
  const next: OptionsInput = { ...options, ...regles };
  if (!regles.regle_animaux_acceptes) {
    next.chiens = { ...next.chiens, enabled: false, offert: false, nb: 0 };
  }
  return next;
};

export const parseDate = (value: string) => new Date(value);

export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const ensureValidDate = (value: Date, label: string) => {
  if (Number.isNaN(value.getTime())) throw new Error(`Date invalide: ${label}`);
};

export const hydrateGite = (gite: any) => ({
  ...gite,
  telephones: fromJsonString<string[]>(gite.telephones, []),
  prix_nuit_liste: fromJsonString<number[]>(gite.prix_nuit_liste, []),
});

export const getLatestTemplateMtimeMs = async (templatePaths: string[]) => {
  const stats = await Promise.all(templatePaths.map((templatePath) => fs.stat(templatePath).catch(() => null)));
  return stats.reduce((maxMtime, stat) => Math.max(maxMtime, stat?.mtimeMs ?? 0), 0);
};

export const buildDocumentListWhere = (params: {
  q: string;
  giteId?: string;
  numero: string;
  from?: string;
  to?: string;
  numeroField: "numero_contrat" | "numero_facture";
}) => {
  const where: any = {};

  if (params.giteId) where.gite_id = params.giteId;

  if (params.q) {
    where.OR = [
      { locataire_nom: { contains: params.q, mode: "insensitive" } },
      { [params.numeroField]: { contains: params.q, mode: "insensitive" } },
    ];
  }

  if (params.numero) {
    where[params.numeroField] = { contains: params.numero, mode: "insensitive" };
  }

  if (params.from || params.to) {
    where.date_debut = {};
    if (params.from) where.date_debut.gte = new Date(params.from);
    if (params.to) where.date_debut.lte = new Date(params.to);
  }

  return where;
};
