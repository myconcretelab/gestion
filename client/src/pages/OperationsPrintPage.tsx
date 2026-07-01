import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DayPicker, type DateRange } from "@daypicker/react";
import { fr } from "@daypicker/react/locale";
import "@daypicker/react/style.css";
import { apiFetch, isAbortError } from "../utils/api";
import { getGiteColor } from "../utils/giteColors";
import {
  addUtcDays,
  buildPrintableOperationRows,
  diffUtcDays,
  enumerateIsoDates,
  getAlreadyHandledArrivalRowKeys,
  parseIsoDateUtc,
  reservationOverlapsPeriod,
  toIsoDateUtc,
  type StayOperation,
} from "../utils/printableOperations";
import type { Gite, PlanningRelayPeriod, Reservation } from "../utils/types";

const MAX_DAYS = 31;
const SAVED_PERIODS_STORAGE_KEY = "operations-print-saved-periods";

type LegacySavedPeriod = {
  id: string;
  from: string;
  to: string;
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
  const [savedPeriodsLoaded, setSavedPeriodsLoaded] = useState(false);
  const [savedPeriodsError, setSavedPeriodsError] = useState<string | null>(null);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showPhones, setShowPhones] = useState(false);
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
      setSavedPeriodsError(caught instanceof Error ? caught.message : "Impossible de charger les périodes enregistrées.");
    } finally {
      setSavedPeriodsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshSavedPeriods();
  }, [refreshSavedPeriods]);

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
            },
          });
        }
        window.localStorage.removeItem(SAVED_PERIODS_STORAGE_KEY);
        await refreshSavedPeriods();
      } catch (caught) {
        setSavedPeriodsError(caught instanceof Error ? caught.message : "Impossible de migrer les périodes locales.");
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
      reservationOverlapsPeriod(reservation, from, to)
    ),
    [from, reservations, selectedGiteIds, to]
  );

  const operationsByDate = useMemo(() => {
    return buildPrintableOperationRows(days, visibleReservations);
  }, [days, visibleReservations]);
  const hasOptionsInPeriod = useMemo(
    () => operationsByDate.some((row) => row.stays.some((stay) => stay.operations.some((operation) => !["arrival", "departure"].includes(operation.kind)))),
    [operationsByDate]
  );
  const alreadyHandledArrivalRows = useMemo(
    () => getAlreadyHandledArrivalRowKeys(operationsByDate),
    [operationsByDate],
  );
  const interventionCount = operationsByDate.length - alreadyHandledArrivalRows.size;

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
        },
      });
      setSavedPeriods((current) => [...current, period]);
    } catch (caught) {
      setSavedPeriodsError(caught instanceof Error ? caught.message : "Impossible d’enregistrer la période.");
    } finally {
      setSavingPeriod(false);
    }
  };

  const applySavedPeriod = (period: PlanningRelayPeriod) => {
    setFrom(period.from);
    setTo(period.to);
    setSelectedGiteIds(new Set(period.gite_ids));
    setShowTimeline(period.show_timeline);
    setShowComments(period.show_comments);
    setShowPhones(period.show_phones);
  };

  const updateSavedPeriod = (updated: PlanningRelayPeriod) => {
    setSavedPeriods((current) => current.map((period) => period.id === updated.id ? updated : period));
  };

  const removeSavedPeriod = async (period: PlanningRelayPeriod) => {
    if (!window.confirm(`Supprimer la période « ${period.label} » ?`)) return;
    try {
      await apiFetch(`/planning-relay-periods/${period.id}`, { method: "DELETE" });
      setSavedPeriods((current) => current.filter((item) => item.id !== period.id));
    } catch (caught) {
      setSavedPeriodsError(caught instanceof Error ? caught.message : "Impossible de supprimer la période.");
    }
  };

  const renameSavedPeriod = async (period: PlanningRelayPeriod) => {
    const label = window.prompt("Nom de la période", period.label)?.trim();
    if (!label || label === period.label) return;
    try {
      updateSavedPeriod(await apiFetch<PlanningRelayPeriod>(`/planning-relay-periods/${period.id}`, {
        method: "PATCH",
        json: { label },
      }));
    } catch (caught) {
      setSavedPeriodsError(caught instanceof Error ? caught.message : "Impossible de renommer la période.");
    }
  };

  const toggleSavedPeriod = async (period: PlanningRelayPeriod) => {
    try {
      updateSavedPeriod(await apiFetch<PlanningRelayPeriod>(`/planning-relay-periods/${period.id}`, {
        method: "PATCH",
        json: { is_active: !period.is_active },
      }));
    } catch (caught) {
      setSavedPeriodsError(caught instanceof Error ? caught.message : "Impossible de modifier le partage.");
    }
  };

  const rotateSavedPeriodLink = async (period: PlanningRelayPeriod) => {
    if (!window.confirm("L’ancien lien cessera immédiatement de fonctionner. Continuer ?")) return;
    try {
      updateSavedPeriod(await apiFetch<PlanningRelayPeriod>(`/planning-relay-periods/${period.id}/rotate-link`, { method: "POST" }));
    } catch (caught) {
      setSavedPeriodsError(caught instanceof Error ? caught.message : "Impossible de régénérer le lien.");
    }
  };

  const copySavedPeriodLink = async (period: PlanningRelayPeriod) => {
    try {
      await navigator.clipboard.writeText(new URL(period.public_path, window.location.origin).toString());
      setSavedPeriodsError(null);
    } catch {
      setSavedPeriodsError("Impossible de copier le lien. Ouvrez le planning puis copiez son adresse.");
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
          {savedPeriodsError ? <div className="operations-saved-periods__error">{savedPeriodsError}</div> : null}
          {savedPeriods.length > 0 ? (
            <div className="operations-saved-periods" aria-label="Périodes enregistrées">
              {savedPeriods.map((period) => {
                const isSelected = period.from === from && period.to === to &&
                  period.gite_ids.length === selectedGiteIds.size &&
                  period.gite_ids.every((id) => selectedGiteIds.has(id));
                const isExpired = Boolean(period.expires_at && new Date(period.expires_at).getTime() < Date.now());
                const isAvailable = period.is_active && !isExpired;
                return (
                  <span key={period.id} className={`operations-saved-period${isSelected ? " is-active" : ""}${isAvailable ? "" : " is-disabled"}`}>
                    <button type="button" onClick={() => applySavedPeriod(period)} aria-pressed={isSelected} title={formatSavedPeriod(period.from, period.to)}>
                      {period.label}
                    </button>
                    <button type="button" className="operations-saved-period__action" onClick={() => void renameSavedPeriod(period)} aria-label={`Renommer ${period.label}`} title="Renommer">✎</button>
                    <a
                      className="operations-saved-period__action"
                      href={isAvailable ? new URL(period.public_path, window.location.origin).toString() : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ouvrir le planning public ${period.label}`}
                      aria-disabled={!isAvailable}
                      tabIndex={isAvailable ? undefined : -1}
                      title="Ouvrir le planning public"
                    >
                      <svg className="operations-saved-period__share-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14 4h6v6M20 4l-9 9" />
                        <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
                      </svg>
                    </a>
                    <button type="button" className="operations-saved-period__action" onClick={() => void copySavedPeriodLink(period)} aria-label={`Copier le lien de ${period.label}`} title="Copier le lien" disabled={!isAvailable}>⧉</button>
                    <button type="button" className="operations-saved-period__action" onClick={() => void toggleSavedPeriod(period)} aria-label={`${period.is_active ? "Désactiver" : "Activer"} ${period.label}`} title={isExpired ? "Lien expiré : régénérez-le" : period.is_active ? "Désactiver le lien" : "Activer le lien"} disabled={isExpired}>{period.is_active ? "●" : "○"}</button>
                    <button type="button" className="operations-saved-period__action" onClick={() => void rotateSavedPeriodLink(period)} aria-label={`Régénérer le lien de ${period.label}`} title="Régénérer le lien">↻</button>
                    <button type="button" className="operations-saved-period__remove" onClick={() => void removeSavedPeriod(period)} aria-label={`Supprimer la période ${period.label}`} title="Supprimer">
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
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
            <label><input type="checkbox" checked={showComments} onChange={(event) => setShowComments(event.target.checked)} /> Commentaires</label>
            <label><input type="checkbox" checked={showPhones} onChange={(event) => setShowPhones(event.target.checked)} /> Téléphones</label>
          </div>
          <button type="button" onClick={() => window.print()} disabled={!periodIsValid || loading || visibleGites.length === 0}>
            Imprimer la feuille A4
          </button>
        </div>
      </section>

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
              <table className={`operations-table${hasOptionsInPeriod ? "" : " operations-table--without-options"}`}>
                <thead>
                  <tr>
                    <th className="operations-table__date-heading">Date</th>
                    <th className="operations-table__gite-heading">Gîte</th>
                    <th className="operations-table__type-heading">Type</th>
                    {hasOptionsInPeriod ? <th className="operations-table__options-heading">Options</th> : null}
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
                        {hasOptionsInPeriod ? (
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
