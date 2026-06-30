import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import { getGiteColor } from "../utils/giteColors";
import {
  buildPrintableOperationRows,
  diffUtcDays,
  enumerateIsoDates,
  getAlreadyHandledArrivalRowKeys,
  parseIsoDateUtc,
  type StayOperation,
} from "../utils/printableOperations";
import type { PublicPlanningRelayResponse, Reservation } from "../utils/types";

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

const PublicPlanningRelayPage = () => {
  const { token = "" } = useParams();
  const [data, setData] = useState<PublicPlanningRelayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      setData(await apiFetch<PublicPlanningRelayResponse>(`/public/planning-relay/${encodeURIComponent(token)}`));
      setError(null);
    } catch (caught) {
      if (!silent) {
        setError(caught instanceof Error ? caught.message : "Ce planning n’est plus disponible.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const days = useMemo(
    () => data ? enumerateIsoDates(data.period.from, data.period.to) : [],
    [data],
  );
  const operationsByDate = useMemo(
    () => data ? buildPrintableOperationRows(days, data.reservations) : [],
    [data, days],
  );
  const hasOptionsInPeriod = useMemo(
    () => operationsByDate.some((row) => row.stays.some((stay) => stay.operations.some((operation) => !["arrival", "departure"].includes(operation.kind)))),
    [operationsByDate],
  );
  const alreadyHandledArrivalRows = useMemo(
    () => getAlreadyHandledArrivalRowKeys(operationsByDate),
    [operationsByDate],
  );
  const interventionCount = operationsByDate.length - alreadyHandledArrivalRows.size;
  const timelineColumns = { "--operations-day-count": Math.max(1, days.length) } as CSSProperties;

  if (loading) return <main className="public-relay-state">Chargement du planning…</main>;
  if (error || !data) {
    return (
      <main className="public-relay-state">
        <img src="/logo.png" alt="Les gîtes de Brocéliande" />
        <h1>Planning indisponible</h1>
        <p>{error ?? "Ce lien n’est plus valide."}</p>
      </main>
    );
  }

  const { period, gites, reservations } = data;

  return (
    <main className="public-relay-page operations-print-page">
      <header className="public-relay-toolbar no-print">
        <img src="/logo.png" alt="Les gîtes de Brocéliande" />
        <div>
          <span>Planning relais</span>
          <h1>{period.label}</h1>
          <p>Mis à jour le {new Date(data.generated_at).toLocaleString("fr-FR")}</p>
        </div>
        <button type="button" onClick={() => window.print()}>Imprimer</button>
      </header>

      <article className="operations-sheet">
        <header className="operations-sheet__header">
          <div>
            <div className="operations-sheet__eyebrow">Planning des gîtes</div>
            <h2>{period.label}</h2>
            <p>{formatRange(period.from, period.to)}</p>
          </div>
          <div className="operations-sheet__summary">
            <strong>{interventionCount}</strong>
            <span>passage{interventionCount > 1 ? "s" : ""} à prévoir</span>
          </div>
        </header>

        {period.show_timeline ? (
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
              {gites.map((gite, giteIndex) => {
                const giteReservations = reservations.filter((reservation) => reservation.gite_id === gite.id);
                return (
                  <div key={gite.id} className="operations-timeline__row">
                    <div className="operations-timeline__gite" style={{ "--gite-color": getGiteColor(gite, giteIndex) } as CSSProperties}><span />{gite.nom}</div>
                    {days.map((day) => {
                      const hasArrival = giteReservations.some((reservation) => reservation.date_entree.slice(0, 10) === day);
                      const hasDeparture = giteReservations.some((reservation) => reservation.date_sortie.slice(0, 10) === day);
                      return <div key={day} className={`operations-timeline__day${hasArrival || hasDeparture ? " has-intervention" : ""}${hasArrival && hasDeparture ? " has-rotation" : hasArrival ? " has-arrival" : hasDeparture ? " has-departure" : ""}`} />;
                    })}
                    <div className="operations-timeline__stays">
                      {giteReservations.map((reservation) => {
                        const start = Math.max(0, diffUtcDays(parseIsoDateUtc(reservation.date_entree), parseIsoDateUtc(period.from)));
                        const end = Math.min(days.length, diffUtcDays(parseIsoDateUtc(reservation.date_sortie), parseIsoDateUtc(period.from)));
                        if (end <= 0 || start >= days.length || end <= start) return null;
                        return (
                          <div key={reservation.id} className="operations-timeline__stay" style={{ gridColumn: `${start + 1} / ${end + 1}`, "--gite-color": getGiteColor(gite, giteIndex) } as CSSProperties}>
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
          {operationsByDate.length === 0 ? <div className="operations-empty">Aucune entrée ni sortie sur cette période.</div> : (
            <table className={`operations-table${hasOptionsInPeriod ? "" : " operations-table--without-options"}`}>
              <thead><tr>
                <th className="operations-table__date-heading">Date</th>
                <th className="operations-table__gite-heading">Gîte</th>
                <th className="operations-table__type-heading">Type</th>
                {hasOptionsInPeriod ? <th className="operations-table__options-heading">Options</th> : null}
                <th className="operations-table__stay-heading">Séjour</th>
                {period.show_comments || period.show_phones ? <th className="operations-table__information-heading">Informations</th> : null}
              </tr></thead>
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
                      <td><div className="operations-table__date"><strong>{formatOperationDate(date)}</strong><span>{getOperationSchedule(firstReservation, hasArrival, hasDeparture)}</span></div></td>
                      <td><strong>{firstReservation.gite?.nom ?? "Gîte"}</strong></td>
                      <td className="operations-table__type"><div className="operations-badges">{stays.flatMap((stay) => stay.operations.filter((operation) => ["arrival", "departure"].includes(operation.kind)).map((operation) => <span key={`${stay.reservation.id}-${operation.kind}`} className={`operations-badge operations-badge--${operation.kind}`}>{operation.label}</span>))}</div></td>
                      {hasOptionsInPeriod ? <td className="operations-table__options"><div className="operations-badges">{stays.flatMap((stay) => stay.operations.filter((operation) => !["arrival", "departure"].includes(operation.kind)).map((operation) => <span key={`${stay.reservation.id}-${operation.kind}`} className={`operations-badge operations-badge--${operation.kind}`}>{operation.label}</span>))}</div></td> : null}
                      <td className="operations-table__stay-cell">
                        <div className={`operations-stay-summaries${isRotation ? " operations-stay-summaries--rotation" : ""}`}>
                          {stays.map((stay) => {
                            const reservation = stay.reservation;
                            const isDeparture = stay.operations.some((operation) => operation.kind === "departure");
                            return <div key={reservation.id} className="operations-stay-summary"><div>{isRotation ? <span className={`operations-stay-summary__role operations-stay-summary__role--${isDeparture ? "departure" : "arrival"}`}>{isDeparture ? "Sortie" : "Entrée"}</span> : null}<strong>{reservation.hote_nom}</strong></div><span>{formatShortDate(reservation.date_entree)} → {formatShortDate(reservation.date_sortie)} · {reservation.nb_nuits} nuit{reservation.nb_nuits > 1 ? "s" : ""}</span></div>;
                          })}
                        </div>
                      </td>
                      {period.show_comments || period.show_phones ? (
                        <td className="operations-table__information-cell">
                          {stays.map(({ reservation }) => {
                            if (!reservation.telephone && !reservation.commentaire) return null;
                            return <div key={reservation.id} className="operations-stay-information">{isRotation ? <strong>{reservation.hote_nom}</strong> : null}{period.show_phones && reservation.telephone ? <span>{reservation.telephone}</span> : null}{period.show_comments && reservation.commentaire ? <span>{reservation.commentaire}</span> : null}</div>;
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
        <footer className="operations-sheet__footer">Planning actualisé le {new Date(data.generated_at).toLocaleString("fr-FR")} · Les gîtes de Brocéliande</footer>
      </article>
    </main>
  );
};

export default PublicPlanningRelayPage;
