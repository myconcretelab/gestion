import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DayPicker, type DateRange } from "@daypicker/react";
import { fr } from "@daypicker/react/locale";
import "@daypicker/react/style.css";
import { apiFetch, formatApiErrorMessage, isAbortError } from "../utils/api";
import { getGiteColor } from "../utils/giteColors";
import {
  addUtcDays,
  buildPrintableOperationRows,
  diffUtcDays,
  enumerateIsoDates,
  filterArrivalOperationRows,
  getAlreadyHandledArrivalRowKeys,
  parseIsoDateUtc,
  reservationOverlapsPeriod,
  toIsoDateUtc,
  type StayOperation,
} from "../utils/printableOperations";
import type {
  Gite,
  PlanningRelayPeriod,
  PlanningRelaySmsConfig,
  PlanningRelaySmsPreview,
  PlanningRelaySmsStatus,
  PlanningRelaySmsTestResult,
  PlanningRelayWorker,
  Reservation,
} from "../utils/types";

const MAX_DAYS = 31;
const SAVED_PERIODS_STORAGE_KEY = "operations-print-saved-periods";

type LegacySavedPeriod = {
  id: string;
  from: string;
  to: string;
};

type PlanningRelayPeriodDraft = {
  label: string;
  is_active: boolean;
  show_timeline: boolean;
  show_comments: boolean;
  show_phones: boolean;
  show_options: boolean;
  arrivals_only: boolean;
  stay_nights: string;
  sms_configs: PlanningRelaySmsConfig[];
};

type PlanningRelayWorkerDraft = {
  nom: string;
  telephone: string;
  email: string;
  adresse: string;
  is_active: boolean;
};

const EMPTY_WORKER_DRAFT: PlanningRelayWorkerDraft = {
  nom: "",
  telephone: "",
  email: "",
  adresse: "",
  is_active: true,
};

const readLegacySavedPeriods = (): LegacySavedPeriod[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SAVED_PERIODS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((period): period is LegacySavedPeriod =>
      typeof period === "object" && period !== null &&
      typeof period.id === "string" &&
      typeof period.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(period.from) &&
      typeof period.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(period.to) &&
      period.from <= period.to
    );
  } catch {
    return [];
  }
};

