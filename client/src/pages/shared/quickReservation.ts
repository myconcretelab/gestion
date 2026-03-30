import {
  areReservationOptionsAllDeclared,
  buildQuickReservationOptions,
  computeReservationOptionsPreview,
  toNonNegativeInt,
} from "../../utils/reservationOptions";
import { buildSmsHref } from "../../utils/sms";
import type { Gite, Reservation } from "../../utils/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type QuickReservationDraft = {
  hote_nom: string;
  telephone: string;
  date_entree: string;
  date_sortie: string;
  nb_adultes: number;
  prix_par_nuit: string;
  source_paiement: string;
  commentaire: string;
  option_menage: boolean;
  option_depart_tardif: boolean;
  option_draps: number;
  option_serviettes: number;
};

export type QuickReservationErrorField = keyof QuickReservationDraft | null;

export type QuickReservationSmsSnippet = {
  id: string;
  title: string;
  text: string;
};

export type QuickReservationSmsSettings = {
  texts: QuickReservationSmsSnippet[];
};

export type QuickReservationDateSummary = {
  startIso: string;
  exitIso: string;
  nights: number;
};

export const DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS: QuickReservationSmsSnippet[] = [
  {
    id: "bedding-cleaning",
    title: "Draps/ménage",
    text: "Comme indiqué, je vous laisse prendre vos draps, serviettes et faire le ménage avant de partir.",
  },
  {
    id: "bedding-option",
    title: "Option Draps/Serviettes",
    text: "Vous pourrez prendre l'option draps à 15€ par lit si vous ne souhaitez pas emporter votre linge.",
  },
];

export const RESERVATION_SOURCES = [
  "Abritel",
  "Airbnb",
  "Chèque",
  "Espèces",
  "HomeExchange",
  "Virement",
  "A définir",
  "Gites de France",
] as const;

export const DEFAULT_RESERVATION_SOURCE = "A définir";

export const normalizeIsoDate = (value: string) => value.slice(0, 10);

export const round2 = (value: number) => Math.round(value * 100) / 100;

const parseIsoDate = (value: string) => {
  const [year, month, day] = normalizeIsoDate(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

export const isIsoDateString = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());

export const parseOptionalIsoDate = (value: string) => (isIsoDateString(value) ? parseIsoDate(value) : null);

export const formatQuickReservationPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
};

export const getQuickReservationSmsPhoneDigits = (value: string) => value.replace(/\D/g, "");

export const getQuickReservationAdultsMax = (gite: Gite | null) => Math.max(1, Math.trunc(Number(gite?.capacite_max ?? 1)) || 1);

export const getQuickReservationOptionCountMax = (gite: Gite | null) =>
  Math.max(1, Math.trunc(Number(gite?.capacite_max ?? 1)) || 1);

export const clampQuickReservationAdults = (value: number, gite: Gite | null) =>
  Math.min(getQuickReservationAdultsMax(gite), Math.max(1, Math.trunc(Number(value) || 1)));

export const clampQuickReservationOptionCount = (value: number, gite: Gite | null) =>
  Math.min(getQuickReservationOptionCountMax(gite), Math.max(0, Math.trunc(Number(value) || 0)));

export const buildNewQuickReservationDraft = (params: {
  startIso: string;
  exitIso: string;
  defaultAdults: number;
  nightlySuggestion: number;
  gite: Gite | null;
}): QuickReservationDraft => ({
  hote_nom: "",
  telephone: "",
  date_entree: params.startIso,
  date_sortie: params.exitIso,
  nb_adultes: clampQuickReservationAdults(params.defaultAdults, params.gite),
  prix_par_nuit: params.nightlySuggestion > 0 ? String(params.nightlySuggestion) : "",
  source_paiement: DEFAULT_RESERVATION_SOURCE,
  commentaire: "",
  option_menage: false,
  option_depart_tardif: false,
  option_draps: 0,
  option_serviettes: 0,
});

