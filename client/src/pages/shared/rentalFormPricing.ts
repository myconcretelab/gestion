import { useMemo } from "react";
import { computeTotals } from "../../utils/contractCalc";
import type { ContratOptions, Gite } from "../../utils/types";
import { DEFAULT_ARRHES_RATE, round2 } from "./rentalForm";

type RemiseMode = "euro" | "percent";

export type ServiceOptionKey = "draps" | "linge_toilette" | "menage" | "depart_tardif" | "chiens";
export type RuleOptionKey =
  | "regle_animaux_acceptes"
  | "regle_bois_premiere_flambee"
  | "regle_tiers_personnes_info";

const computeMontantBase = (dateDebut: string, dateFin: string, prixParNuit: number) => {
  const start = new Date(dateDebut);
  const end = new Date(dateFin);
  const hasDateDebut = Boolean(dateDebut);
  const hasDateFin = Boolean(dateFin);
  const startValid = Number.isFinite(start.getTime());
  const endValid = Number.isFinite(end.getTime());

  if (startValid && endValid && end > start) {
    const nbNuits = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    return round2(nbNuits * prixParNuit);
  }
  if (!hasDateDebut || !hasDateFin) return round2(prixParNuit);
  return 0;
};

const computeRemiseMontant = (montantBase: number, remiseMode: RemiseMode, remiseValue: string) => {
  const value = Number(remiseValue || 0);
  if (!Number.isFinite(value)) return 0;
  if (remiseMode === "percent") return round2((montantBase * value) / 100);
  return round2(value);
};

export const useRentalFormPricing = (params: {
  gites: Gite[];
  giteId: string;
  dateDebut: string;
  dateFin: string;
  prixParNuit: number;
  remiseMode: RemiseMode;
  remiseValue: string;
  nbAdultes: number;
  nbEnfants: number;
  arrhesMontant: string;
  options: ContratOptions;
}) => {
  const selectedGite = useMemo(
    () => params.gites.find((gite) => gite.id === params.giteId) ?? null,
    [params.gites, params.giteId]
  );

  const prixNuitListe = useMemo(() => {
    const list = Array.isArray(selectedGite?.prix_nuit_liste) ? selectedGite.prix_nuit_liste : [];
    return list
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
  }, [selectedGite]);

  const montantBase = useMemo(
    () => computeMontantBase(params.dateDebut, params.dateFin, params.prixParNuit),
    [params.dateDebut, params.dateFin, params.prixParNuit]
  );

  const remiseMontant = useMemo(
    () => computeRemiseMontant(montantBase, params.remiseMode, params.remiseValue),
    [montantBase, params.remiseMode, params.remiseValue]
  );

  const totals = useMemo(
    () =>
      computeTotals({
        dateDebut: params.dateDebut,
        dateFin: params.dateFin,
        prixParNuit: params.prixParNuit,
        remiseMontant,
        nbAdultes: params.nbAdultes,
        nbEnfants: params.nbEnfants,
        arrhesMontant: Number(params.arrhesMontant || 0),
        options: params.options,
        gite: selectedGite,
      }),
    [
      params.dateDebut,
      params.dateFin,
      params.prixParNuit,
      remiseMontant,
      params.nbAdultes,
      params.nbEnfants,
      params.arrhesMontant,
      params.options,
      selectedGite,
    ]
  );

  const arrhesRate = selectedGite?.arrhes_taux_defaut ?? DEFAULT_ARRHES_RATE;
  const arrhesAutoValue = useMemo(() => {
    if (!Number.isFinite(totals.totalSansOptions)) return 0;
    return round2(totals.totalSansOptions * arrhesRate);
  }, [totals.totalSansOptions, arrhesRate]);

  const drapsTarif = Number(selectedGite?.options_draps_par_lit ?? 0);
  const lingeTarif = Number(selectedGite?.options_linge_toilette_par_personne ?? 0);
  const menageTarif = Number(selectedGite?.options_menage_forfait ?? 0);
  const departTardifTarif = Number(selectedGite?.options_depart_tardif_forfait ?? 0);
  const chiensTarif = Number(selectedGite?.options_chiens_forfait ?? 0);

  const regleAnimauxAcceptes = params.options.regle_animaux_acceptes ?? false;
  const regleBoisPremiereFlambee = params.options.regle_bois_premiere_flambee ?? false;
  const regleTiersPersonnesInfo = params.options.regle_tiers_personnes_info ?? false;

  return {
    selectedGite,
    prixNuitListe,
    montantBase,
    remiseMontant,
    totals,
    arrhesRate,
    arrhesAutoValue,
    drapsTarif,
    lingeTarif,
    menageTarif,
    departTardifTarif,
    chiensTarif,
    regleAnimauxAcceptes,
    regleBoisPremiereFlambee,
    regleTiersPersonnesInfo,
  };
};
