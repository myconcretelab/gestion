import { differenceInCalendarDays } from "date-fns";
import { toNumber, round2 } from "../utils/money.js";
import { Prisma } from "@prisma/client";

export type OptionsInput = {
  draps?: { enabled: boolean; nb_lits?: number; offert?: boolean };
  linge_toilette?: { enabled: boolean; nb_personnes?: number; offert?: boolean };
  menage?: { enabled: boolean; offert?: boolean };
  depart_tardif?: { enabled: boolean; offert?: boolean };
  chiens?: { enabled: boolean; nb?: number; offert?: boolean };
  regle_animaux_acceptes?: boolean;
  regle_bois_premiere_flambee?: boolean;
  regle_tiers_personnes_info?: boolean;
};

export type ClauseInput = Record<string, unknown>;

export type ContractTotals = {
  nbNuits: number;
  montantBase: number;
  totalSansOptions: number;
  optionsTotal: number;
  taxeSejourCalculee: number;
  solde: number;
  totalGlobal: number;
  optionsDetail: {
    draps: number;
    linge: number;
    menage: number;
    departTardif: number;
    chiens: number;
  };
};

export type GitePricing = {
  taxe_sejour_par_personne_par_nuit: Prisma.Decimal | number | string;
  options_draps_par_lit: Prisma.Decimal | number | string;
  options_linge_toilette_par_personne: Prisma.Decimal | number | string;
  options_menage_forfait: Prisma.Decimal | number | string;
  options_depart_tardif_forfait: Prisma.Decimal | number | string;
  options_chiens_forfait: Prisma.Decimal | number | string;
};

export const computeTotals = (params: {
  dateDebut: Date;
  dateFin: Date;
  prixParNuit: number;
  remiseMontant: number;
  nbAdultes: number;
  nbEnfants: number;
  arrhesMontant: number;
  options: OptionsInput;
  gite: GitePricing;
}): ContractTotals => {
  const nbNuits = Math.max(1, differenceInCalendarDays(params.dateFin, params.dateDebut));
  const montantBase = round2(nbNuits * params.prixParNuit);
  const totalSansOptions = round2(montantBase - params.remiseMontant);

  const drapsTarif = toNumber(params.gite.options_draps_par_lit);
  const lingeTarif = toNumber(params.gite.options_linge_toilette_par_personne);
  const menageTarif = toNumber(params.gite.options_menage_forfait);
  const departTardifTarif = toNumber(params.gite.options_depart_tardif_forfait);
  const chiensTarif = toNumber(params.gite.options_chiens_forfait);

  const draps = params.options.draps?.enabled
    ? params.options.draps?.offert
      ? 0
      : round2(drapsTarif * (params.options.draps?.nb_lits ?? 0))
    : 0;
  const linge = params.options.linge_toilette?.enabled
    ? params.options.linge_toilette?.offert
      ? 0
      : round2(lingeTarif * (params.options.linge_toilette?.nb_personnes ?? 0))
    : 0;
  const menage = params.options.menage?.enabled ? (params.options.menage?.offert ? 0 : round2(menageTarif)) : 0;
  const departTardif = params.options.depart_tardif?.enabled
    ? params.options.depart_tardif?.offert
      ? 0
      : round2(departTardifTarif)
    : 0;
  const chiens = params.options.chiens?.enabled
    ? params.options.chiens?.offert
      ? 0
      : round2(chiensTarif * (params.options.chiens?.nb ?? 1) * nbNuits)
    : 0;

  const optionsTotal = round2(draps + linge + menage + departTardif + chiens);

  const taxeTarif = toNumber(params.gite.taxe_sejour_par_personne_par_nuit);
  const nbPersonnes = params.nbAdultes + params.nbEnfants;
  const taxeSejourCalculee = round2(nbPersonnes * nbNuits * taxeTarif);

  const solde = round2(totalSansOptions - params.arrhesMontant);
  const totalGlobal = round2(totalSansOptions + optionsTotal);

  return {
    nbNuits,
    montantBase,
    totalSansOptions,
    optionsTotal,
    taxeSejourCalculee,
    solde,
    totalGlobal,
    optionsDetail: {
      draps,
      linge,
      menage,
      departTardif,
      chiens,
    },
  };
};