export const buildQuickReservationDraftFromReservation = (params: {
  reservation: Reservation;
  gite: Gite | null;
}): QuickReservationDraft => {
  const { reservation, gite } = params;

  return {
    hote_nom: reservation.hote_nom,
    telephone: formatQuickReservationPhone(reservation.telephone ?? ""),
    date_entree: normalizeIsoDate(reservation.date_entree),
    date_sortie: normalizeIsoDate(reservation.date_sortie),
    nb_adultes: clampQuickReservationAdults(reservation.nb_adultes, gite),
    prix_par_nuit: String(reservation.prix_par_nuit ?? ""),
    source_paiement: reservation.source_paiement?.trim() || DEFAULT_RESERVATION_SOURCE,
    commentaire: reservation.commentaire ?? "",
    option_menage: Boolean(reservation.options?.menage?.enabled),
    option_depart_tardif: Boolean(reservation.options?.depart_tardif?.enabled),
    option_draps: reservation.options?.draps?.enabled
      ? clampQuickReservationOptionCount(
          toNonNegativeInt(reservation.options?.draps?.nb_lits, Math.max(1, reservation.nb_adultes || 1)),
          gite
        )
      : 0,
    option_serviettes: reservation.options?.linge_toilette?.enabled
      ? clampQuickReservationOptionCount(
          toNonNegativeInt(reservation.options?.linge_toilette?.nb_personnes, Math.max(1, reservation.nb_adultes || 1)),
          gite
        )
      : 0,
  };
};

export const updateQuickReservationDraftField = (params: {
  current: QuickReservationDraft;
  field: keyof QuickReservationDraft;
  value: string | number | boolean;
  gite: Gite | null;
}): QuickReservationDraft => {
  const { current, field, value, gite } = params;

  if (field === "telephone") {
    return { ...current, telephone: formatQuickReservationPhone(String(value)) };
  }

  if (field === "nb_adultes") {
    return { ...current, nb_adultes: clampQuickReservationAdults(Number(value), gite) };
  }

  if (field === "option_draps" || field === "option_serviettes") {
    return { ...current, [field]: clampQuickReservationOptionCount(Number(value), gite) };
  }

  if (field === "option_menage") {
    return { ...current, option_menage: Boolean(value) };
  }

  if (field === "option_depart_tardif") {
    return { ...current, option_depart_tardif: Boolean(value) };
  }

  return { ...current, [field]: value };
};

export const getQuickReservationDateSummary = (draft: QuickReservationDraft | null): QuickReservationDateSummary => {
  if (!draft) {
    return {
      startIso: "",
      exitIso: "",
      nights: 0,
    };
  }

  const entryDate = parseOptionalIsoDate(draft.date_entree);
  const exitDate = parseOptionalIsoDate(draft.date_sortie);
  if (!entryDate || !exitDate) {
    return {
      startIso: draft.date_entree,
      exitIso: draft.date_sortie,
      nights: 0,
    };
  }

  return {
    startIso: draft.date_entree,
    exitIso: draft.date_sortie,
    nights: Math.max(0, Math.round((exitDate.getTime() - entryDate.getTime()) / DAY_MS)),
  };
};

const interpolateQuickReservationSmsSnippet = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

const formatLongDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const formatQuickReservationSmsHour = (value: string, options?: { middayLabel?: boolean }) => {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (options?.middayLabel && hours === 12 && minutes === 0) return "midi";
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
};

const formatQuickReservationSmsAmount = (value: number) => {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : round2(value).toFixed(2).replace(".", ",");
};

