import type { ContratOptions, Gite } from "./types";

export type ReservationServiceOptionKey = "draps" | "linge_toilette" | "menage" | "depart_tardif" | "chiens";

export type ReservationOptionsPreview = {
  total: number;
  label: string;
  labels: string[];
  byKey: Record<ReservationServiceOptionKey, number>;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const resolveDepartTardifTarif = (params: { options: ContratOptions; gite: Gite | null }) =>
  params.options.depart_tardif?.prix_forfait !== undefined
    ? round2(Math.max(0, Number(params.options.depart_tardif.prix_forfait ?? 0)))
    : round2(Number(params.gite?.options_depart_tardif_forfait ?? 0));

const resolveChiensTarif = (params: { options: ContratOptions; gite: Gite | null }) =>
  params.options.chiens?.prix_unitaire !== undefined
    ? round2(Math.max(0, Number(params.options.chiens.prix_unitaire ?? 0)))
    : round2(Number(params.gite?.options_chiens_forfait ?? 0));

export const mergeReservationOptions = (value?: ContratOptions | null): ContratOptions => ({
  draps: { enabled: false, nb_lits: 0, offert: false, declared: false, ...(value?.draps ?? {}) },
  linge_toilette: { enabled: false, nb_personnes: 0, offert: false, declared: false, ...(value?.linge_toilette ?? {}) },
  menage: { enabled: false, offert: false, declared: false, ...(value?.menage ?? {}) },
  depart_tardif: { enabled: false, offert: false, declared: false, ...(value?.depart_tardif ?? {}) },
  chiens: { enabled: false, nb: 0, offert: false, declared: false, ...(value?.chiens ?? {}) },
  regle_animaux_acceptes: value?.regle_animaux_acceptes ?? false,
  regle_bois_premiere_flambee: value?.regle_bois_premiere_flambee ?? false,
  regle_tiers_personnes_info: value?.regle_tiers_personnes_info ?? false,
});

export const toNonNegativeInt = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric));
};

export const buildQuickReservationOptions = (params: {
  baseOptions?: ContratOptions | null;
  menageEnabled: boolean;
  departTardifEnabled: boolean;
  drapsCount: number;
  serviettesCount: number;
}) => {
  const baseOptions = mergeReservationOptions(params.baseOptions);
  const drapsCount = toNonNegativeInt(params.drapsCount, 0);
  const serviettesCount = toNonNegativeInt(params.serviettesCount, 0);

  return {
    ...baseOptions,
    draps: {
      ...baseOptions.draps,
      enabled: drapsCount > 0,
      nb_lits: drapsCount,
    },
    linge_toilette: {
      ...baseOptions.linge_toilette,
      enabled: serviettesCount > 0,
      nb_personnes: serviettesCount,
    },
    menage: {
      ...baseOptions.menage,
      enabled: params.menageEnabled,
    },
    depart_tardif: {
      ...baseOptions.depart_tardif,
      enabled: params.departTardifEnabled,
    },
  } satisfies ContratOptions;
};

export const computeReservationOptionsPreview = (
  optionValue: ContratOptions | null | undefined,
  params: {
    nights: number;
    gite: Gite | null;
  }
): ReservationOptionsPreview => {
  const options = mergeReservationOptions(optionValue);
  const nights = Math.max(0, Number(params.nights ?? 0));
  const drapsQty = toNonNegativeInt(options.draps.nb_lits, 0);
  const lingeQty = toNonNegativeInt(options.linge_toilette.nb_personnes, 0);
  const chiensQty = toNonNegativeInt(options.chiens.nb, 0);

  const drapsTarif =
    options.draps.prix_unitaire !== undefined
      ? round2(Math.max(0, Number(options.draps.prix_unitaire ?? 0)))
      : round2(Number(params.gite?.options_draps_par_lit ?? 0));

  const draps = options.draps.enabled
    ? options.draps.offert
      ? 0
      : round2(drapsTarif * drapsQty)
    : 0;
  const linge = options.linge_toilette.enabled
    ? options.linge_toilette.offert
      ? 0
      : round2(Number(params.gite?.options_linge_toilette_par_personne ?? 0) * lingeQty)
    : 0;
  const menage = options.menage.enabled
    ? options.menage.offert
      ? 0
      : round2(Number(params.gite?.options_menage_forfait ?? 0))
    : 0;
  const departTardif = options.depart_tardif.enabled
    ? options.depart_tardif.offert
      ? 0
      : resolveDepartTardifTarif({ options, gite: params.gite })
    : 0;
  const chiens = options.chiens.enabled
    ? options.chiens.offert
      ? 0
      : round2(resolveChiensTarif({ options, gite: params.gite }) * chiensQty * nights)
    : 0;

  const labels: string[] = [];
  if (options.draps.enabled) labels.push(`Draps x${drapsQty}${options.draps.offert ? " offerts" : ""}`);
  if (options.linge_toilette.enabled) labels.push(`Serviettes x${lingeQty}${options.linge_toilette.offert ? " offertes" : ""}`);
  if (options.menage.enabled) labels.push(`Ménage${options.menage.offert ? " offert" : ""}`);
  if (options.depart_tardif.enabled) labels.push(`Départ tardif${options.depart_tardif.offert ? " offert" : ""}`);
  if (options.chiens.enabled) labels.push(`Chiens x${chiensQty}${options.chiens.offert ? " offerts" : ""}`);

  const byKey: Record<ReservationServiceOptionKey, number> = {
    draps,
    linge_toilette: linge,
    menage,
    depart_tardif: departTardif,
    chiens,
  };

  return {
    total: round2(draps + linge + menage + departTardif + chiens),
    label: labels.join(" · "),
    labels,
    byKey,
  };
};

export const areReservationOptionsAllDeclared = (optionValue: ContratOptions | null | undefined) => {
  const options = mergeReservationOptions(optionValue);
  const enabledDeclarationFlags = [
    options.draps.enabled ? Boolean(options.draps.declared) : null,
    options.linge_toilette.enabled ? Boolean(options.linge_toilette.declared) : null,
    options.menage.enabled ? Boolean(options.menage.declared) : null,
    options.depart_tardif.enabled ? Boolean(options.depart_tardif.declared) : null,
    options.chiens.enabled ? Boolean(options.chiens.declared) : null,
  ].filter((value): value is boolean => value !== null);

  return enabledDeclarationFlags.length > 0 && enabledDeclarationFlags.every(Boolean);
};
