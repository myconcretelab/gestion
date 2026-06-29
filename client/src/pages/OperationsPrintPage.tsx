import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiFetch, isAbortError } from "../utils/api";
import { getGiteColor } from "../utils/giteColors";
import {
  addUtcDays,
  buildPrintableOperationRows,
  diffUtcDays,
  enumerateIsoDates,
  parseIsoDateUtc,
  reservationOverlapsPeriod,
  toIsoDateUtc,
  type StayOperation,
} from "../utils/printableOperations";
import type { Gite, Reservation } from "../utils/types";

const MAX_DAYS = 31;

const todayIso = () => {
  const now = new Date();
  return toIsoDateUtc(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
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
  const [gites, setGites] = useState<Gite[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedGiteIds, setSelectedGiteIds] = useState<Set<string>>(new Set());
  const [showTimeline, setShowTimeline] = useState(false);
  const [showComments, setShowComments] = useState(true);
  const [showPhones, setShowPhones] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dayCount = diffUtcDays(parseIsoDateUtc(to), parseIsoDateUtc(from)) + 1;
  const periodIsValid = dayCount >= 1 && dayCount <= MAX_DAYS;

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
  const hasCleaningInPeriod = useMemo(
    () => operationsByDate.some((row) => row.stays.some((stay) => stay.operations.some((operation) => operation.kind === "cleaning"))),
    [operationsByDate]
  );

  const setPreset = (daysToShow: number) => {
    setTo(toIsoDateUtc(addUtcDays(parseIsoDateUtc(from), daysToShow - 1)));
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
          <label className="field">
            Du
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="field">
            Au
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <div className="operations-presets" aria-label="Durées rapides">
            {[7, 14, 21, 31].map((count) => (
              <button key={count} type="button" className={dayCount === count ? "" : "secondary"} onClick={() => setPreset(count)}>
                {count} j
              </button>
            ))}
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
              <strong>{operationsByDate.length}</strong>
              <span>passage{operationsByDate.length > 1 ? "s" : ""} à prévoir</span>
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
              <table className={`operations-table${hasCleaningInPeriod ? "" : " operations-table--without-cleaning"}`}>
                <thead>
                  <tr>
                    <th className="operations-table__date-heading">Date</th>
                    <th className="operations-table__type-heading">Type</th>
                    {hasCleaningInPeriod ? <th className="operations-table__cleaning-heading">Ménage</th> : null}
                    <th className="operations-table__gite-heading">Gîte</th>
                    <th className="operations-table__stay-heading">Séjour</th>
                    {showComments || showPhones ? <th className="operations-table__information-heading">Informations</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {operationsByDate.map(({ date, giteId, stays }) => {
                    const operations = stays.flatMap((stay) => stay.operations);
                    const hasArrival = operations.some((operation) => operation.kind === "arrival");
                    const hasDeparture = operations.some((operation) => operation.kind === "departure");
                    const hasCleaning = operations.some((operation) => operation.kind === "cleaning");
                    const isRotation = hasArrival && hasDeparture;
                    const firstReservation = stays[0].reservation;
                    return (
                      <tr key={`${date}-${giteId}`} className={`operations-table__row--${getOperationTone(operations)}`}>
                        <td>
                          <div className="operations-table__date">
                            <strong>{formatOperationDate(date)}</strong>
                            <span>{getOperationSchedule(firstReservation, hasArrival, hasDeparture)}</span>
                          </div>
                        </td>
                        <td className="operations-table__type">
                          <div className="operations-badges">
                            {stays.flatMap((stay) => stay.operations.filter((operation) => operation.kind !== "cleaning").map((operation) => <span key={`${stay.reservation.id}-${operation.kind}`} className={`operations-badge operations-badge--${operation.kind}`}>{operation.label}</span>))}
                          </div>
                        </td>
                        {hasCleaningInPeriod ? (
                          <td className="operations-table__cleaning">
                            {hasCleaning ? <span className="operations-badge operations-badge--cleaning">Ménage</span> : null}
                          </td>
                        ) : null}
                        <td><strong>{firstReservation.gite?.nom ?? "Gîte"}</strong></td>
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