const todayIso = () => {
  const now = new Date();
  return toIsoDateUtc(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
};

const isoToPickerDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const pickerDateToIso = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDayHeader = (value: string) => {
  const date = parseIsoDateUtc(value);
  return {
    weekday: date.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" }).replace(".", ""),
    day: date.getUTCDate(),
  };
};

const formatLongDate = (value: string) =>
  parseIsoDateUtc(value).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const formatShortDate = (value: string) =>
  parseIsoDateUtc(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

const formatOperationDate = (value: string) =>
  parseIsoDateUtc(value).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const formatRange = (from: string, to: string) =>
  from === to ? formatLongDate(from) : `du ${formatLongDate(from)} au ${formatLongDate(to)}`;

const formatSavedPeriod = (from: string, to: string) =>
  `${formatShortDate(from)} → ${formatShortDate(to)}`;

const PlanningRelaySmsLivePreview = ({
  period,
  config,
}: {
  period: PlanningRelayPeriod;
  config: PlanningRelaySmsConfig;
}) => {
  const [preview, setPreview] = useState<PlanningRelaySmsPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.worker_id || !config.template.trim()) {
      setPreview(null);
      setPreviewError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setPreviewError(null);
      apiFetch<PlanningRelaySmsPreview>(`/planning-relay-periods/${period.id}/preview-sms`, {
        method: "POST",
        signal: controller.signal,
        json: { config },
      })
        .then(setPreview)
        .catch((caught) => {
          if (!isAbortError(caught)) {
            setPreview(null);
            setPreviewError(formatApiErrorMessage(caught, "Impossible de générer l’aperçu."));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [config, period.id]);

  const emptyMessage = !config.worker_id
    ? "Choisissez un intervenant pour afficher l’aperçu."
    : !config.template.trim()
      ? "Saisissez le texte du SMS pour afficher l’aperçu."
      : "Aucune intervention n’est prévue sur cette période avec les filtres actuels.";

  return (
    <section className="operations-sms-preview" aria-live="polite">
      <header>
        <strong>Aperçu du SMS envoyé</strong>
        {preview?.target_date ? <span>Programme du {formatShortDate(preview.target_date)}</span> : null}
      </header>
      <div className={`operations-sms-preview__message${preview?.message ? "" : " is-empty"}`}>
        {loading ? "Actualisation…" : previewError ?? preview?.message ?? emptyMessage}
      </div>
      {preview?.message && !loading ? <small>{preview.message.length} caractère{preview.message.length > 1 ? "s" : ""}</small> : null}
    </section>
  );
};

const buildPeriodDraft = (period: PlanningRelayPeriod): PlanningRelayPeriodDraft => ({
  label: period.label,
  is_active: period.is_active,
  show_timeline: period.show_timeline,
  show_comments: period.show_comments,
  show_phones: period.show_phones,
  show_options: period.show_options,
  arrivals_only: period.arrivals_only,
  stay_nights: period.stay_nights ? String(period.stay_nights) : "",
  sms_configs: period.sms_configs ?? [],
});

const createSmsConfig = (): PlanningRelaySmsConfig => ({
  id: globalThis.crypto?.randomUUID?.() ?? `sms-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  worker_id: "",
  enabled: true,
  send_time: "18:00",
  send_day: "previous_day",
  template: "{{gite}} : {{horaire}} ({{in-out}})",
  last_sent_for_date: null,
  last_attempt_for_date: null,
});

const buildWorkerDraft = (worker: PlanningRelayWorker): PlanningRelayWorkerDraft => ({
  nom: worker.nom,
  telephone: worker.telephone,
  email: worker.email ?? "",
  adresse: worker.adresse ?? "",
  is_active: worker.is_active,
});

const formatGiteTime = (value?: string) => {
  if (!value) return "—";
  const [hours, minutes] = value.split(":");
  return minutes && minutes !== "00" ? `${hours}h${minutes}` : `${hours}h`;
};

const getOperationSchedule = (reservation: Reservation, hasArrival: boolean, hasDeparture: boolean) => {
  const arrivalTime = formatGiteTime(reservation.gite?.heure_arrivee_defaut);
  const departureTime = formatGiteTime(reservation.gite?.heure_depart_defaut);

  if (hasArrival && hasDeparture) return `Entre ${departureTime} et ${arrivalTime}`;
  if (hasDeparture) return `À partir de ${departureTime}`;
  return `Avant ${arrivalTime}`;
};

const getOperationTone = (operations: StayOperation[]) => {
  const kinds = new Set(operations.map((operation) => operation.kind));
  if (kinds.has("arrival") && kinds.has("departure")) return "rotation";
  if (kinds.has("departure")) return "departure";
  return "arrival";
};

const OperationsPrintPage = () => {
  const initialFrom = todayIso();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(toIsoDateUtc(addUtcDays(parseIsoDateUtc(initialFrom), 13)));
  const [periodPickerIsOpen, setPeriodPickerIsOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<DateRange>();
  const [gites, setGites] = useState<Gite[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedGiteIds, setSelectedGiteIds] = useState<Set<string>>(new Set());
  const [savedPeriods, setSavedPeriods] = useState<PlanningRelayPeriod[]>([]);
  const [selectedSavedPeriodId, setSelectedSavedPeriodId] = useState<string | null>(null);
  const [savedPeriodsLoaded, setSavedPeriodsLoaded] = useState(false);
  const [savedPeriodsError, setSavedPeriodsError] = useState<string | null>(null);
  const [savedPeriodsNotice, setSavedPeriodsNotice] = useState<string | null>(null);
  const [smsStatus, setSmsStatus] = useState<PlanningRelaySmsStatus | null>(null);
  const [periodManagerIsOpen, setPeriodManagerIsOpen] = useState(false);
  const [workerManagerIsOpen, setWorkerManagerIsOpen] = useState(false);
  const [periodDrafts, setPeriodDrafts] = useState<Record<string, PlanningRelayPeriodDraft>>({});
  const [workers, setWorkers] = useState<PlanningRelayWorker[]>([]);
  const [workerDrafts, setWorkerDrafts] = useState<Record<string, PlanningRelayWorkerDraft>>({});
  const [newWorkerDraft, setNewWorkerDraft] = useState<PlanningRelayWorkerDraft>(EMPTY_WORKER_DRAFT);
  const [savingPeriodDetailsId, setSavingPeriodDetailsId] = useState<string | null>(null);
  const [testingPeriodSmsId, setTestingPeriodSmsId] = useState<string | null>(null);
  const [savingWorkerId, setSavingWorkerId] = useState<string | null>(null);
  const [deletingWorkerId, setDeletingWorkerId] = useState<string | null>(null);
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showPhones, setShowPhones] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [arrivalsOnly, setArrivalsOnly] = useState(false);
  const [stayNightsFilter, setStayNightsFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const periodPickerRef = useRef<HTMLDivElement>(null);
  const legacyMigrationAttemptedRef = useRef(false);

  const dayCount = diffUtcDays(parseIsoDateUtc(to), parseIsoDateUtc(from)) + 1;
  const periodIsValid = dayCount >= 1 && dayCount <= MAX_DAYS;

  const refreshSavedPeriods = useCallback(async () => {
    try {
      const periods = await apiFetch<PlanningRelayPeriod[]>("/planning-relay-periods");
      setSavedPeriods(periods);
      setSavedPeriodsError(null);
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible de charger les périodes enregistrées."));
    } finally {
      setSavedPeriodsLoaded(true);
    }
  }, []);

  const refreshWorkers = useCallback(async () => {
    try {
      const nextWorkers = await apiFetch<PlanningRelayWorker[]>("/planning-relay-periods/workers");
      setWorkers(nextWorkers);
      setSavedPeriodsError(null);
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible de charger les intervenants."));
    }
  }, []);

  useEffect(() => {
    void refreshSavedPeriods();
  }, [refreshSavedPeriods]);

  useEffect(() => {
    void refreshWorkers();
  }, [refreshWorkers]);

  useEffect(() => {
    apiFetch<PlanningRelaySmsStatus>("/planning-relay-periods/sms/status")
      .then(setSmsStatus)
      .catch(() => setSmsStatus({ configured: false, missing: ["SMS"] }));
  }, []);

  useEffect(() => {
    setPeriodDrafts((current) => {
      const next: Record<string, PlanningRelayPeriodDraft> = {};
      for (const period of savedPeriods) {
        next[period.id] = current[period.id] ?? buildPeriodDraft(period);
      }
      return next;
    });
  }, [savedPeriods]);

  useEffect(() => {
    setWorkerDrafts((current) => {
      const next: Record<string, PlanningRelayWorkerDraft> = {};
      for (const worker of workers) {
        next[worker.id] = current[worker.id] ?? buildWorkerDraft(worker);
      }
      return next;
    });
  }, [workers]);

  useEffect(() => {
    if (!periodPickerIsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!periodPickerRef.current?.contains(event.target as Node)) setPeriodPickerIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeriodPickerIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [periodPickerIsOpen]);

  useEffect(() => {
    if (!periodIsValid) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });

    Promise.all([
      apiFetch<Gite[]>("/gites", { signal: controller.signal }),
      apiFetch<Reservation[]>(`/reservations?${params.toString()}`, { signal: controller.signal }),
    ])
      .then(([nextGites, nextReservations]) => {
        const orderedGites = [...nextGites].sort((left, right) =>
          (left.ordre ?? 0) - (right.ordre ?? 0) || left.nom.localeCompare(right.nom, "fr")
        );
        setGites(orderedGites);
        setReservations(nextReservations);
        setSelectedGiteIds((current) => current.size > 0 ? current : new Set(orderedGites.map((gite) => gite.id)));
      })
      .catch((caught) => {
        if (!isAbortError(caught)) {
          setError(caught instanceof Error ? caught.message : "Impossible de charger le planning.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [from, periodIsValid, to]);

  useEffect(() => {
    if (!savedPeriodsLoaded || gites.length === 0 || legacyMigrationAttemptedRef.current) return;
    legacyMigrationAttemptedRef.current = true;
    const legacyPeriods = readLegacySavedPeriods();
    if (legacyPeriods.length === 0) return;

    const migrate = async () => {
      try {
        const existingKeys = new Set(savedPeriods.map((period) => `${period.from}_${period.to}`));
        for (const legacy of legacyPeriods) {
          if (existingKeys.has(`${legacy.from}_${legacy.to}`)) continue;
          await apiFetch<PlanningRelayPeriod>("/planning-relay-periods", {
            method: "POST",
            json: {
              label: formatSavedPeriod(legacy.from, legacy.to),
              from: legacy.from,
              to: legacy.to,
              gite_ids: gites.map((gite) => gite.id),
              show_timeline: false,
              show_comments: false,
              show_phones: false,
              show_options: false,
              arrivals_only: false,
            },
          });
        }
        window.localStorage.removeItem(SAVED_PERIODS_STORAGE_KEY);
        await refreshSavedPeriods();
      } catch (caught) {
        setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible de migrer les périodes locales."));
      }
    };

    void migrate();
  }, [gites, refreshSavedPeriods, savedPeriods, savedPeriodsLoaded]);

  const days = useMemo(() => periodIsValid ? enumerateIsoDates(from, to) : [], [from, periodIsValid, to]);
  const visibleGites = useMemo(
    () => gites.filter((gite) => selectedGiteIds.has(gite.id)),
    [gites, selectedGiteIds]
  );
  const visibleReservations = useMemo(
    () => reservations.filter((reservation) =>
      Boolean(reservation.gite_id && selectedGiteIds.has(reservation.gite_id)) &&
      reservationOverlapsPeriod(reservation, from, to) &&
      (!stayNightsFilter || reservation.nb_nuits >= Number(stayNightsFilter))
    ),
    [from, reservations, selectedGiteIds, stayNightsFilter, to]
  );

  const allOperationsByDate = useMemo(() => {
    return buildPrintableOperationRows(days, visibleReservations);
  }, [days, visibleReservations]);
  const operationsByDate = useMemo(
    () => filterArrivalOperationRows(allOperationsByDate, arrivalsOnly),
    [allOperationsByDate, arrivalsOnly],
  );
  const alreadyHandledArrivalRows = useMemo(
    () => getAlreadyHandledArrivalRowKeys(allOperationsByDate),
    [allOperationsByDate],
  );
  const interventionCount = operationsByDate.filter(
    (row) => !alreadyHandledArrivalRows.has(`${row.date}-${row.giteId}`),
  ).length;
  const activeSavedPeriod = useMemo(() => {
    const matchingPeriods = savedPeriods.filter((period) =>
      period.from === from &&
      period.to === to &&
      (period.stay_nights ?? null) === (stayNightsFilter ? Number(stayNightsFilter) : null) &&
      period.arrivals_only === arrivalsOnly &&
      period.show_options === showOptions &&
      period.gite_ids.length === selectedGiteIds.size &&
      period.gite_ids.every((id) => selectedGiteIds.has(id))
    );
    return matchingPeriods.find((period) => period.id === selectedSavedPeriodId)
      ?? (matchingPeriods.length === 1 ? matchingPeriods[0] : null);
  }, [arrivalsOnly, from, savedPeriods, selectedGiteIds, selectedSavedPeriodId, showOptions, stayNightsFilter, to]);
  const activeWorkers = useMemo(
    () => workers.filter((worker) => worker.is_active),
    [workers],
  );

  const setPreset = (daysToShow: number) => {
    setTo(toIsoDateUtc(addUtcDays(parseIsoDateUtc(from), daysToShow - 1)));
  };

  const togglePeriodPicker = () => {
    if (!periodPickerIsOpen) {
      setDraftPeriod({ from: isoToPickerDate(from), to: isoToPickerDate(to) });
    }
    setPeriodPickerIsOpen((current) => !current);
  };

  const selectPeriod = (period: DateRange | undefined) => {
    setDraftPeriod(period);
    if (!period?.from || !period.to) return;

    setFrom(pickerDateToIso(period.from));
    setTo(pickerDateToIso(period.to));
    setPeriodPickerIsOpen(false);
  };

  const savePeriod = async () => {
    if (!periodIsValid || selectedGiteIds.size === 0 || savingPeriod) return;
    if ((showComments || showPhones) && !window.confirm("Le lien public donnera accès aux informations sélectionnées. Continuer ?")) return;
    setSavingPeriod(true);
    setSavedPeriodsError(null);
    setSavedPeriodsNotice(null);
    try {
      const period = await apiFetch<PlanningRelayPeriod>("/planning-relay-periods", {
        method: "POST",
        json: {
          label: formatSavedPeriod(from, to),
          from,
          to,
          gite_ids: [...selectedGiteIds],
          show_timeline: showTimeline,
          show_comments: showComments,
          show_phones: showPhones,
          show_options: showOptions,
          arrivals_only: arrivalsOnly,
          stay_nights: stayNightsFilter ? Number(stayNightsFilter) : null,
        },
      });
      setSavedPeriods((current) => [...current, period]);
      setSelectedSavedPeriodId(period.id);
      setSavedPeriodsNotice("Période enregistrée.");
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible d’enregistrer la période."));
    } finally {
      setSavingPeriod(false);
    }
  };

  const applySavedPeriod = (period: PlanningRelayPeriod) => {
    setSelectedSavedPeriodId(period.id);
    setFrom(period.from);
    setTo(period.to);
    setSelectedGiteIds(new Set(period.gite_ids));
    setShowTimeline(period.show_timeline);
    setShowComments(period.show_comments);
    setShowPhones(period.show_phones);
    setShowOptions(period.show_options);
    setArrivalsOnly(period.arrivals_only);
    setStayNightsFilter(period.stay_nights ? String(period.stay_nights) : "");
  };

  const updateSavedPeriod = (updated: PlanningRelayPeriod) => {
    setSavedPeriods((current) => current.map((period) => period.id === updated.id ? updated : period));
    setPeriodDrafts((current) => ({ ...current, [updated.id]: buildPeriodDraft(updated) }));
  };

  const removeSavedPeriod = async (period: PlanningRelayPeriod) => {
    if (!window.confirm(`Supprimer la période « ${period.label} » ?`)) return;
    try {
      await apiFetch(`/planning-relay-periods/${period.id}`, { method: "DELETE" });
      setSavedPeriods((current) => current.filter((item) => item.id !== period.id));
      if (selectedSavedPeriodId === period.id) setSelectedSavedPeriodId(null);
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible de supprimer la période."));
    }
  };

  const rotateSavedPeriodLink = async (period: PlanningRelayPeriod) => {
    if (!window.confirm("L’ancien lien cessera immédiatement de fonctionner. Continuer ?")) return;
    try {
      updateSavedPeriod(await apiFetch<PlanningRelayPeriod>(`/planning-relay-periods/${period.id}/rotate-link`, { method: "POST" }));
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible de régénérer le lien."));
    }
  };

  const copySavedPeriodLink = async (period: PlanningRelayPeriod) => {
    try {
      await navigator.clipboard.writeText(new URL(period.public_path, window.location.origin).toString());
      setSavedPeriodsError(null);
      setSavedPeriodsNotice("Lien copié.");
    } catch {
      setSavedPeriodsError("Impossible de copier le lien. Ouvrez le planning puis copiez son adresse.");
    }
  };

  const updatePeriodDraft = (periodId: string, patch: Partial<PlanningRelayPeriodDraft>) => {
    setPeriodDrafts((current) => {
      const period = savedPeriods.find((item) => item.id === periodId);
      const existing = current[periodId] ?? (period ? buildPeriodDraft(period) : null);
      if (!existing) return current;
      return {
        ...current,
        [periodId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const updateSmsConfig = (periodId: string, configId: string, patch: Partial<PlanningRelaySmsConfig>) => {
    const period = savedPeriods.find((item) => item.id === periodId);
    const draft = periodDrafts[periodId] ?? (period ? buildPeriodDraft(period) : null);
    if (!draft) return;
    updatePeriodDraft(periodId, {
      sms_configs: draft.sms_configs.map((config) => config.id === configId ? { ...config, ...patch } : config),
    });
  };

  const addSmsConfig = (periodId: string) => {
    const period = savedPeriods.find((item) => item.id === periodId);
    const draft = periodDrafts[periodId] ?? (period ? buildPeriodDraft(period) : null);
    if (!draft) return;
    updatePeriodDraft(periodId, { sms_configs: [...draft.sms_configs, createSmsConfig()] });
  };

  const updateWorkerDraft = (workerId: string, patch: Partial<PlanningRelayWorkerDraft>) => {
    setWorkerDrafts((current) => {
      const worker = workers.find((item) => item.id === workerId);
      const existing = current[workerId] ?? (worker ? buildWorkerDraft(worker) : null);
      if (!existing) return current;
      return { ...current, [workerId]: { ...existing, ...patch } };
    });
  };

  const createWorker = async () => {
    if (creatingWorker) return;
    if (!newWorkerDraft.nom.trim() || !newWorkerDraft.telephone.trim()) {
      setSavedPeriodsError("Le nom et le téléphone de l'intervenant sont obligatoires.");
      return;
    }

    setCreatingWorker(true);
    setSavedPeriodsError(null);
    setSavedPeriodsNotice(null);
    try {
      const worker = await apiFetch<PlanningRelayWorker>("/planning-relay-periods/workers", {
        method: "POST",
        json: {
          nom: newWorkerDraft.nom.trim(),
          telephone: newWorkerDraft.telephone.trim(),
          email: newWorkerDraft.email.trim() || null,
          adresse: newWorkerDraft.adresse.trim() || null,
          is_active: newWorkerDraft.is_active,
        },
      });
      setWorkers((current) => [...current, worker].sort((left, right) =>
        Number(right.is_active) - Number(left.is_active) || left.nom.localeCompare(right.nom, "fr")
      ));
      setNewWorkerDraft(EMPTY_WORKER_DRAFT);
      setSavedPeriodsNotice("Intervenant ajouté.");
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible d'ajouter l'intervenant."));
    } finally {
      setCreatingWorker(false);
    }
  };

  const saveWorker = async (worker: PlanningRelayWorker) => {
    const draft = workerDrafts[worker.id] ?? buildWorkerDraft(worker);
    if (!draft.nom.trim() || !draft.telephone.trim()) {
      setSavedPeriodsError("Le nom et le téléphone de l'intervenant sont obligatoires.");
      return;
    }

    setSavingWorkerId(worker.id);
    setSavedPeriodsError(null);
    setSavedPeriodsNotice(null);
    try {
      const updated = await apiFetch<PlanningRelayWorker>(`/planning-relay-periods/workers/${worker.id}`, {
        method: "PATCH",
        json: {
          nom: draft.nom.trim(),
          telephone: draft.telephone.trim(),
          email: draft.email.trim() || null,
          adresse: draft.adresse.trim() || null,
          is_active: draft.is_active,
        },
      });
      setWorkers((current) => current.map((item) => item.id === updated.id ? updated : item).sort((left, right) =>
        Number(right.is_active) - Number(left.is_active) || left.nom.localeCompare(right.nom, "fr")
      ));
      setWorkerDrafts((current) => ({ ...current, [updated.id]: buildWorkerDraft(updated) }));
      setSavedPeriodsNotice("Intervenant enregistré.");
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible d'enregistrer l'intervenant."));
    } finally {
      setSavingWorkerId(null);
    }
  };

  const deleteWorker = async (worker: PlanningRelayWorker) => {
    if (!window.confirm(`Supprimer l'intervenant « ${worker.nom} » ? Il sera retiré des périodes qui l’utilisent.`)) return;
    setDeletingWorkerId(worker.id);
    setSavedPeriodsError(null);
    setSavedPeriodsNotice(null);
    try {
      await apiFetch(`/planning-relay-periods/workers/${worker.id}`, { method: "DELETE" });
      setWorkers((current) => current.filter((item) => item.id !== worker.id));
      await refreshSavedPeriods();
      setSavedPeriodsNotice("Intervenant supprimé.");
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible de supprimer l'intervenant."));
    } finally {
      setDeletingWorkerId(null);
    }
  };

  const savePeriodDetails = async (period: PlanningRelayPeriod) => {
    const draft = periodDrafts[period.id] ?? buildPeriodDraft(period);
    if (!draft.label.trim()) {
      setSavedPeriodsError("Le nom de la période est obligatoire.");
      return;
    }
    if (draft.sms_configs.some((config) => !config.worker_id)) {
      setSavedPeriodsError("Choisissez un intervenant pour chaque SMS.");
      return;
    }

    setSavingPeriodDetailsId(period.id);
    setSavedPeriodsError(null);
    setSavedPeriodsNotice(null);
    try {
      updateSavedPeriod(await apiFetch<PlanningRelayPeriod>(`/planning-relay-periods/${period.id}`, {
        method: "PATCH",
        json: {
          label: draft.label.trim(),
          is_active: draft.is_active,
          show_timeline: draft.show_timeline,
          show_comments: draft.show_comments,
          show_phones: draft.show_phones,
          show_options: draft.show_options,
          arrivals_only: draft.arrivals_only,
          stay_nights: draft.stay_nights ? Number(draft.stay_nights) : null,
          sms_configs: draft.sms_configs,
        },
      }));
      setSavedPeriodsNotice("Détails de la période enregistrés.");
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible d'enregistrer la période."));
    } finally {
      setSavingPeriodDetailsId(null);
    }
  };

  const sendPeriodTestSms = async (period: PlanningRelayPeriod, config: PlanningRelaySmsConfig) => {
    if (!config.worker_id) {
      setSavedPeriodsError("Choisissez un intervenant avant d'envoyer un test.");
      return;
    }
    if (!smsStatus?.configured) {
      setSavedPeriodsError("La configuration SMS OVH est incomplète.");
      return;
    }

    setTestingPeriodSmsId(period.id);
    setSavedPeriodsError(null);
    setSavedPeriodsNotice(null);
    try {
      const result = await apiFetch<PlanningRelaySmsTestResult>(`/planning-relay-periods/${period.id}/send-test-sms`, {
        method: "POST",
        json: { config },
      });
      setSavedPeriodsNotice(`SMS test envoyé pour le ${formatShortDate(result.target_date)}.`);
    } catch (caught) {
      setSavedPeriodsError(formatApiErrorMessage(caught, "Impossible d'envoyer le SMS test."));
    } finally {
      setTestingPeriodSmsId(null);
    }
  };

  const toggleGite = (giteId: string) => {
    setSelectedGiteIds((current) => {
      const next = new Set(current);
      if (next.has(giteId)) next.delete(giteId);
      else next.add(giteId);
      return next;
    });
  };

  const timelineColumns = {
    "--operations-day-count": Math.max(1, days.length),
  } as CSSProperties;

  return (
    <div className="operations-print-page">
      <section className="operations-controls no-print" aria-labelledby="operations-page-title">
        <div>
          <div className="operations-controls__eyebrow">Relais pendant une absence</div>
          <h1 id="operations-page-title">Planning à imprimer</h1>
          <p>Choisissez jusqu’à 31 jours. La feuille regroupe l’occupation et toutes les interventions à prévoir.</p>
        </div>
        <div className="operations-controls__dates">
          <div className="field operations-period-field" ref={periodPickerRef}>
            <span>Période</span>
            <button
              type="button"
              className="operations-period-trigger"
              aria-expanded={periodPickerIsOpen}
              aria-haspopup="dialog"
              onClick={togglePeriodPicker}
            >
              <span>{formatSavedPeriod(from, to)}</span>
              <svg className="operations-period-trigger__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
              </svg>
            </button>
            {periodPickerIsOpen ? (
              <div className="operations-period-popover" role="dialog" aria-label="Sélectionner une période">
                <DayPicker
                  className="operations-range-calendar"
                  mode="range"
                  locale={fr}
                  numberOfMonths={2}
                  defaultMonth={draftPeriod?.from}
                  selected={draftPeriod}
                  onSelect={selectPeriod}
                  max={MAX_DAYS - 1}
                  resetOnSelect
                />
                <p className="operations-period-popover__hint">
                  {draftPeriod?.from && !draftPeriod.to
                    ? "Choisissez maintenant la date de fin."
                    : "Choisissez la date de début, puis la date de fin."}
                </p>
              </div>
            ) : null}
          </div>
          <div className="operations-presets" aria-label="Durées rapides">
            {[7, 14, 21, 31].map((count) => (
              <button key={count} type="button" className={dayCount === count ? "" : "secondary"} onClick={() => setPreset(count)}>
                {count} j
              </button>
            ))}
            <button type="button" className="secondary operations-presets__save" onClick={() => void savePeriod()} disabled={!periodIsValid || selectedGiteIds.size === 0 || savingPeriod}>
              {savingPeriod ? "Enregistrement…" : "Enregistrer la période"}
            </button>
          </div>
          <label className="field operations-stay-nights-filter">
            <span>N'afficher que les séjours d'au moins</span>
            <div>
              <input
                type="number"
                min="1"
                max="365"
                inputMode="numeric"
                value={stayNightsFilter}
                onChange={(event) => setStayNightsFilter(event.target.value)}
                placeholder="Toutes"
              />
              <span>nuits</span>
              {stayNightsFilter ? <button type="button" className="secondary" onClick={() => setStayNightsFilter("")}>Effacer</button> : null}
            </div>
          </label>
          {savedPeriodsNotice ? <div className="operations-saved-periods__notice">{savedPeriodsNotice}</div> : null}
          {savedPeriodsError ? <div className="operations-saved-periods__error">{savedPeriodsError}</div> : null}
          {savedPeriods.length > 0 ? (
            <>
              <div className="operations-saved-periods" aria-label="Périodes enregistrées">
                {savedPeriods.map((period) => {
                  const isSelected = activeSavedPeriod?.id === period.id;
                  const isExpired = Boolean(period.expires_at && new Date(period.expires_at).getTime() < Date.now());
                  const isAvailable = period.is_active && !isExpired;
                  return (
                    <span key={period.id} className={`operations-saved-period${isSelected ? " is-active" : ""}${isAvailable ? "" : " is-disabled"}`}>
                      <button type="button" onClick={() => applySavedPeriod(period)} aria-pressed={isSelected} title={formatSavedPeriod(period.from, period.to)}>
                        {period.label}
                        {period.sms_configs?.some((config) => config.enabled) ? <span className="operations-saved-period__sms-dot" aria-label="SMS automatique actif" /> : null}
                      </button>
                    </span>
                  );
                })}
                <button type="button" className="secondary operations-saved-periods__manage" onClick={() => setPeriodManagerIsOpen(true)}>
                  Gérer
                </button>
              </div>
            </>
          ) : null}
          <div className="operations-worker-mini">
            <div>
              <strong>Intervenants</strong>
              <span>
                {workers.length === 0
                  ? "Aucun intervenant"
                  : `${activeWorkers.length} actif${activeWorkers.length > 1 ? "s" : ""} sur ${workers.length}`}
              </span>
            </div>
            {activeWorkers.length > 0 ? (
              <div className="operations-worker-mini__chips" aria-label="Intervenants actifs">
                {activeWorkers.slice(0, 4).map((worker) => <span key={worker.id}>{worker.nom}</span>)}
                {activeWorkers.length > 4 ? <span>+{activeWorkers.length - 4}</span> : null}
              </div>
            ) : null}
            <p>Chaque période peut utiliser un intervenant pour son SMS automatique.</p>
            <button type="button" className="secondary" onClick={() => setWorkerManagerIsOpen(true)}>
              Gérer les intervenants
            </button>
          </div>
        </div>
        {!periodIsValid ? <div className="operations-error">La période doit contenir entre 1 et 31 jours.</div> : null}
        <div className="operations-controls__options">
          <fieldset>
            <legend>Gîtes imprimés</legend>
            <div className="operations-gite-picker">
              {gites.map((gite, index) => (
                <label key={gite.id} className={selectedGiteIds.has(gite.id) ? "is-selected" : ""}>
                  <input type="checkbox" checked={selectedGiteIds.has(gite.id)} onChange={() => toggleGite(gite.id)} />
                  <span style={{ "--gite-color": getGiteColor(gite, index) } as CSSProperties} />
                  {gite.nom}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="operations-detail-toggles">
            <label><input type="checkbox" checked={showTimeline} onChange={(event) => setShowTimeline(event.target.checked)} /> Tableau graphique</label>
            <label><input type="checkbox" checked={arrivalsOnly} onChange={(event) => setArrivalsOnly(event.target.checked)} /> Entrées uniquement</label>
            <label><input type="checkbox" checked={showOptions} onChange={(event) => setShowOptions(event.target.checked)} /> Afficher la colonne Options</label>
            <label><input type="checkbox" checked={showComments} onChange={(event) => setShowComments(event.target.checked)} /> Commentaires</label>
            <label><input type="checkbox" checked={showPhones} onChange={(event) => setShowPhones(event.target.checked)} /> Téléphones</label>
          </div>
          <button type="button" onClick={() => window.print()} disabled={!periodIsValid || loading || visibleGites.length === 0}>
            Imprimer la feuille A4
          </button>
        </div>
      </section>

      {periodManagerIsOpen ? (
        <div className="operations-period-drawer no-print" role="dialog" aria-modal="true" aria-labelledby="operations-period-drawer-title">
          <button
            type="button"
            className="operations-period-drawer__backdrop"
            aria-label="Fermer la gestion des périodes"
            onClick={() => setPeriodManagerIsOpen(false)}
          />
          <aside className="operations-period-drawer__panel">
            <header className="operations-period-drawer__header">
              <div>
                <div className="operations-controls__eyebrow">Périodes enregistrées</div>
                <h2 id="operations-period-drawer-title">Gestion des relais</h2>
              </div>
              <button type="button" className="operations-period-drawer__close" onClick={() => setPeriodManagerIsOpen(false)} aria-label="Fermer">
                ×
              </button>
            </header>
            <div className="operations-period-drawer__content">
              {savedPeriods.map((period) => {
                const draft = periodDrafts[period.id] ?? buildPeriodDraft(period);
                const isExpired = Boolean(period.expires_at && new Date(period.expires_at).getTime() < Date.now());
                const isAvailable = period.is_active && !isExpired;
                const isSavingDetails = savingPeriodDetailsId === period.id;
                const isTestingSms = testingPeriodSmsId === period.id;
                return (
                  <section key={period.id} className="operations-period-detail">
                    <div className="operations-period-detail__title">
                      <div>
                        <strong>{period.label}</strong>
                        <span>{formatSavedPeriod(period.from, period.to)}</span>
                      </div>
                      <button type="button" className="secondary" onClick={() => applySavedPeriod(period)}>
                        Afficher
                      </button>
                    </div>

                    <label className="field">
                      <span>Nom</span>
                      <input
                        value={draft.label}
                        onChange={(event) => updatePeriodDraft(period.id, { label: event.target.value })}
                      />
                    </label>

                    <div className="operations-period-detail__grid">
                      <label className="field">
                        <span>N'afficher que les séjours d'au moins</span>
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={draft.stay_nights}
                          onChange={(event) => updatePeriodDraft(period.id, { stay_nights: event.target.value })}
                          placeholder="Toutes les durées"
                        />
                      </label>
                    </div>

                    <div className="operations-period-detail__toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.arrivals_only}
                          onChange={(event) => updatePeriodDraft(period.id, { arrivals_only: event.target.checked })}
                        />
                        Entrées uniquement
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.show_options}
                          onChange={(event) => updatePeriodDraft(period.id, { show_options: event.target.checked })}
                        />
                        Afficher la colonne Options
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.is_active}
                          onChange={(event) => updatePeriodDraft(period.id, { is_active: event.target.checked })}
                        />
                        Lien public actif
                      </label>
                    </div>

                    <details className="operations-sms-accordion">
                      <summary>
                        <span>SMS de l’intervenant</span>
                        <small>{draft.sms_configs.length ? "Configuré" : "Non configuré"}</small>
                      </summary>
                      <div className="operations-sms-accordion__content">
                        <p>L’intervenant reçoit toutes les interventions de cette période. Créez une autre période pour un second intervenant ou des instructions différentes.</p>
                        {draft.sms_configs.map((config) => {
                          const selectedWorker = workers.find((worker) => worker.id === config.worker_id);
                          return (
                            <section key={config.id} className="operations-sms-config">
                              <header>
                                <strong>Configuration SMS</strong>
                                <label><input type="checkbox" checked={config.enabled} onChange={(event) => updateSmsConfig(period.id, config.id, { enabled: event.target.checked })} /> Automatique</label>
                              </header>
                              <div className="operations-period-detail__grid">
                                <label className="field">
                                  <span>Intervenant</span>
                                  <select value={config.worker_id} onChange={(event) => updateSmsConfig(period.id, config.id, { worker_id: event.target.value })}>
                                    <option value="">Choisir…</option>
                                    {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.nom} · {worker.telephone}</option>)}
                                    {selectedWorker && !selectedWorker.is_active ? <option value={selectedWorker.id}>{selectedWorker.nom} (inactif)</option> : null}
                                  </select>
                                </label>
                                <label className="field">
                                  <span>Heure d'envoi</span>
                                  <input type="time" value={config.send_time} onChange={(event) => updateSmsConfig(period.id, config.id, { send_time: event.target.value })} />
                                </label>
                                <label className="field">
                                  <span>Programme envoyé</span>
                                  <select value={config.send_day} onChange={(event) => updateSmsConfig(period.id, config.id, { send_day: event.target.value === "same_day" ? "same_day" : "previous_day" })}>
                                    <option value="previous_day">La veille pour le lendemain</option>
                                    <option value="same_day">Le jour même</option>
                                  </select>
                                </label>
                              </div>
                              <label className="field operations-sms-template">
                                <span>Texte du SMS</span>
                                <textarea rows={5} value={config.template} onChange={(event) => updateSmsConfig(period.id, config.id, { template: event.target.value })} />
                              </label>
                              <div className="operations-sms-variables" aria-label="Variables disponibles">
                                <span>Variables :</span>
                                {["{{gite}}", "{{horaire}}", "{{in-out}}", "{{date}}", "{{intervenant}}", "{{periode}}", "{{lien}}"].map((variable) => (
                                  <button key={variable} type="button" className="secondary" onClick={() => updateSmsConfig(period.id, config.id, { template: `${config.template}${config.template ? " " : ""}${variable}` })}>{variable}</button>
                                ))}
                              </div>
                              <PlanningRelaySmsLivePreview period={period} config={config} />
                              <div className="operations-period-detail__meta">
                                <span>Dernière tentative : {config.last_attempt_for_date ? formatShortDate(config.last_attempt_for_date) : "aucune"}</span>
                                <span>Dernier envoi : {config.last_sent_for_date ? formatShortDate(config.last_sent_for_date) : "aucun"}</span>
                              </div>
                              <button type="button" className="secondary" onClick={() => void sendPeriodTestSms(period, config)} disabled={isTestingSms || !config.worker_id || !smsStatus?.configured}>
                                {isTestingSms ? "Test en cours…" : "Tester ce SMS"}
                              </button>
                            </section>
                          );
                        })}
                        {draft.sms_configs.length === 0 ? (
                          <button type="button" className="secondary" onClick={() => addSmsConfig(period.id)}>Configurer le SMS</button>
                        ) : null}
                      </div>
                    </details>

                    <div className="operations-period-detail__toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.show_timeline}
                          onChange={(event) => updatePeriodDraft(period.id, { show_timeline: event.target.checked })}
                        />
                        Tableau graphique
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.show_comments}
                          onChange={(event) => updatePeriodDraft(period.id, { show_comments: event.target.checked })}
                        />
                        Commentaires
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.show_phones}
                          onChange={(event) => updatePeriodDraft(period.id, { show_phones: event.target.checked })}
                        />
                        Téléphones
                      </label>
                    </div>

                    <div className="operations-period-detail__actions">
                      <button type="button" onClick={() => void savePeriodDetails(period)} disabled={isSavingDetails}>
                        {isSavingDetails ? "Enregistrement…" : "Enregistrer"}
                      </button>
                      <a
                        className={`button secondary${isAvailable ? "" : " is-disabled"}`}
                        href={isAvailable ? new URL(period.public_path, window.location.origin).toString() : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!isAvailable}
                        tabIndex={isAvailable ? undefined : -1}
                      >
                        Ouvrir la page
                      </a>
                      <button type="button" className="secondary" onClick={() => void copySavedPeriodLink(period)} disabled={!isAvailable}>
                        Copier le lien
                      </button>
                      <button type="button" className="secondary" onClick={() => void rotateSavedPeriodLink(period)}>
                        Régénérer
                      </button>
                      <button type="button" className="danger" onClick={() => void removeSavedPeriod(period)}>
                        Supprimer
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}

      {workerManagerIsOpen ? (
        <div className="operations-period-drawer no-print" role="dialog" aria-modal="true" aria-labelledby="operations-worker-drawer-title">
          <button
            type="button"
            className="operations-period-drawer__backdrop"
            aria-label="Fermer la gestion des intervenants"
            onClick={() => setWorkerManagerIsOpen(false)}
          />
          <aside className="operations-period-drawer__panel">
            <header className="operations-period-drawer__header">
              <div>
                <div className="operations-controls__eyebrow">Planning relais</div>
                <h2 id="operations-worker-drawer-title">Intervenants</h2>
              </div>
              <button type="button" className="operations-period-drawer__close" onClick={() => setWorkerManagerIsOpen(false)} aria-label="Fermer">
                ×
              </button>
            </header>
            <div className="operations-period-drawer__content">
              <section className="operations-period-detail operations-worker-detail">
                <div className="operations-period-detail__title">
                  <div>
                    <strong>Nouvel intervenant</strong>
                    <span>Disponible ensuite dans chaque ligne d'intervention</span>
                  </div>
                </div>
                <div className="operations-period-detail__grid">
                  <label className="field">
                    <span>Nom</span>
                    <input
                      value={newWorkerDraft.nom}
                      onChange={(event) => setNewWorkerDraft((current) => ({ ...current, nom: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Téléphone</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={newWorkerDraft.telephone}
                      onChange={(event) => setNewWorkerDraft((current) => ({ ...current, telephone: event.target.value }))}
                      placeholder="06 00 00 00 00"
                    />
                  </label>
                </div>
                <div className="operations-period-detail__grid">
                  <label className="field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={newWorkerDraft.email}
                      onChange={(event) => setNewWorkerDraft((current) => ({ ...current, email: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Adresse</span>
                    <input
                      value={newWorkerDraft.adresse}
                      onChange={(event) => setNewWorkerDraft((current) => ({ ...current, adresse: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="operations-period-detail__toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={newWorkerDraft.is_active}
                      onChange={(event) => setNewWorkerDraft((current) => ({ ...current, is_active: event.target.checked }))}
                    />
                    Actif
                  </label>
                </div>
                <div className="operations-period-detail__actions">
                  <button type="button" onClick={() => void createWorker()} disabled={creatingWorker}>
                    {creatingWorker ? "Ajout…" : "Ajouter"}
                  </button>
                </div>
              </section>

              {workers.length === 0 ? (
                <div className="operations-empty">Aucun intervenant enregistré.</div>
              ) : workers.map((worker) => {
                const draft = workerDrafts[worker.id] ?? buildWorkerDraft(worker);
                const isSaving = savingWorkerId === worker.id;
                const isDeleting = deletingWorkerId === worker.id;
                return (
                  <section key={worker.id} className={`operations-period-detail operations-worker-detail${worker.is_active ? "" : " is-disabled"}`}>
                    <div className="operations-period-detail__title">
                      <div>
                        <strong>{worker.nom}</strong>
                        <span>{worker.telephone}</span>
                      </div>
                    </div>
                    <div className="operations-period-detail__grid">
                      <label className="field">
                        <span>Nom</span>
                        <input
                          value={draft.nom}
                          onChange={(event) => updateWorkerDraft(worker.id, { nom: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Téléphone</span>
                        <input
                          type="tel"
                          inputMode="tel"
                          value={draft.telephone}
                          onChange={(event) => updateWorkerDraft(worker.id, { telephone: event.target.value })}
                        />
                      </label>
                    </div>
                    <div className="operations-period-detail__grid">
                      <label className="field">
                        <span>Email</span>
                        <input
                          type="email"
                          value={draft.email}
                          onChange={(event) => updateWorkerDraft(worker.id, { email: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Adresse</span>
                        <input
                          value={draft.adresse}
                          onChange={(event) => updateWorkerDraft(worker.id, { adresse: event.target.value })}
                        />
                      </label>
                    </div>
                    <div className="operations-period-detail__toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.is_active}
                          onChange={(event) => updateWorkerDraft(worker.id, { is_active: event.target.checked })}
                        />
                        Actif
                      </label>
                    </div>
                    <div className="operations-period-detail__actions">
                      <button type="button" onClick={() => void saveWorker(worker)} disabled={isSaving}>
                        {isSaving ? "Enregistrement…" : "Enregistrer"}
                      </button>
                      <button type="button" className="danger" onClick={() => void deleteWorker(worker)} disabled={isDeleting}>
                        {isDeleting ? "Suppression…" : "Supprimer"}
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}

      {error ? <div className="operations-error no-print">{error}</div> : null}
      {loading ? <div className="card no-print">Chargement du planning…</div> : null}

      {!loading && periodIsValid && !error ? (
        <article className="operations-sheet">
          <header className="operations-sheet__header">
            <div>
              <div className="operations-sheet__eyebrow">Planning des gîtes</div>
              <h2>Entrées, sorties et interventions</h2>
              <p>{formatRange(from, to)}</p>
            </div>
            <div className="operations-sheet__summary">
              <strong>{interventionCount}</strong>
              <span>passage{interventionCount > 1 ? "s" : ""} à prévoir</span>
            </div>
          </header>

          {showTimeline ? (
            <>
              <section className="operations-timeline" aria-label="Occupation graphique" style={timelineColumns}>
                <div className="operations-timeline__header">
                  <div className="operations-timeline__corner">Gîte</div>
                  {days.map((day) => {
                    const label = formatDayHeader(day);
                    const isWeekend = [0, 6].includes(parseIsoDateUtc(day).getUTCDay());
                    return <div key={day} className={isWeekend ? "is-weekend" : ""}><span>{label.weekday}</span><strong>{label.day}</strong></div>;
                  })}
                </div>
                {visibleGites.map((gite, giteIndex) => {
                  const giteReservations = visibleReservations.filter((reservation) => reservation.gite_id === gite.id);
                  return (
                    <div key={gite.id} className="operations-timeline__row">
                      <div className="operations-timeline__gite" style={{ "--gite-color": getGiteColor(gite, giteIndex) } as CSSProperties}>
                        <span />{gite.nom}
                      </div>
                      {days.map((day) => {
                        const hasArrival = giteReservations.some((reservation) => reservation.date_entree.slice(0, 10) === day);
                        const hasDeparture = giteReservations.some((reservation) => reservation.date_sortie.slice(0, 10) === day);
                        return <div key={day} className={`operations-timeline__day${hasArrival || hasDeparture ? " has-intervention" : ""}${hasArrival && hasDeparture ? " has-rotation" : hasArrival ? " has-arrival" : hasDeparture ? " has-departure" : ""}`} />;
                      })}
                      <div className="operations-timeline__stays">
                        {giteReservations.map((reservation) => {
                          const start = Math.max(0, diffUtcDays(parseIsoDateUtc(reservation.date_entree), parseIsoDateUtc(from)));
                          const end = Math.min(days.length, diffUtcDays(parseIsoDateUtc(reservation.date_sortie), parseIsoDateUtc(from)));
                          if (end <= 0 || start >= days.length || end <= start) return null;
                          return (
                            <div
                              key={reservation.id}
                              className="operations-timeline__stay"
                              style={{
                                gridColumn: `${start + 1} / ${end + 1}`,
                                "--gite-color": getGiteColor(gite, giteIndex),
                              } as CSSProperties}
                              title={`${reservation.hote_nom}, ${formatShortDate(reservation.date_entree)} – ${formatShortDate(reservation.date_sortie)}`}
                            >
                              <span>{reservation.hote_nom}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </section>

              <div className="operations-legend">
                <span><i className="arrival" /> Entrée</span>
                <span><i className="departure" /> Sortie</span>
                <span><i className="rotation" /> Rotation le même jour</span>
              </div>
            </>
          ) : null}

          <section className="operations-table-section">
            <h3>Interventions à prévoir</h3>
            {operationsByDate.length === 0 ? (
              <div className="operations-empty">Aucune entrée ni sortie sur cette période.</div>
            ) : (
              <table className={`operations-table${showOptions ? "" : " operations-table--without-options"}`}>
                <thead>
                  <tr>
                    <th className="operations-table__date-heading">Date</th>
                    <th className="operations-table__gite-heading">Gîte</th>
                    <th className="operations-table__type-heading">Type</th>
                    {showOptions ? <th className="operations-table__options-heading">Options</th> : null}
                    <th className="operations-table__stay-heading">Séjour</th>
                    {showComments || showPhones ? <th className="operations-table__information-heading">Informations</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {operationsByDate.map(({ date, giteId, stays }) => {
                    const operations = stays.flatMap((stay) => stay.operations);
                    const hasArrival = operations.some((operation) => operation.kind === "arrival");
                    const hasDeparture = operations.some((operation) => operation.kind === "departure");
                    const isRotation = hasArrival && hasDeparture;
                    const firstReservation = stays[0].reservation;
                    const isAlreadyHandledArrival = alreadyHandledArrivalRows.has(`${date}-${giteId}`);
                    return (
                      <tr
                        key={`${date}-${giteId}`}
                        className={`operations-table__row--${getOperationTone(operations)}${isAlreadyHandledArrival ? " operations-table__row--already-handled" : ""}`}
                        title={isAlreadyHandledArrival ? "Intervention déjà réalisée lors de la sortie précédente" : undefined}
                      >
                        <td>
                          <div className="operations-table__date">
                            <strong>{formatOperationDate(date)}</strong>
                            <span>{getOperationSchedule(firstReservation, hasArrival, hasDeparture)}</span>
                          </div>
                        </td>
                        <td><strong>{firstReservation.gite?.nom ?? "Gîte"}</strong></td>
                        <td className="operations-table__type">
                          <div className="operations-badges">
                            {stays.flatMap((stay) => stay.operations.filter((operation) => ["arrival", "departure"].includes(operation.kind)).map((operation) => <span key={`${stay.reservation.id}-${operation.kind}`} className={`operations-badge operations-badge--${operation.kind}`}>{operation.label}</span>))}
                          </div>
                        </td>
                        {showOptions ? (
                          <td className="operations-table__options">
                            <div className="operations-badges">
                              {stays.flatMap((stay) => stay.operations.filter((operation) => !["arrival", "departure"].includes(operation.kind)).map((operation) => <span key={`${stay.reservation.id}-${operation.kind}`} className={`operations-badge operations-badge--${operation.kind}`}>{operation.label}</span>))}
                            </div>
                          </td>
                        ) : null}
                        <td className="operations-table__stay-cell">
                          <div className={`operations-stay-summaries${isRotation ? " operations-stay-summaries--rotation" : ""}`}>
                            {stays.map((stay) => {
                              const reservation = stay.reservation;
                              const isDeparture = stay.operations.some((operation) => operation.kind === "departure");
                              return (
                                <div key={reservation.id} className="operations-stay-summary">
                                  <div>
                                    {isRotation ? <span className={`operations-stay-summary__role operations-stay-summary__role--${isDeparture ? "departure" : "arrival"}`}>{isDeparture ? "Sortie" : "Entrée"}</span> : null}
                                    <strong>{reservation.hote_nom}</strong>
                                  </div>
                                  <span>{formatShortDate(reservation.date_entree)} → {formatShortDate(reservation.date_sortie)} · {reservation.nb_nuits} nuit{reservation.nb_nuits > 1 ? "s" : ""}</span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        {showComments || showPhones ? (
                          <td className="operations-table__information-cell">
                            {stays.map(({ reservation }) => {
                              const hasInformation = (showPhones && reservation.telephone) || (showComments && reservation.commentaire);
                              if (!hasInformation) return null;
                              return (
                                <div key={reservation.id} className="operations-stay-information">
                                  {isRotation ? <strong>{reservation.hote_nom}</strong> : null}
                                  {showPhones && reservation.telephone ? <span>{reservation.telephone}</span> : null}
                                  {showComments && reservation.commentaire ? <span>{reservation.commentaire}</span> : null}
                                </div>
                              );
                            })}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          <footer className="operations-sheet__footer">Document préparé le {new Date().toLocaleDateString("fr-FR")} · Les gîtes de Brocéliande</footer>
        </article>
      ) : null}
    </div>
  );
};

export default OperationsPrintPage;