const formatQuickReservationOptionSmsSummary = (params: {
  options: ReturnType<typeof buildQuickReservationOptions>;
  optionsPreview: ReturnType<typeof computeReservationOptionsPreview>;
}) => {
  const { options, optionsPreview } = params;
  const items: string[] = [];

  if (options.menage.enabled) {
    items.push(optionsPreview.byKey.menage > 0 ? `ménage ${formatQuickReservationSmsAmount(optionsPreview.byKey.menage)}€` : "ménage offert");
  }

  if (options.draps.enabled) {
    const count = toNonNegativeInt(options.draps.nb_lits, 0);
    items.push(
      optionsPreview.byKey.draps > 0
        ? `draps x${count} ${formatQuickReservationSmsAmount(optionsPreview.byKey.draps)}€`
        : `draps x${count} offerts`
    );
  }

  if (options.linge_toilette.enabled) {
    const count = toNonNegativeInt(options.linge_toilette.nb_personnes, 0);
    items.push(
      optionsPreview.byKey.linge_toilette > 0
        ? `serviettes x${count} ${formatQuickReservationSmsAmount(optionsPreview.byKey.linge_toilette)}€`
        : `serviettes x${count} offertes`
    );
  }

  if (options.depart_tardif.enabled) {
    items.push(
      optionsPreview.byKey.depart_tardif > 0
        ? `départ tardif ${formatQuickReservationSmsAmount(optionsPreview.byKey.depart_tardif)}€`
        : "départ tardif offert"
    );
  }

  if (options.chiens.enabled) {
    const count = toNonNegativeInt(options.chiens.nb, 0);
    items.push(
      optionsPreview.byKey.chiens > 0
        ? `chiens x${count} ${formatQuickReservationSmsAmount(optionsPreview.byKey.chiens)}€`
        : `chiens x${count} offerts`
    );
  }

  return items.join(" · ");
};

export const computeQuickReservationDerivedState = (params: {
  draft: QuickReservationDraft | null;
  editingReservation: Reservation | null;
  gite: Gite | null;
  smsSnippets: QuickReservationSmsSnippet[];
  smsSelection: string[];
}) => {
  const { draft, editingReservation, gite, smsSnippets, smsSelection } = params;
  const dateSummary = getQuickReservationDateSummary(draft);
  const options = draft
    ? buildQuickReservationOptions({
        baseOptions: editingReservation?.options,
        menageEnabled: draft.option_menage,
        departTardifEnabled: draft.option_depart_tardif,
        drapsCount: draft.option_draps,
        serviettesCount: draft.option_serviettes,
      })
    : null;
  const optionsPreview = computeReservationOptionsPreview(options, {
    nights: dateSummary.nights,
    gite,
  });
  const nightly = draft ? Number.parseFloat(String(draft.prix_par_nuit).replace(",", ".")) : Number.NaN;
  const baseTotal = draft && Number.isFinite(nightly) && nightly >= 0 && dateSummary.nights > 0 ? round2(nightly * dateSummary.nights) : null;
  const computedTotal = baseTotal !== null ? round2(baseTotal + optionsPreview.total) : null;
  const optionSummary = options
    ? formatQuickReservationOptionSmsSummary({
        options,
        optionsPreview,
      })
    : "";

  let smsText = "";
  if (gite && draft && isIsoDateString(dateSummary.startIso) && isIsoDateString(dateSummary.exitIso) && dateSummary.nights > 0) {
    const startDate = formatLongDate(dateSummary.startIso);
    const endDate = formatLongDate(dateSummary.exitIso);
    const address = [gite.adresse_ligne1, gite.adresse_ligne2].filter(Boolean).join(", ");
    const arrivalTime = formatQuickReservationSmsHour(gite.heure_arrivee_defaut || "17:00");
    const departureTime = formatQuickReservationSmsHour(gite.heure_depart_defaut || "12:00", {
      middayLabel: true,
    });
    const snippetValues = {
      adresse: address,
      dateDebut: startDate,
      dateFin: endDate,
      heureArrivee: arrivalTime,
      heureDepart: departureTime,
      gite: gite.nom,
      nbNuits: String(dateSummary.nights),
      nom: draft.hote_nom.trim(),
    };

    const baseLines = [
      "Bonjour,",
      `Je vous confirme votre réservation pour le gîte ${gite.nom} du ${startDate} à partir de ${arrivalTime} au ${endDate} ${departureTime} (${dateSummary.nights} nuit${
        dateSummary.nights > 1 ? "s" : ""
      }).`,
    ];

    if (Number.isFinite(nightly) && nightly >= 0 && baseTotal !== null) {
      baseLines.push(
        `Le tarif est de ${formatQuickReservationSmsAmount(round2(nightly))}€/nuit, soit ${formatQuickReservationSmsAmount(baseTotal)}€.`
      );
    }

    if (optionSummary) {
      baseLines.push(`Options retenues : ${optionSummary}.`);
    }

    if (computedTotal !== null && (optionsPreview.total > 0 || optionSummary)) {
      baseLines.push(`Le total du séjour est de ${formatQuickReservationSmsAmount(computedTotal)}€.`);
    }

    if (address) baseLines.push(`L'adresse est ${address}.`);

    const selectedSnippets = smsSnippets
      .filter((snippet) => smsSelection.includes(snippet.id))
      .map((snippet) => interpolateQuickReservationSmsSnippet(snippet.text, snippetValues))
      .filter((snippet) => snippet.trim().length > 0);

    smsText = [...baseLines, ...selectedSnippets, "Merci Beaucoup,", "Soazig Molinier"].join("\n");
  }

  const smsHref = buildSmsHref(draft ? getQuickReservationSmsPhoneDigits(draft.telephone) : "", smsText);

  return {
    dateSummary,
    options,
    optionsPreview,
    baseTotal,
    computedTotal,
    optionSummary,
    smsText,
    smsHref,
  };
};

