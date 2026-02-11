import type { ContratOptions, Gite } from "./types";

export type Totals = {
  nbNuits: number;
  montantBase: number;
  totalSansOptions: number;
  optionsTotal: number;
  taxeSejour: number;
  solde: number;
  totalGlobal: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export const computeTotals = (params: {
  dateDebut: string;
  dateFin: string;
  prixParNuit: number;
  remiseMontant: number;
  nbAdultes: number;
  nbEnfants: number;
  arrhesMontant: number;
  options: ContratOptions;
  gite?: Gite | null;
}): Totals => {
  const dateDebut = new Date(params.dateDebut);
  const dateFin = new Date(params.dateFin);
  const hasDateDebut = Boolean(params.dateDebut);
  const hasDateFin = Boolean(params.dateFin);
  const startValid = Number.isFinite(dateDebut.getTime());
  const endValid = Number.isFinite(dateFin.getTime());
  const dayMs = 1000 * 60 * 60 * 24;

  let nbNuits = 0;
  if (startValid && endValid && dateFin > dateDebut) {
    nbNuits = Math.max(1, Math.floor((dateFin.getTime() - dateDebut.getTime()) / dayMs));
  } else if (!hasDateDebut || !hasDateFin) {
    nbNuits = 1;
  }
  const montantBase = round2(nbNuits * params.prixParNuit);
  const totalSansOptions = round2(montantBase - params.remiseMontant);

  const gite = params.gite;
  const drapsTarif = Number(gite?.options_draps_par_lit ?? 0);
  const lingeTarif = Number(gite?.options_linge_toilette_par_personne ?? 0);
  const menageTarif = Number(gite?.options_menage_forfait ?? 0);
  const departTardifTarif = Number(gite?.options_depart_tardif_forfait ?? 0);
  const chiensTarif = Number(gite?.options_chiens_forfait ?? 0);

  const draps = params.options.draps?.enabled
    ? params.options.draps?.offert
      ? 0
      : round2(drapsTarif * (params.options.draps.nb_lits ?? 0))
    : 0;
  const linge = params.options.linge_toilette?.enabled
    ? params.options.linge_toilette?.offert
      ? 0
      : round2(lingeTarif * (params.options.linge_toilette.nb_personnes ?? 0))
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
      : round2(chiensTarif * (params.options.chiens.nb ?? 1) * nbNuits)
    : 0;

  const optionsTotal = round2(draps + linge + menage + departTardif + chiens);

  const nbPersonnes = params.nbAdultes + params.nbEnfants;
  const taxeSejour = round2(nbPersonnes * nbNuits * Number(gite?.taxe_sejour_par_personne_par_nuit ?? 0));

  const solde = round2(totalSansOptions - params.arrhesMontant);
  const totalGlobal = round2(totalSansOptions + optionsTotal);

  return { nbNuits, montantBase, totalSansOptions, optionsTotal, taxeSejour, solde, totalGlobal };
};
