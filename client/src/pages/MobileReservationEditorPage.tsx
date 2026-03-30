import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  buildAirbnbCalendarRefreshAppNotice,
  handleAirbnbCalendarRefreshFailure,
  waitForAirbnbCalendarRefreshJob,
  type AirbnbCalendarRefreshCreateStatus,
} from "../utils/airbnbCalendarRefresh";
import { dispatchAppNotice } from "../utils/appNotices";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import {
  areReservationOptionsAllDeclared,
  buildQuickReservationOptions,
  computeReservationOptionsPreview,
  mergeReservationOptions,
  toNonNegativeInt,
} from "../utils/reservationOptions";
import { buildSmsHref } from "../utils/sms";
import type { Gite, Reservation } from "../utils/types";

const DAY_MS = 24 * 60 * 60 * 1000;

type QuickReservationDraft = {
  hote_nom: string;
  telephone: string;
  date_entree: string;
  date_sortie: string;
  nb_adultes: number;
  prix_par_nuit: string;
  source_paiement: string;
  commentaire: string;
  option_menage: boolean;
  option_draps: number;
  option_serviettes: number;
};

type QuickReservationMode = "create" | "edit";
type QuickReservationErrorField = keyof QuickReservationDraft | null;

type QuickReservationSmsSnippet = {
  id: string;
  title: string;
  text: string;
};

type QuickReservationSmsSettings = {
  texts: QuickReservationSmsSnippet[];
};

type ReservationCreateResponse = Reservation & {
  created_reservations?: Reservation[];
  airbnb_calendar_refresh?: AirbnbCalendarRefreshCreateStatus;
};

const DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS: QuickReservationSmsSnippet[] = [
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

const RESERVATION_SOURCES = [
  "Abritel",
  "Airbnb",
  "Chèque",
  "Espèces",
  "HomeExchange",
  "Virement",
  "A définir",
  "Gites de France",
] as const;

const DEFAULT_RESERVATION_SOURCE = "A définir";

const normalizeIsoDate = (value: string) => value.slice(0, 10);
const round2 = (value: number) => Math.round(value * 100) / 100;

const parseIsoDate = (value: string) => {
  const normalized = normalizeIsoDate(value);
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const isIsoDateString = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
const parseOptionalIsoDate = (value: string) => (isIsoDateString(value) ? parseIsoDate(value) : null);

const formatShortDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const formatLongDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const formatQuickReservationPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
};

const getQuickReservationSmsPhoneDigits = (value: string) => value.replace(/\D/g, "");
const getQuickReservationAdultsMax = (gite: Gite | null) => Math.max(1, Math.trunc(Number(gite?.capacite_max ?? 1)) || 1);
const getQuickReservationOptionCountMax = (gite: Gite | null) => Math.max(1, Math.trunc(Number(gite?.capacite_max ?? 1)) || 1);

const clampQuickReservationAdults = (value: number, gite: Gite | null) =>
  Math.min(getQuickReservationAdultsMax(gite), Math.max(1, Math.trunc(Number(value) || 1)));

const clampQuickReservationOptionCount = (value: number, gite: Gite | null) =>
  Math.min(getQuickReservationOptionCountMax(gite), Math.max(0, Math.trunc(Number(value) || 0)));

const getGiteNightlyPriceSuggestions = (gite: Gite | null) => {
  const seen = new Set<number>();
  const suggestions: number[] = [];
  const rawList = Array.isArray(gite?.prix_nuit_liste) ? gite.prix_nuit_liste : [];

  rawList.forEach((item) => {
    const nextValue = round2(Math.max(0, Number(item)));
    if (!Number.isFinite(nextValue) || seen.has(nextValue)) return;
    seen.add(nextValue);
    suggestions.push(nextValue);
  });

  return suggestions;
};

const interpolateQuickReservationSmsSnippet = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

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
  options: ReturnType<typeof mergeReservationOptions>;
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

const getMobileFocusScrollBehavior = (): ScrollBehavior =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? "auto" : "smooth";

const ensureFieldVisible = (target: HTMLElement | null) => {
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: getMobileFocusScrollBehavior() });
};

const resolveReturnTo = (value: string | null) => {
  if (!value) return "/aujourdhui";
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : "/aujourdhui";
};

const MobileReservationEditorPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMode: QuickReservationMode = searchParams.get("mode") === "create" ? "create" : "edit";
  const requestedReservationId = (searchParams.get("id") ?? "").trim();
  const requestedGiteId = (searchParams.get("giteId") ?? "").trim();
  const requestedEntry = normalizeIsoDate(searchParams.get("entry") ?? "");
  const requestedExit = normalizeIsoDate(searchParams.get("exit") ?? "");
  const returnTo = resolveReturnTo(searchParams.get("returnTo"));

  const [gites, setGites] = useState<Gite[]>([]);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [draft, setDraft] = useState<QuickReservationDraft | null>(null);
  const [smsSnippets, setSmsSnippets] = useState<QuickReservationSmsSnippet[]>(DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS);
  const [smsSelection, setSmsSelection] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<QuickReservationErrorField>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const draftSeedRef = useRef<string | null>(null);
  const airbnbCalendarRefreshControllersRef = useRef<AbortController[]>([]);

  useEffect(() => {
    return () => {
      airbnbCalendarRefreshControllersRef.current.forEach((controller) => controller.abort());
    };
  }, []);

  const selectedGite = useMemo(() => {
    const currentGiteId = requestedMode === "edit" ? editingReservation?.gite_id ?? "" : requestedGiteId;
    return gites.find((gite) => gite.id === currentGiteId) ?? null;
  }, [editingReservation?.gite_id, gites, requestedGiteId, requestedMode]);

  const currentGitePricing = useMemo(
    () => ({
      menage: Number(selectedGite?.options_menage_forfait ?? 0),
      draps: Number(selectedGite?.options_draps_par_lit ?? 0),
      serviettes: Number(selectedGite?.options_linge_toilette_par_personne ?? 0),
    }),
    [selectedGite]
  );

  const loadEditorData = useCallback(async () => {
    if (requestedMode === "edit" && !requestedReservationId) {
      setPageError("Réservation introuvable.");
      setLoading(false);
      return;
    }

    if (requestedMode === "create" && (!requestedGiteId || !isIsoDateString(requestedEntry) || !isIsoDateString(requestedExit))) {
      setPageError("Paramètres de création incomplets.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setPageError(null);

      const [gitesData, smsTextSettings, reservation] = await Promise.all([
        apiFetch<Gite[]>("/gites"),
        apiFetch<QuickReservationSmsSettings>("/settings/sms-texts").catch(() => ({
          texts: DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS,
        })),
        requestedMode === "edit"
          ? apiFetch<Reservation>(`/reservations/prefill/${encodeURIComponent(requestedReservationId)}`)
          : Promise.resolve(null),
      ]);

      setGites(gitesData);
      setSmsSnippets(
        Array.isArray(smsTextSettings.texts) && smsTextSettings.texts.length > 0
          ? smsTextSettings.texts
          : DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS
      );
      setEditingReservation(reservation);
    } catch (err) {
      if (isApiError(err)) setPageError(err.message);
      else setPageError("Impossible de charger l'éditeur de réservation.");
    } finally {
      setLoading(false);
    }
  }, [requestedEntry, requestedExit, requestedGiteId, requestedMode, requestedReservationId]);

  useEffect(() => {
    void loadEditorData();
  }, [loadEditorData]);

  useEffect(() => {
    if (loading || pageError) return;

    if (requestedMode === "edit") {
      if (!editingReservation) return;
      const draftSeed = `edit:${editingReservation.id}`;
      if (draftSeedRef.current === draftSeed) return;

      draftSeedRef.current = draftSeed;
      setDraft({
        hote_nom: editingReservation.hote_nom,
        telephone: formatQuickReservationPhone(editingReservation.telephone ?? ""),
        date_entree: normalizeIsoDate(editingReservation.date_entree),
        date_sortie: normalizeIsoDate(editingReservation.date_sortie),
        nb_adultes: clampQuickReservationAdults(editingReservation.nb_adultes, selectedGite),
        prix_par_nuit: String(editingReservation.prix_par_nuit ?? ""),
        source_paiement: editingReservation.source_paiement?.trim() || DEFAULT_RESERVATION_SOURCE,
        commentaire: editingReservation.commentaire ?? "",
        option_menage: Boolean(editingReservation.options?.menage?.enabled),
        option_draps: editingReservation.options?.draps?.enabled
          ? clampQuickReservationOptionCount(
              toNonNegativeInt(editingReservation.options?.draps?.nb_lits, Math.max(1, editingReservation.nb_adultes || 1)),
              selectedGite
            )
          : 0,
        option_serviettes: editingReservation.options?.linge_toilette?.enabled
          ? clampQuickReservationOptionCount(
              toNonNegativeInt(
                editingReservation.options?.linge_toilette?.nb_personnes,
                Math.max(1, editingReservation.nb_adultes || 1)
              ),
              selectedGite
            )
          : 0,
      });
      setSmsSelection([]);
      setError(null);
      setErrorField(null);
      setSaved(false);
      return;
    }

    if (!selectedGite) {
      setPageError("Gîte introuvable.");
      return;
    }

    const draftSeed = `create:${requestedGiteId}:${requestedEntry}:${requestedExit}`;
    if (draftSeedRef.current === draftSeed) return;

    const nightlySuggestions = getGiteNightlyPriceSuggestions(selectedGite);
    const suggestedNightly = nightlySuggestions[0] ?? 0;
    const defaultAdults = Math.max(1, selectedGite.nb_adultes_habituel ?? 2);

    draftSeedRef.current = draftSeed;
    setDraft({
      hote_nom: "",
      telephone: "",
      date_entree: requestedEntry,
      date_sortie: requestedExit,
      nb_adultes: clampQuickReservationAdults(defaultAdults, selectedGite),
      prix_par_nuit: suggestedNightly > 0 ? String(suggestedNightly) : "",
      source_paiement: DEFAULT_RESERVATION_SOURCE,
      commentaire: "",
      option_menage: false,
      option_draps: 0,
      option_serviettes: 0,
    });
    setSmsSelection([]);
    setError(null);
    setErrorField(null);
    setSaved(false);
  }, [
    editingReservation,
    loading,
    pageError,
    requestedEntry,
    requestedExit,
    requestedGiteId,
    requestedMode,
    selectedGite,
  ]);

  useEffect(() => {
    if (!errorField) return;

    const target = document.querySelector<HTMLElement>(`[data-reservation-field="${errorField}"]`);
    if (!target) return;

    const timeoutId = window.setTimeout(() => {
      target.focus({ preventScroll: true });
      ensureFieldVisible(target);
    }, 30);

    return () => window.clearTimeout(timeoutId);
  }, [errorField]);

  const nightlySuggestions = useMemo(() => getGiteNightlyPriceSuggestions(selectedGite), [selectedGite]);
  const adultOptions = useMemo(
    () => Array.from({ length: getQuickReservationAdultsMax(selectedGite) }, (_, index) => index + 1),
    [selectedGite]
  );
  const optionCountMax = useMemo(() => getQuickReservationOptionCountMax(selectedGite), [selectedGite]);

  const dateSummary = useMemo(() => {
    if (!draft) {
      return { startIso: "", exitIso: "", nights: 0 };
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
  }, [draft]);

  const quickOptions = useMemo(
    () =>
      draft
        ? buildQuickReservationOptions({
            baseOptions: editingReservation?.options,
            menageEnabled: draft.option_menage,
            drapsCount: draft.option_draps,
            serviettesCount: draft.option_serviettes,
          })
        : null,
    [draft, editingReservation?.options]
  );

  const optionPreview = useMemo(
    () =>
      computeReservationOptionsPreview(quickOptions, {
        nights: dateSummary.nights,
        gite: selectedGite,
      }),
    [dateSummary.nights, quickOptions, selectedGite]
  );

  const baseTotal = useMemo(() => {
    if (!draft) return null;
    const nightly = Number.parseFloat(String(draft.prix_par_nuit).replace(",", "."));
    if (!Number.isFinite(nightly) || nightly < 0) return null;
    return dateSummary.nights > 0 ? round2(nightly * dateSummary.nights) : null;
  }, [dateSummary.nights, draft]);

  const computedTotal = useMemo(
    () => (baseTotal !== null ? round2(baseTotal + optionPreview.total) : null),
    [baseTotal, optionPreview.total]
  );

  const optionSummary = useMemo(
    () =>
      quickOptions
        ? formatQuickReservationOptionSmsSummary({
            options: quickOptions,
            optionsPreview: optionPreview,
          })
        : "",
    [optionPreview, quickOptions]
  );

  const smsText = useMemo(() => {
    if (!selectedGite || !draft) return "";

    const { startIso, exitIso, nights } = dateSummary;
    if (!isIsoDateString(startIso) || !isIsoDateString(exitIso) || nights <= 0) return "";

    const startDate = formatLongDate(startIso);
    const endDate = formatLongDate(exitIso);
    const nightly = Number.parseFloat(String(draft.prix_par_nuit).replace(",", "."));
    const address = [selectedGite.adresse_ligne1, selectedGite.adresse_ligne2].filter(Boolean).join(", ");
    const arrivalTime = formatQuickReservationSmsHour(selectedGite.heure_arrivee_defaut || "17:00");
    const departureTime = formatQuickReservationSmsHour(selectedGite.heure_depart_defaut || "12:00", {
      middayLabel: true,
    });

    const snippetValues = {
      adresse: address,
      dateDebut: startDate,
      dateFin: endDate,
      heureArrivee: arrivalTime,
      heureDepart: departureTime,
      gite: selectedGite.nom,
      nbNuits: String(nights),
      nom: draft.hote_nom.trim(),
    };

    const baseLines = [
      "Bonjour,",
      `Je vous confirme votre réservation pour le gîte ${selectedGite.nom} du ${startDate} à partir de ${arrivalTime} au ${endDate} ${departureTime} (${nights} nuit${
        nights > 1 ? "s" : ""
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

    if (computedTotal !== null && (optionPreview.total > 0 || optionSummary)) {
      baseLines.push(`Le total du séjour est de ${formatQuickReservationSmsAmount(computedTotal)}€.`);
    }

    if (address) baseLines.push(`L'adresse est ${address}.`);

    const selectedSnippets = smsSnippets
      .filter((snippet) => smsSelection.includes(snippet.id))
      .map((snippet) => interpolateQuickReservationSmsSnippet(snippet.text, snippetValues))
      .filter((snippet) => snippet.trim().length > 0);

    return [...baseLines, ...selectedSnippets, "Merci Beaucoup,", "Soazig Molinier"].join("\n");
  }, [baseTotal, computedTotal, dateSummary, draft, optionPreview.total, optionSummary, selectedGite, smsSelection, smsSnippets]);

  const smsHref = useMemo(() => {
    const phone = draft ? getQuickReservationSmsPhoneDigits(draft.telephone) : "";
    return buildSmsHref(phone, smsText);
  }, [draft, smsText]);

  const startAirbnbCalendarRefreshPolling = useCallback((refresh: AirbnbCalendarRefreshCreateStatus | undefined) => {
    if (!refresh) return;

    dispatchAppNotice(buildAirbnbCalendarRefreshAppNotice(refresh));
    if (refresh.status !== "queued" || !refresh.job_id) return;

    const controller = new AbortController();
    airbnbCalendarRefreshControllersRef.current.push(controller);

    void waitForAirbnbCalendarRefreshJob(refresh.job_id, {
      signal: controller.signal,
      onUpdate: (status) => {
        dispatchAppNotice(buildAirbnbCalendarRefreshAppNotice(status));
      },
    })
      .catch((refreshError) => {
        handleAirbnbCalendarRefreshFailure(refreshError, (message) =>
          dispatchAppNotice({
            label: "Airbnb",
            tone: "error",
            message,
            timeoutMs: 5_200,
            role: "alert",
          })
        );
      })
      .finally(() => {
        airbnbCalendarRefreshControllersRef.current = airbnbCalendarRefreshControllersRef.current.filter(
          (current) => current !== controller
        );
      });
  }, []);

  const handleClose = useCallback(() => {
    navigate(returnTo, { replace: true });
  }, [navigate, returnTo]);

  const handleFieldChange = useCallback(
    (field: keyof QuickReservationDraft, value: string | number | boolean) => {
      setSaved(false);
      setError(null);
      setErrorField(null);
      setDraft((current) => {
        if (!current) return current;
        if (field === "telephone") {
          return { ...current, telephone: formatQuickReservationPhone(String(value)) };
        }
        if (field === "nb_adultes") {
          return { ...current, nb_adultes: clampQuickReservationAdults(Number(value), selectedGite) };
        }
        if (field === "option_draps" || field === "option_serviettes") {
          return { ...current, [field]: clampQuickReservationOptionCount(Number(value), selectedGite) };
        }
        if (field === "option_menage") {
          return { ...current, option_menage: Boolean(value) };
        }
        return { ...current, [field]: value };
      });
    },
    [selectedGite]
  );

  const saveReservation = useCallback(async () => {
    if (!draft || saving) return;

    const currentGiteId = requestedMode === "edit" ? editingReservation?.gite_id ?? "" : requestedGiteId;
    if (!currentGiteId) {
      setError("Gîte introuvable.");
      setErrorField(null);
      setSaved(false);
      return;
    }

    const hostName = draft.hote_nom.trim();
    const nightly = Number.parseFloat(String(draft.prix_par_nuit).replace(",", "."));
    const adults = Math.max(0, Math.trunc(Number(draft.nb_adultes) || 0));
    const entryDate = parseOptionalIsoDate(draft.date_entree);
    const exitDate = parseOptionalIsoDate(draft.date_sortie);
    const nights = entryDate && exitDate ? Math.max(0, Math.round((exitDate.getTime() - entryDate.getTime()) / DAY_MS)) : 0;
    const nextOptions = buildQuickReservationOptions({
      baseOptions: editingReservation?.options,
      menageEnabled: draft.option_menage,
      drapsCount: draft.option_draps,
      serviettesCount: draft.option_serviettes,
    });
    const nextOptionPreview = computeReservationOptionsPreview(nextOptions, {
      nights,
      gite: selectedGite,
    });
    const optionsDeclared = areReservationOptionsAllDeclared(nextOptions);

    if (!hostName) {
      setError("Renseigne le nom de l'hôte.");
      setErrorField("hote_nom");
      setSaved(false);
      return;
    }

    if (!entryDate || !exitDate) {
      setError("Renseigne des dates valides.");
      setErrorField(!entryDate ? "date_entree" : "date_sortie");
      setSaved(false);
      return;
    }

    if (exitDate.getTime() <= entryDate.getTime()) {
      setError("La date de sortie doit être postérieure à la date d'entrée.");
      setErrorField("date_sortie");
      setSaved(false);
      return;
    }

    if (!Number.isFinite(nightly) || nightly < 0) {
      setError("Renseigne un prix par nuit valide.");
      setErrorField("prix_par_nuit");
      setSaved(false);
      return;
    }

    setSaving(true);
    setError(null);
    setErrorField(null);

    try {
      if (requestedMode === "edit") {
        if (!editingReservation) {
          setError("Réservation introuvable.");
          setErrorField(null);
          setSaved(false);
          return;
        }

        const updatedReservation = await apiFetch<Reservation>(`/reservations/${editingReservation.id}`, {
          method: "PUT",
          json: {
            gite_id: editingReservation.gite_id ?? currentGiteId,
            placeholder_id: editingReservation.placeholder_id ?? undefined,
            airbnb_url: editingReservation.airbnb_url ?? undefined,
            hote_nom: hostName,
            telephone: draft.telephone.trim() || undefined,
            date_entree: draft.date_entree,
            date_sortie: draft.date_sortie,
            nb_adultes: adults,
            prix_par_nuit: round2(nightly),
            price_driver: "nightly",
            source_paiement: draft.source_paiement || DEFAULT_RESERVATION_SOURCE,
            commentaire: draft.commentaire.trim() || undefined,
            remise_montant: editingReservation.remise_montant ?? 0,
            commission_channel_mode: editingReservation.commission_channel_mode ?? "euro",
            commission_channel_value: editingReservation.commission_channel_value ?? 0,
            frais_optionnels_montant: nextOptionPreview.total,
            frais_optionnels_libelle: nextOptionPreview.label || undefined,
            frais_optionnels_declares: optionsDeclared,
            options: nextOptions,
          },
        });

        setEditingReservation(updatedReservation);
        setSaved(true);
        return;
      }

      const createdReservation = await apiFetch<ReservationCreateResponse>("/reservations", {
        method: "POST",
        json: {
          gite_id: currentGiteId,
          hote_nom: hostName,
          telephone: draft.telephone.trim() || undefined,
          date_entree: draft.date_entree,
          date_sortie: draft.date_sortie,
          nb_adultes: adults,
          prix_par_nuit: round2(nightly),
          price_driver: "nightly",
          source_paiement: draft.source_paiement || DEFAULT_RESERVATION_SOURCE,
          commentaire: draft.commentaire.trim() || undefined,
          frais_optionnels_montant: nextOptionPreview.total,
          frais_optionnels_libelle: nextOptionPreview.label || undefined,
          frais_optionnels_declares: optionsDeclared,
          options: nextOptions,
        },
      });

      setEditingReservation(createdReservation);
      setSaved(true);
      startAirbnbCalendarRefreshPolling(createdReservation.airbnb_calendar_refresh);

      const params = new URLSearchParams();
      params.set("mode", "edit");
      params.set("id", createdReservation.id);
      params.set("returnTo", returnTo);
      navigate(`/reservations/mobile?${params.toString()}`, { replace: true });
    } catch (err) {
      if (isApiError(err)) setError(err.message);
      else setError("Impossible d'enregistrer la réservation.");
      setErrorField(null);
      setSaved(false);
    } finally {
      setSaving(false);
    }
  }, [draft, editingReservation, navigate, requestedGiteId, requestedMode, returnTo, saving, selectedGite, startAirbnbCalendarRefreshPolling]);

  const handlePrimaryAction = useCallback(() => {
    if (saved) {
      if (!smsHref) return;
      window.location.href = smsHref;
      return;
    }

    void saveReservation();
  }, [saved, saveReservation, smsHref]);

  const title = requestedMode === "edit" ? "Modifier la réservation" : "Nouvelle réservation";
  const eyebrow = selectedGite?.nom ?? "Réservation";
  const formattedTotal = computedTotal !== null ? formatEuro(computedTotal) : "A calculer";

  return (
    <div className="mobile-reservation-editor-page">
      <div className="mobile-reservation-editor-page__shell">
        <div className="mobile-reservation-editor-page__topbar">
          <button type="button" className="back-link mobile-reservation-editor-page__close" onClick={handleClose}>
            Fermer
          </button>
        </div>

        <section className="calendar-quick-create-sheet__panel mobile-reservation-editor-page__panel">
          <div className="calendar-quick-create-sheet__top">
            <div className="calendar-quick-create-sheet__header">
              <div>
                <p className="calendar-quick-create-sheet__eyebrow">{eyebrow}</p>
                <h2>{title}</h2>
              </div>
            </div>

            <div className="calendar-quick-create-sheet__summary">
              <div className="calendar-quick-create-sheet__summary-main">
                <strong className="calendar-quick-create-sheet__summary-dates">
                  {dateSummary.startIso && dateSummary.exitIso
                    ? `${formatShortDate(dateSummary.startIso)} → ${formatShortDate(dateSummary.exitIso)}`
                    : "Dates à renseigner"}
                </strong>
                <span className="calendar-quick-create-sheet__summary-pill">
                  {dateSummary.nights} nuit{dateSummary.nights > 1 ? "s" : ""}
                </span>
                {saved ? <span className="calendar-quick-create-sheet__saved-pill">Réservation enregistrée</span> : null}
              </div>
              <div className="calendar-quick-create-sheet__summary-total">
                <strong>{formattedTotal}</strong>
              </div>
            </div>
          </div>

          <div className="mobile-reservation-editor-page__body">
            {loading ? <p className="note">Chargement de la réservation...</p> : null}
            {!loading && pageError ? <p className="note note--error">{pageError}</p> : null}

            {!loading && !pageError && draft ? (
              <>
                {error ? <p className="calendar-quick-create-sheet__error">{error}</p> : null}

                <div className="calendar-quick-create-sheet__form">
                  <section className="calendar-quick-create-sheet__section">
                    <label className="field field--small calendar-quick-create-sheet__host-field">
                      Hôte
                      <input
                        data-reservation-field="hote_nom"
                        type="text"
                        value={draft.hote_nom}
                        placeholder="Nom du voyageur"
                        onChange={(event) => handleFieldChange("hote_nom", event.target.value)}
                      />
                    </label>

                    <label className="field field--small calendar-quick-create-sheet__host-field">
                      Téléphone
                      <input
                        data-reservation-field="telephone"
                        type="tel"
                        inputMode="tel"
                        value={draft.telephone}
                        placeholder="06 12 34 56 78"
                        onChange={(event) => handleFieldChange("telephone", event.target.value)}
                      />
                    </label>

                    <div className="calendar-quick-create-sheet__dates-band">
                      <label className="field field--small calendar-quick-create-sheet__host-field">
                        Entrée
                        <input
                          data-reservation-field="date_entree"
                          type="date"
                          value={draft.date_entree}
                          onChange={(event) => handleFieldChange("date_entree", event.target.value)}
                        />
                      </label>

                      <label className="field field--small calendar-quick-create-sheet__host-field">
                        Sortie
                        <input
                          data-reservation-field="date_sortie"
                          type="date"
                          value={draft.date_sortie}
                          onChange={(event) => handleFieldChange("date_sortie", event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="calendar-quick-create-sheet__stats-grid">
                      <label className="field field--small calendar-quick-create-sheet__compact-field calendar-quick-create-sheet__compact-field--adults">
                        <span className="calendar-quick-create-sheet__compact-label">Adultes</span>
                        <select
                          data-reservation-field="nb_adultes"
                          value={draft.nb_adultes}
                          onChange={(event) => handleFieldChange("nb_adultes", Number(event.target.value))}
                        >
                          {adultOptions.map((count) => (
                            <option key={count} value={count}>
                              {count}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="field field--small calendar-quick-create-sheet__compact-field calendar-quick-create-sheet__compact-field--nightly">
                        <span className="calendar-quick-create-sheet__compact-label">Prix / nuit</span>
                        <input
                          data-reservation-field="prix_par_nuit"
                          type="number"
                          min={0}
                          step={1}
                          inputMode="decimal"
                          value={draft.prix_par_nuit}
                          onChange={(event) => handleFieldChange("prix_par_nuit", event.target.value)}
                        />
                      </label>

                      {nightlySuggestions.length > 0 ? (
                        <div className="calendar-quick-create-sheet__prices">
                          <span className="calendar-quick-create-sheet__compact-label">Tarifs du gîte</span>
                          <div className="calendar-quick-create-sheet__price-list">
                            {nightlySuggestions.map((price) => {
                              const isActive = Number(draft.prix_par_nuit) === price;
                              return (
                                <button
                                  key={price}
                                  type="button"
                                  className={`calendar-quick-create-sheet__price-chip${
                                    isActive ? " calendar-quick-create-sheet__price-chip--active" : ""
                                  }`}
                                  onClick={() => handleFieldChange("prix_par_nuit", String(price))}
                                >
                                  {formatEuro(price)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="calendar-quick-create-sheet__prices calendar-quick-create-sheet__prices--empty">
                          <span className="calendar-quick-create-sheet__compact-label">Tarifs du gîte</span>
                          <strong>Manuel</strong>
                        </div>
                      )}
                    </div>

                    <label className="field field--small calendar-quick-create-sheet__host-field">
                      Source
                      <select
                        data-reservation-field="source_paiement"
                        value={draft.source_paiement}
                        onChange={(event) => handleFieldChange("source_paiement", event.target.value)}
                      >
                        {RESERVATION_SOURCES.map((source) => (
                          <option key={source} value={source}>
                            {source}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field field--small calendar-quick-create-sheet__note-field">
                      Note
                      <textarea
                        data-reservation-field="commentaire"
                        rows={2}
                        value={draft.commentaire}
                        placeholder="Optionnel"
                        onChange={(event) => handleFieldChange("commentaire", event.target.value)}
                      />
                    </label>

                    <div className="calendar-quick-create-sheet__options-card">
                      <label className="calendar-quick-create-sheet__toggle-row">
                        <div>
                          <span className="calendar-quick-create-sheet__toggle-title">Option ménage</span>
                          <span className="calendar-quick-create-sheet__toggle-meta">{formatEuro(currentGitePricing.menage)}</span>
                        </div>
                        <span className="calendar-quick-create-sheet__switch-control">
                          <input
                            data-reservation-field="option_menage"
                            type="checkbox"
                            checked={draft.option_menage}
                            onChange={(event) => handleFieldChange("option_menage", event.target.checked)}
                          />
                          <span aria-hidden="true" />
                        </span>
                      </label>

                      <label className="calendar-quick-create-sheet__range-field">
                        <div className="calendar-quick-create-sheet__range-head">
                          <span className="calendar-quick-create-sheet__toggle-title">Draps</span>
                          <span className="calendar-quick-create-sheet__range-value">
                            {draft.option_draps} · {formatEuro(optionPreview.byKey.draps)}
                          </span>
                        </div>
                        <input
                          data-reservation-field="option_draps"
                          type="range"
                          min={0}
                          max={optionCountMax}
                          step={1}
                          value={draft.option_draps}
                          onChange={(event) => handleFieldChange("option_draps", Number(event.target.value))}
                        />
                        <span className="calendar-quick-create-sheet__range-meta">{formatEuro(currentGitePricing.draps)} / lit</span>
                      </label>

                      <label className="calendar-quick-create-sheet__range-field">
                        <div className="calendar-quick-create-sheet__range-head">
                          <span className="calendar-quick-create-sheet__toggle-title">Serviettes</span>
                          <span className="calendar-quick-create-sheet__range-value">
                            {draft.option_serviettes} · {formatEuro(optionPreview.byKey.linge_toilette)}
                          </span>
                        </div>
                        <input
                          data-reservation-field="option_serviettes"
                          type="range"
                          min={0}
                          max={optionCountMax}
                          step={1}
                          value={draft.option_serviettes}
                          onChange={(event) => handleFieldChange("option_serviettes", Number(event.target.value))}
                        />
                        <span className="calendar-quick-create-sheet__range-meta">
                          {formatEuro(currentGitePricing.serviettes)} / personne
                        </span>
                      </label>
                    </div>
                  </section>

                  <section className="calendar-quick-create-sheet__section">
                    <p className="calendar-quick-create-sheet__section-title">3 - Envoyer un SMS de confirmation</p>

                    <div className="calendar-quick-create-sheet__switches">
                      {smsSnippets.map((snippet) => {
                        const checked = smsSelection.includes(snippet.id);
                        return (
                          <label key={snippet.id} className="calendar-quick-create-sheet__switch">
                            <span>{snippet.title}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setSmsSelection((current) =>
                                  event.target.checked ? [...current, snippet.id] : current.filter((item) => item !== snippet.id)
                                )
                              }
                            />
                          </label>
                        );
                      })}
                    </div>

                    <div className="calendar-quick-create-sheet__sms-preview">
                      <pre>{smsText}</pre>
                    </div>

                    <div className="calendar-quick-create-sheet__sms-actions">
                      <button
                        type="button"
                        className="calendar-quick-create-sheet__copy"
                        onClick={() => {
                          if (!navigator.clipboard?.writeText) return;
                          void navigator.clipboard.writeText(smsText);
                        }}
                        aria-label="Copier le SMS"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 19.5v-10Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M6 16H5.5A1.5 1.5 0 0 1 4 14.5v-10A1.5 1.5 0 0 1 5.5 3h8A1.5 1.5 0 0 1 15 4.5V5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span>Copier</span>
                      </button>
                      {saved ? (
                        <span className="calendar-quick-create-sheet__sms-hint">
                          {smsHref ? "Le bouton principal ouvre la messagerie SMS." : "Ajoute un numéro pour envoyer le SMS."}
                        </span>
                      ) : (
                        <span className="calendar-quick-create-sheet__sms-hint">Le SMS s'ouvre après l'enregistrement.</span>
                      )}
                    </div>
                  </section>
                </div>
              </>
            ) : null}
          </div>

          {!loading && !pageError ? (
            <div className="calendar-quick-create-sheet__footer mobile-reservation-editor-page__footer">
              <button
                type="button"
                className={`calendar-quick-create-sheet__submit${saved ? " calendar-quick-create-sheet__submit--sms" : ""}`}
                onClick={handlePrimaryAction}
                disabled={saving || !draft || (saved && !smsHref)}
              >
                {saved ? "Envoyer le SMS" : saving ? "Enregistrement..." : requestedMode === "edit" ? "Mettre à jour" : "Enregistrer"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default MobileReservationEditorPage;