export const buildQuickReservationSavePayload = (params: {
  draft: QuickReservationDraft;
  gite: Gite | null;
  baseOptions: Reservation["options"] | null | undefined;
}) => {
  const { draft, gite, baseOptions } = params;
  const hostName = draft.hote_nom.trim();
  const nightly = Number.parseFloat(String(draft.prix_par_nuit).replace(",", "."));
  const adults = Math.max(0, Math.trunc(Number(draft.nb_adultes) || 0));
  const entryDate = parseOptionalIsoDate(draft.date_entree);
  const exitDate = parseOptionalIsoDate(draft.date_sortie);
  const nights = entryDate && exitDate ? Math.max(0, Math.round((exitDate.getTime() - entryDate.getTime()) / DAY_MS)) : 0;

  if (!hostName) {
    return {
      ok: false as const,
      error: "Renseigne le nom de l'hôte.",
      errorField: "hote_nom" as QuickReservationErrorField,
    };
  }

  if (!entryDate || !exitDate) {
    return {
      ok: false as const,
      error: "Renseigne des dates valides.",
      errorField: (!entryDate ? "date_entree" : "date_sortie") as QuickReservationErrorField,
    };
  }

  if (exitDate.getTime() <= entryDate.getTime()) {
    return {
      ok: false as const,
      error: "La date de sortie doit être postérieure à la date d'entrée.",
      errorField: "date_sortie" as QuickReservationErrorField,
    };
  }

  if (!Number.isFinite(nightly) || nightly < 0) {
    return {
      ok: false as const,
      error: "Renseigne un prix par nuit valide.",
      errorField: "prix_par_nuit" as QuickReservationErrorField,
    };
  }

  const options = buildQuickReservationOptions({
    baseOptions,
    menageEnabled: draft.option_menage,
    departTardifEnabled: draft.option_depart_tardif,
    drapsCount: draft.option_draps,
    serviettesCount: draft.option_serviettes,
  });
  const optionsPreview = computeReservationOptionsPreview(options, {
    nights,
    gite,
  });
  const optionsDeclared = areReservationOptionsAllDeclared(options);

  return {
    ok: true as const,
    payload: {
      hote_nom: hostName,
      telephone: draft.telephone.trim() || undefined,
      date_entree: draft.date_entree,
      date_sortie: draft.date_sortie,
      nb_adultes: adults,
      prix_par_nuit: round2(nightly),
      price_driver: "nightly" as const,
      source_paiement: draft.source_paiement || DEFAULT_RESERVATION_SOURCE,
      commentaire: draft.commentaire.trim() || undefined,
      frais_optionnels_montant: optionsPreview.total,
      frais_optionnels_libelle: optionsPreview.label || undefined,
      frais_optionnels_declares: optionsDeclared,
      options,
    },
  };
};
