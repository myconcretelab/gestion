import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildAirbnbCalendarRefreshAppNotice,
  handleAirbnbCalendarRefreshFailure,
  waitForAirbnbCalendarRefreshJob,
  type AirbnbCalendarRefreshCreateStatus,
} from "../utils/airbnbCalendarRefresh";
import { dispatchAppNotice } from "../utils/appNotices";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import { getGiteColor } from "../utils/giteColors";
import type { Gite, Reservation } from "../utils/types";
import {
  DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS,
  RESERVATION_SOURCES,
  buildNewQuickReservationDraft,
  buildQuickReservationDraftFromReservation,
  buildQuickReservationSavePayload,
  computeQuickReservationDerivedState,
  getQuickReservationAdultsMax,
  getQuickReservationOptionCountMax,
  normalizeIsoDate,
  round2,
  updateQuickReservationDraftField,
  type QuickReservationDraft,
  type QuickReservationErrorField,
  type QuickReservationSmsSettings,
  type QuickReservationSmsSnippet,
} from "./shared/quickReservation";
import {
  buildMobileReservationEditorHref,
  sanitizeMobileReservationBackHref,
} from "./shared/mobileReservationEditor";

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M15 5 8 12l7 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SaveSpinnerIcon = () => (
  <svg className="calendar-quick-create-sheet__submit-icon calendar-quick-create-sheet__submit-icon--spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.28" />
    <path
      d="M12 4a8 8 0 0 1 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

const SaveCheckIcon = () => (
  <svg className="calendar-quick-create-sheet__submit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="m7.5 12.5 3 3 6-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const parseIsoDate = (value: string) => {
  const [year, month, day] = normalizeIsoDate(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatShortDate = (value: string) =>
  parseIsoDate(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

type ReservationCreateResponse = Reservation & {
  created_reservations?: Reservation[];
  airbnb_calendar_refresh?: AirbnbCalendarRefreshCreateStatus;
};

type EditorMode = "create" | "edit";
type QuickReservationSaveState = "idle" | "saving" | "saved";

const MobileReservationEditorPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialMode = searchParams.get("mode") === "edit" ? "edit" : "create";
  const initialOrigin = searchParams.get("origin") === "calendar" ? "calendar" : "today";
  const initialBackHref = sanitizeMobileReservationBackHref(searchParams.get("back"));
  const initialReservationId = String(searchParams.get("reservationId") ?? "").trim();
  const initialGiteId = String(searchParams.get("giteId") ?? "").trim();
  const initialEntry = String(searchParams.get("entry") ?? "").trim();
  const initialExit = String(searchParams.get("exit") ?? "").trim();

  const [gites, setGites] = useState<Gite[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>(initialMode);
  const [origin, setOrigin] = useState<"today" | "calendar">(initialOrigin);
  const [backHref, setBackHref] = useState(initialBackHref);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [selectedGiteId, setSelectedGiteId] = useState(initialGiteId);
  const [quickReservationDraft, setQuickReservationDraft] = useState<QuickReservationDraft | null>(null);
  const [quickReservationSmsSnippets, setQuickReservationSmsSnippets] = useState<QuickReservationSmsSnippet[]>(
    DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS
  );
  const [quickReservationSmsSelection, setQuickReservationSmsSelection] = useState<string[]>([]);
  const [quickReservationSaveState, setQuickReservationSaveState] = useState<QuickReservationSaveState>("idle");
  const [quickReservationDeleting, setQuickReservationDeleting] = useState(false);
  const [quickReservationError, setQuickReservationError] = useState<string | null>(null);
  const [quickReservationErrorField, setQuickReservationErrorField] = useState<QuickReservationErrorField>(null);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [smsExpanded, setSmsExpanded] = useState(false);
  const [smsPreviewExpanded, setSmsPreviewExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const airbnbCalendarRefreshControllersRef = useRef<AbortController[]>([]);
  const quickReservationSavedTimeoutRef = useRef<number | null>(null);
  const quickReservationSaving = quickReservationSaveState === "saving";
  const quickReservationSaved = quickReservationSaveState === "saved";

  const clearQuickReservationSavedTimeout = useCallback(() => {
    if (quickReservationSavedTimeoutRef.current === null) return;
    window.clearTimeout(quickReservationSavedTimeoutRef.current);
    quickReservationSavedTimeoutRef.current = null;
  }, []);

  const scheduleQuickReservationSavedReset = useCallback(() => {
    clearQuickReservationSavedTimeout();
    quickReservationSavedTimeoutRef.current = window.setTimeout(() => {
      setQuickReservationSaveState((current) => (current === "saved" ? "idle" : current));
      quickReservationSavedTimeoutRef.current = null;
    }, 1600);
  }, [clearQuickReservationSavedTimeout]);

  const loadPage = useCallback(
    async (params: {
      mode: EditorMode;
      origin: "today" | "calendar";
      backHref: string;
      reservationId: string;
      giteId: string;
      entry: string;
      exit: string;
    }) => {
      setLoading(true);
      setLoadingError(null);
      setQuickReservationError(null);
      setQuickReservationErrorField(null);
      clearQuickReservationSavedTimeout();
      setQuickReservationSaveState("idle");
      setQuickReservationSmsSelection([]);
      setOptionsExpanded(false);
      setSmsExpanded(false);
      setSmsPreviewExpanded(false);

      try {
        const requests: [Promise<Gite[]>, Promise<QuickReservationSmsSettings>, Promise<Reservation | null>] = [
          apiFetch<Gite[]>("/gites"),
          apiFetch<QuickReservationSmsSettings>("/settings/sms-texts"),
          params.mode === "edit" && params.reservationId
            ? apiFetch<Reservation>(`/reservations/${params.reservationId}`)
            : Promise.resolve(null),
        ];

        const [gitesData, smsTextSettings, reservation] = await Promise.all(requests);
        const nextSnippets =
          Array.isArray(smsTextSettings.texts) && smsTextSettings.texts.length > 0
            ? smsTextSettings.texts
            : DEFAULT_QUICK_RESERVATION_SMS_SNIPPETS;
        const nextSelectedGite =
          (reservation?.gite_id ? gitesData.find((gite) => gite.id === reservation.gite_id) : null) ??
          (params.giteId ? gitesData.find((gite) => gite.id === params.giteId) : null) ??
          gitesData[0] ??
          null;

        setGites(gitesData);
        setQuickReservationSmsSnippets(nextSnippets);
        setOrigin(params.origin);
        setBackHref(params.backHref);
        setEditorMode(reservation ? "edit" : params.mode);
        setEditingReservation(reservation);
        setSelectedGiteId(nextSelectedGite?.id ?? "");

        if (reservation) {
          setQuickReservationDraft(
            buildQuickReservationDraftFromReservation({
              reservation,
              gite: nextSelectedGite,
            })
          );
        } else {
          setQuickReservationDraft(
            buildNewQuickReservationDraft({
              startIso: params.entry,
              exitIso: params.exit,
              defaultAdults: Math.max(1, nextSelectedGite?.nb_adultes_habituel ?? 2),
              nightlySuggestion: round2(Math.max(0, Number(nextSelectedGite?.prix_nuit_liste?.[0] ?? 0))),
              gite: nextSelectedGite,
            })
          );
        }
      } catch (error) {
        if (isApiError(error)) {
          setLoadingError(error.message);
        } else {
          setLoadingError("Impossible de charger le formulaire mobile.");
        }
      } finally {
        setLoading(false);
      }
    },
    [clearQuickReservationSavedTimeout]
  );

  useEffect(() => {
    void loadPage({
      mode: initialMode,
      origin: initialOrigin,
      backHref: initialBackHref,
      reservationId: initialReservationId,
      giteId: initialGiteId,
      entry: initialEntry,
      exit: initialExit,
    });
  }, [initialBackHref, initialEntry, initialExit, initialGiteId, initialMode, initialOrigin, initialReservationId, loadPage]);

  useEffect(() => {
    return () => {
      clearQuickReservationSavedTimeout();
      airbnbCalendarRefreshControllersRef.current.forEach((controller) => controller.abort());
    };
  }, [clearQuickReservationSavedTimeout]);

  useEffect(() => {
    if (!quickReservationErrorField) return;
    if (
      quickReservationErrorField === "option_menage" ||
      quickReservationErrorField === "option_depart_tardif" ||
      quickReservationErrorField === "option_draps" ||
      quickReservationErrorField === "option_serviettes"
    ) {
      setOptionsExpanded(true);
    }
  }, [quickReservationErrorField]);

  const selectedGite = useMemo(() => gites.find((gite) => gite.id === selectedGiteId) ?? null, [gites, selectedGiteId]);
  const accentColor = selectedGite ? getGiteColor(selectedGite) : "#ff5a5f";
  const quickReservationAdultsMax = useMemo(() => getQuickReservationAdultsMax(selectedGite), [selectedGite]);
  const quickReservationAdultOptions = useMemo(
    () => Array.from({ length: quickReservationAdultsMax }, (_, index) => index + 1),
    [quickReservationAdultsMax]
  );
  const quickReservationOptionCountMax = useMemo(() => getQuickReservationOptionCountMax(selectedGite), [selectedGite]);
  const quickReservationNightlySuggestions = useMemo(() => {
    const seen = new Set<number>();
    const suggestions: number[] = [];
    const rawList = Array.isArray(selectedGite?.prix_nuit_liste) ? selectedGite.prix_nuit_liste : [];

    rawList.forEach((item) => {
      const nextValue = round2(Math.max(0, Number(item)));
      if (!Number.isFinite(nextValue) || seen.has(nextValue)) return;
      seen.add(nextValue);
      suggestions.push(nextValue);
    });

    return suggestions;
  }, [selectedGite]);
  const quickReservationDerived = useMemo(
    () =>
      computeQuickReservationDerivedState({
        draft: quickReservationDraft,
        editingReservation,
        gite: selectedGite,
        smsSnippets: quickReservationSmsSnippets,
        smsSelection: quickReservationSmsSelection,
      }),
    [editingReservation, quickReservationDraft, quickReservationSmsSelection, quickReservationSmsSnippets, selectedGite]
  );
  const quickReservationDateSummary = quickReservationDerived.dateSummary;
  const quickReservationOptionsPreview = quickReservationDerived.optionsPreview;
  const quickReservationComputedTotal = quickReservationDerived.computedTotal;
  const quickReservationSmsText = quickReservationDerived.smsText;
  const quickReservationSmsHref = quickReservationDerived.smsHref;
  const activeOptionCount =
    Number(quickReservationDraft?.option_menage ? 1 : 0) +
    Number(quickReservationDraft?.option_depart_tardif ? 1 : 0) +
    Number((quickReservationDraft?.option_draps ?? 0) > 0 ? 1 : 0) +
    Number((quickReservationDraft?.option_serviettes ?? 0) > 0 ? 1 : 0);
  const optionsToggleSummary =
    activeOptionCount > 0
      ? `${activeOptionCount} activée${activeOptionCount > 1 ? "s" : ""} · ${formatEuro(quickReservationOptionsPreview.total)}`
      : "Ménage, départ tardif, linge";
  const smsSelectionCount = quickReservationSmsSelection.length;
  const smsToggleSummary =
    smsSelectionCount > 0
      ? `${smsSelectionCount} bloc${smsSelectionCount > 1 ? "s" : ""} ajouté${smsSelectionCount > 1 ? "s" : ""}`
      : "Message prêt à personnaliser";
  const hasLongSmsPreview = useMemo(
    () => quickReservationSmsText.length > 260 || quickReservationSmsText.split("\n").length > 6,
    [quickReservationSmsText]
  );
  const pageStyle = useMemo(
    () =>
      ({
        "--calendar-accent": accentColor,
        "--calendar-accent-soft": `${accentColor}1f`,
      }) as CSSProperties,
    [accentColor]
  );

  const startAirbnbCalendarRefreshPolling = useCallback(
    (refresh: AirbnbCalendarRefreshCreateStatus | undefined) => {
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
        .catch((error) => {
          handleAirbnbCalendarRefreshFailure(error, (message) =>
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
    },
    []
  );

  const goBack = useCallback(() => {
    navigate(backHref);
  }, [backHref, navigate]);

  const handleQuickReservationFieldChange = useCallback(
    (field: keyof QuickReservationDraft, value: string | number | boolean) => {
      clearQuickReservationSavedTimeout();
      setQuickReservationSaveState("idle");
      setQuickReservationError(null);
      setQuickReservationErrorField(null);
      setQuickReservationDraft((current) => {
        if (!current) return current;
        return updateQuickReservationDraftField({
          current,
          field,
          value,
          gite: selectedGite,
        });
      });
    },
    [clearQuickReservationSavedTimeout, selectedGite]
  );

  const saveQuickReservation = useCallback(async () => {
    if (!selectedGiteId || !quickReservationDraft || quickReservationSaving) return;

    const savePayload = buildQuickReservationSavePayload({
      draft: quickReservationDraft,
      gite: selectedGite,
      baseOptions: editingReservation?.options,
    });

    if (!savePayload.ok) {
      setQuickReservationError(savePayload.error);
      setQuickReservationErrorField(savePayload.errorField);
      clearQuickReservationSavedTimeout();
      setQuickReservationSaveState("idle");
      return;
    }

    clearQuickReservationSavedTimeout();
    setQuickReservationSaveState("saving");
    setQuickReservationError(null);
    setQuickReservationErrorField(null);

    let saveSucceeded = false;

    try {
      if (editorMode === "edit") {
        if (!editingReservation) {
          setQuickReservationError("Réservation introuvable.");
          return;
        }

        const updatedReservation = await apiFetch<Reservation>(`/reservations/${editingReservation.id}`, {
          method: "PUT",
          json: {
            gite_id: editingReservation.gite_id ?? selectedGiteId,
            placeholder_id: editingReservation.placeholder_id ?? undefined,
            airbnb_url: editingReservation.airbnb_url ?? undefined,
            ...savePayload.payload,
          },
        });

        const updatedGite = gites.find((gite) => gite.id === updatedReservation.gite_id) ?? selectedGite;
        setEditingReservation(updatedReservation);
        setSelectedGiteId(updatedGite?.id ?? selectedGiteId);
        setQuickReservationDraft(
          buildQuickReservationDraftFromReservation({
            reservation: updatedReservation,
            gite: updatedGite,
          })
        );
      } else {
        const createdReservation = await apiFetch<ReservationCreateResponse>("/reservations", {
          method: "POST",
          json: {
            gite_id: selectedGiteId,
            ...savePayload.payload,
          },
        });

        startAirbnbCalendarRefreshPolling(createdReservation.airbnb_calendar_refresh);
        const nextGite = gites.find((gite) => gite.id === createdReservation.gite_id) ?? selectedGite;
        setEditorMode("edit");
        setEditingReservation(createdReservation);
        setSelectedGiteId(nextGite?.id ?? selectedGiteId);
        setQuickReservationDraft(
          buildQuickReservationDraftFromReservation({
            reservation: createdReservation,
            gite: nextGite,
          })
        );
        navigate(
          buildMobileReservationEditorHref({
            mode: "edit",
            origin,
            backHref,
            reservationId: createdReservation.id,
          }),
          { replace: true }
        );
      }

      saveSucceeded = true;
      setQuickReservationSaveState("saved");
      scheduleQuickReservationSavedReset();
    } catch (error) {
      if (isApiError(error)) {
        setQuickReservationError(error.message);
      } else {
        setQuickReservationError("Impossible d'enregistrer la réservation.");
      }
      setQuickReservationErrorField(null);
    } finally {
      if (!saveSucceeded) setQuickReservationSaveState("idle");
    }
  }, [
    backHref,
    clearQuickReservationSavedTimeout,
    editorMode,
    editingReservation,
    gites,
    navigate,
    origin,
    quickReservationDraft,
    quickReservationSaving,
    scheduleQuickReservationSavedReset,
    selectedGite,
    selectedGiteId,
    startAirbnbCalendarRefreshPolling,
  ]);

  const handlePrimaryAction = useCallback(() => {
    void saveQuickReservation();
  }, [saveQuickReservation]);

  const handleSmsAction = useCallback(() => {
    if (!quickReservationSmsHref) return;
    window.location.href = quickReservationSmsHref;
  }, [quickReservationSmsHref]);

  const quickReservationPrimaryActionLabel = editorMode === "edit" ? "Mettre à jour" : "Enregistrer";
  const quickReservationPrimaryActionStatusLabel = quickReservationSaving
    ? "Enregistrement en cours"
    : quickReservationSaved
      ? "Réservation enregistrée"
      : quickReservationPrimaryActionLabel;

  const renderSaveButton = (className?: string) => (
    <button
      type="button"
      className={`calendar-quick-create-sheet__submit${
        quickReservationSaving
          ? " calendar-quick-create-sheet__submit--saving"
          : quickReservationSaved
            ? " calendar-quick-create-sheet__submit--saved"
            : ""
      }${className ? ` ${className}` : ""}`}
      onClick={handlePrimaryAction}
      disabled={quickReservationSaving}
      aria-label={quickReservationPrimaryActionStatusLabel}
      title={quickReservationPrimaryActionStatusLabel}
    >
      <span className="u-visually-hidden" aria-live="polite" aria-atomic="true">
        {quickReservationPrimaryActionStatusLabel}
      </span>
      <span
        className={`calendar-quick-create-sheet__submit-content${
          quickReservationSaving || quickReservationSaved ? " calendar-quick-create-sheet__submit-content--icon" : ""
        }`}
        aria-hidden="true"
      >
        {quickReservationSaving ? (
          <SaveSpinnerIcon />
        ) : quickReservationSaved ? (
          <SaveCheckIcon />
        ) : (
          <span>{quickReservationPrimaryActionLabel}</span>
        )}
      </span>
    </button>
  );

  const handleDeleteReservation = useCallback(async () => {
    if (!editingReservation || quickReservationDeleting) return;

    const confirmed = window.confirm(`Supprimer la réservation de ${editingReservation.hote_nom.trim() || "cet hôte"} ?`);
    if (!confirmed) return;

    setQuickReservationDeleting(true);
    setQuickReservationError(null);
    setQuickReservationErrorField(null);

    try {
      await apiFetch(`/reservations/${editingReservation.id}`, { method: "DELETE" });
      navigate(backHref, { replace: true });
    } catch (error) {
      if (isApiError(error)) {
        setQuickReservationError(error.message);
      } else {
        setQuickReservationError("Impossible de supprimer la réservation.");
      }
    } finally {
      setQuickReservationDeleting(false);
    }
  }, [backHref, editingReservation, navigate, quickReservationDeleting]);

  if (loading) {
    return (
      <div className="reservation-editor-page" style={pageStyle}>
        <section className="card reservation-editor-page__panel">
          <div className="section-title">Réservation mobile</div>
          <p>Chargement du formulaire...</p>
        </section>
      </div>
    );
  }

  if (loadingError || !quickReservationDraft || !selectedGite) {
    return (
      <div className="reservation-editor-page" style={pageStyle}>
        <button type="button" className="reservation-editor-page__back" onClick={goBack}>
          <ArrowLeftIcon />
          <span>Retour</span>
        </button>
        <section className="card reservation-editor-page__panel">
          <div className="section-title">Réservation mobile</div>
          <p>{loadingError ?? "Impossible d'ouvrir ce formulaire."}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="reservation-editor-page" style={pageStyle}>
      <div className="reservation-editor-page__header-actions">
        <button type="button" className="reservation-editor-page__back" onClick={goBack} disabled={quickReservationDeleting}>
          <ArrowLeftIcon />
          <span>Retour {origin === "calendar" ? "calendrier" : "today"}</span>
        </button>
        {renderSaveButton("reservation-editor-page__save reservation-editor-page__save--header")}
      </div>

      <section className="reservation-editor-page__panel">
        <div className="calendar-quick-create-sheet__top">
          <div className="calendar-quick-create-sheet__header">
            <div>
              <p className="calendar-quick-create-sheet__eyebrow">{selectedGite.nom}</p>
              <h2>{editorMode === "edit" ? "Réservation rapide" : "Nouvelle réservation"}</h2>
            </div>
          </div>

          <div className="calendar-quick-create-sheet__summary">
            <div className="calendar-quick-create-sheet__summary-main">
              <strong className="calendar-quick-create-sheet__summary-dates">
                {quickReservationDateSummary.startIso && quickReservationDateSummary.exitIso
                  ? `${formatShortDate(quickReservationDateSummary.startIso)} → ${formatShortDate(
                      quickReservationDateSummary.exitIso
                    )}`
                  : "Dates à renseigner"}
              </strong>
              <span className="calendar-quick-create-sheet__summary-pill">
                {quickReservationDateSummary.nights} nuit{quickReservationDateSummary.nights > 1 ? "s" : ""}
              </span>
              {quickReservationSaved ? <span className="calendar-quick-create-sheet__saved-pill">Réservation enregistrée</span> : null}
            </div>
            <div className="calendar-quick-create-sheet__summary-total">
              <strong>
                {quickReservationComputedTotal !== null ? formatEuro(quickReservationComputedTotal) : "A calculer"}
              </strong>
            </div>
          </div>
        </div>

        <div className="reservation-editor-page__body">
          {quickReservationError ? <p className="calendar-quick-create-sheet__error">{quickReservationError}</p> : null}

          <div className="calendar-quick-create-sheet__form">
            <section className="calendar-quick-create-sheet__section">
              <label className="field field--small calendar-quick-create-sheet__host-field">
                Hôte
                <input
                  data-reservation-field="hote_nom"
                  type="text"
                  value={quickReservationDraft.hote_nom}
                  placeholder="Nom du voyageur"
                  onChange={(event) => handleQuickReservationFieldChange("hote_nom", event.target.value)}
                />
              </label>

              <label className="field field--small calendar-quick-create-sheet__host-field">
                Téléphone
                <input
                  data-reservation-field="telephone"
                  type="tel"
                  inputMode="tel"
                  value={quickReservationDraft.telephone}
                  placeholder="06 12 34 56 78"
                  onChange={(event) => handleQuickReservationFieldChange("telephone", event.target.value)}
                />
              </label>

              <label className="field field--small calendar-quick-create-sheet__host-field calendar-quick-create-sheet__host-field--source">
                <span className="calendar-quick-create-sheet__source-label">Mode de paiement</span>
                <select
                  data-reservation-field="source_paiement"
                  value={quickReservationDraft.source_paiement}
                  onChange={(event) => handleQuickReservationFieldChange("source_paiement", event.target.value)}
                >
                  {RESERVATION_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>

              <div className="calendar-quick-create-sheet__dates-band">
                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Entrée
                  <input
                    data-reservation-field="date_entree"
                    type="date"
                    value={quickReservationDraft.date_entree}
                    onChange={(event) => handleQuickReservationFieldChange("date_entree", event.target.value)}
                  />
                </label>

                <label className="field field--small calendar-quick-create-sheet__host-field">
                  Sortie
                  <input
                    data-reservation-field="date_sortie"
                    type="date"
                    value={quickReservationDraft.date_sortie}
                    onChange={(event) => handleQuickReservationFieldChange("date_sortie", event.target.value)}
                  />
                </label>
              </div>

              <div className="calendar-quick-create-sheet__stats-grid">
                <label className="field field--small calendar-quick-create-sheet__compact-field calendar-quick-create-sheet__compact-field--adults">
                  <span className="calendar-quick-create-sheet__compact-label">Adultes</span>
                  <select
                    data-reservation-field="nb_adultes"
                    value={quickReservationDraft.nb_adultes}
                    onChange={(event) => handleQuickReservationFieldChange("nb_adultes", Number(event.target.value))}
                  >
                    {quickReservationAdultOptions.map((count) => (
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
                    value={quickReservationDraft.prix_par_nuit}
                    onChange={(event) => handleQuickReservationFieldChange("prix_par_nuit", event.target.value)}
                  />
                </label>

                {quickReservationNightlySuggestions.length > 0 ? (
                  <div className="calendar-quick-create-sheet__prices">
                    <span className="calendar-quick-create-sheet__compact-label">Tarifs du gîte</span>
                    <div className="calendar-quick-create-sheet__price-list">
                      {quickReservationNightlySuggestions.map((price) => {
                        const isActive = Number(quickReservationDraft.prix_par_nuit) === price;
                        return (
                          <button
                            key={price}
                            type="button"
                            className={`calendar-quick-create-sheet__price-chip${
                              isActive ? " calendar-quick-create-sheet__price-chip--active" : ""
                            }`}
                            onClick={() => handleQuickReservationFieldChange("prix_par_nuit", String(price))}
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

              <label className="field field--small calendar-quick-create-sheet__note-field">
                Note
                <textarea
                  data-reservation-field="commentaire"
                  rows={2}
                  value={quickReservationDraft.commentaire}
                  placeholder="Optionnel"
                  onChange={(event) => handleQuickReservationFieldChange("commentaire", event.target.value)}
                />
              </label>
            </section>

            <section className="calendar-quick-create-sheet__section">
              <button
                type="button"
                className={`calendar-quick-create-sheet__section-toggle${
                  optionsExpanded ? " calendar-quick-create-sheet__section-toggle--expanded" : ""
                }`}
                onClick={() => setOptionsExpanded((current) => !current)}
                aria-expanded={optionsExpanded}
              >
                <span className="calendar-quick-create-sheet__section-toggle-copy">
                  <span className="calendar-quick-create-sheet__section-toggle-title">Options</span>
                  <span className="calendar-quick-create-sheet__section-toggle-summary">{optionsToggleSummary}</span>
                </span>
              </button>

              {optionsExpanded ? (
                <div className="calendar-quick-create-sheet__section-body">
                  <div className="calendar-quick-create-sheet__options-card">
                    <label className="calendar-quick-create-sheet__toggle-row">
                      <div>
                        <span className="calendar-quick-create-sheet__toggle-title">Option ménage</span>
                        <span className="calendar-quick-create-sheet__toggle-meta">
                          {formatEuro(Number(selectedGite.options_menage_forfait ?? 0))}
                        </span>
                      </div>
                      <span className="calendar-quick-create-sheet__switch-control">
                        <input
                          data-reservation-field="option_menage"
                          type="checkbox"
                          checked={quickReservationDraft.option_menage}
                          onChange={(event) => handleQuickReservationFieldChange("option_menage", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                      </span>
                    </label>

                    <label className="calendar-quick-create-sheet__toggle-row">
                      <div>
                        <span className="calendar-quick-create-sheet__toggle-title">Départ tardif</span>
                        <span className="calendar-quick-create-sheet__toggle-meta">
                          {quickReservationDraft.option_depart_tardif
                            ? formatEuro(quickReservationOptionsPreview.byKey.depart_tardif)
                            : formatEuro(Number(selectedGite.options_depart_tardif_forfait ?? 0))}
                        </span>
                      </div>
                      <span className="calendar-quick-create-sheet__switch-control">
                        <input
                          data-reservation-field="option_depart_tardif"
                          type="checkbox"
                          checked={quickReservationDraft.option_depart_tardif}
                          onChange={(event) => handleQuickReservationFieldChange("option_depart_tardif", event.target.checked)}
                        />
                        <span aria-hidden="true" />
                      </span>
                    </label>

                    <label className="calendar-quick-create-sheet__range-field">
                      <div className="calendar-quick-create-sheet__range-head">
                        <span className="calendar-quick-create-sheet__toggle-title">Draps</span>
                        <span className="calendar-quick-create-sheet__range-value">
                          {quickReservationDraft.option_draps} · {formatEuro(quickReservationOptionsPreview.byKey.draps)}
                        </span>
                      </div>
                      <input
                        data-reservation-field="option_draps"
                        type="range"
                        min={0}
                        max={quickReservationOptionCountMax}
                        step={1}
                        value={quickReservationDraft.option_draps}
                        onChange={(event) => handleQuickReservationFieldChange("option_draps", Number(event.target.value))}
                      />
                      <span className="calendar-quick-create-sheet__range-meta">
                        {formatEuro(Number(selectedGite.options_draps_par_lit ?? 0))} / lit
                      </span>
                    </label>

                    <label className="calendar-quick-create-sheet__range-field">
                      <div className="calendar-quick-create-sheet__range-head">
                        <span className="calendar-quick-create-sheet__toggle-title">Serviettes</span>
                        <span className="calendar-quick-create-sheet__range-value">
                          {quickReservationDraft.option_serviettes} · {formatEuro(quickReservationOptionsPreview.byKey.linge_toilette)}
                        </span>
                      </div>
                      <input
                        data-reservation-field="option_serviettes"
                        type="range"
                        min={0}
                        max={quickReservationOptionCountMax}
                        step={1}
                        value={quickReservationDraft.option_serviettes}
                        onChange={(event) => handleQuickReservationFieldChange("option_serviettes", Number(event.target.value))}
                      />
                      <span className="calendar-quick-create-sheet__range-meta">
                        {formatEuro(Number(selectedGite.options_linge_toilette_par_personne ?? 0))} / personne
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="calendar-quick-create-sheet__section">
              <button
                type="button"
                className={`calendar-quick-create-sheet__section-toggle${
                  smsExpanded ? " calendar-quick-create-sheet__section-toggle--expanded" : ""
                }`}
                onClick={() => setSmsExpanded((current) => !current)}
                aria-expanded={smsExpanded}
              >
                <span className="calendar-quick-create-sheet__section-toggle-copy">
                  <span className="calendar-quick-create-sheet__section-toggle-title">SMS de confirmation</span>
                  <span className="calendar-quick-create-sheet__section-toggle-summary">{smsToggleSummary}</span>
                </span>
              </button>

              {smsExpanded ? (
                <div className="calendar-quick-create-sheet__section-body">
                  <div className="calendar-quick-create-sheet__switches">
                    {quickReservationSmsSnippets.map((snippet) => {
                      const checked = quickReservationSmsSelection.includes(snippet.id);
                      return (
                        <label key={snippet.id} className="calendar-quick-create-sheet__switch">
                          <span>{snippet.title}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setQuickReservationSmsSelection((current) =>
                                event.target.checked ? [...current, snippet.id] : current.filter((item) => item !== snippet.id)
                              )
                            }
                          />
                        </label>
                      );
                    })}
                  </div>

                  <div
                    className={`calendar-quick-create-sheet__sms-preview${
                      !smsPreviewExpanded && hasLongSmsPreview ? " calendar-quick-create-sheet__sms-preview--collapsed" : ""
                    }`}
                  >
                    <pre>{quickReservationSmsText}</pre>
                  </div>

                  {hasLongSmsPreview ? (
                    <button
                      type="button"
                      className="calendar-quick-create-sheet__preview-toggle"
                      onClick={() => setSmsPreviewExpanded((current) => !current)}
                    >
                      {smsPreviewExpanded ? "Réduire l'aperçu" : "Voir tout le SMS"}
                    </button>
                  ) : null}

                  <div className="calendar-quick-create-sheet__sms-actions">
                    <button
                      type="button"
                      className="calendar-quick-create-sheet__copy"
                      onClick={() => {
                        if (!navigator.clipboard?.writeText) return;
                        void navigator.clipboard.writeText(quickReservationSmsText);
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
                    <span className="calendar-quick-create-sheet__sms-hint">
                      {quickReservationSmsHref
                        ? "Le bouton Envoi SMS ouvre la messagerie."
                        : "Ajoute un numéro pour envoyer le SMS."}
                    </span>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <div className="calendar-quick-create-sheet__footer reservation-editor-page__footer">
          {renderSaveButton("reservation-editor-page__save")}
          <button
            type="button"
            className="calendar-quick-create-sheet__submit calendar-quick-create-sheet__submit--sms"
            onClick={handleSmsAction}
            disabled={quickReservationSaving || !quickReservationSmsHref}
          >
            Envoi SMS
          </button>
          <button type="button" className="reservation-editor-page__back reservation-editor-page__back--footer" onClick={goBack}>
            <ArrowLeftIcon />
            <span>Retour</span>
          </button>
          {editingReservation ? (
            <button
              type="button"
              className="reservation-editor-page__delete reservation-editor-page__delete--footer"
              onClick={handleDeleteReservation}
              disabled={quickReservationSaving || quickReservationDeleting}
            >
              {quickReservationDeleting ? "Suppression..." : "Supprimer"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
};

export default MobileReservationEditorPage;
