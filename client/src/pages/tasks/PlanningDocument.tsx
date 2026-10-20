import { useMemo, useState } from "react";
import type { PlanningIntervention } from "@contrats/shared";
import { formatEuro } from "../../utils/format";
import "./planning.css";

export default function PlanningDocument({
  label,
  from,
  to,
  rows,
  prices,
  timeline = false,
  generatedAt,
}: {
  label: string;
  from: string;
  to: string;
  rows: PlanningIntervention[];
  prices: boolean;
  timeline?: boolean;
  generatedAt?: string;
}) {
  const [hidePast, setHidePast] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
  }).format(new Date());
  const visible = rows.filter((row) => !hidePast || row.date >= today);
  const days = useMemo(() => {
    const values: string[] = [];
    for (
      let value = Date.parse(from + "T12:00:00Z");
      value <= Date.parse(to + "T12:00:00Z");
      value += 86400000
    )
      values.push(new Date(value).toISOString().slice(0, 10));
    return values;
  }, [from, to]);
  const gites = useMemo(
    () => [...new Set(rows.map((row) => row.gite_name))],
    [rows],
  );
  const date = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    });
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    });
  const status = (value: string) =>
    ({
      planned: "Prévue",
      in_progress: "En cours",
      done: "Terminée",
      verified: "Contrôlée",
    })[value] ?? value;
  return (
    <section className="planning-document">
      <div className="po-document-controls no-print">
        <label>
          <input
            type="checkbox"
            checked={hidePast}
            onChange={(event) => setHidePast(event.target.checked)}
          />{" "}
          Masquer les jours passés
        </label>
        {timeline && (
          <label>
            <input
              type="checkbox"
              checked={showTimeline}
              onChange={(event) => setShowTimeline(event.target.checked)}
            />{" "}
            Tableau graphique
          </label>
        )}
        <button
          type="button"
          className="tw-secondary"
          onClick={() => window.print()}
        >
          Imprimer
        </button>
      </div>
      <header>
        <span className="po-eyebrow">Planning des interventions</span>
        <h2>{label}</h2>
        <p>
          Du {date(from)} au {date(to)} · {rows.length} intervention
          {rows.length > 1 ? "s" : ""}
        </p>
      </header>
      {showTimeline && timeline && (
        <div
          className="po-timeline"
          role="region"
          aria-label="Tableau graphique des interventions"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Gîte</th>
                {days.map((day) => (
                  <th key={day}>{date(day)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gites.map((gite) => (
                <tr key={gite}>
                  <th>{gite}</th>
                  {days.map((day) => (
                    <td
                      key={day}
                      className={
                        rows.some(
                          (row) =>
                            row.gite_name === gite &&
                            row.stay_from &&
                            row.stay_to &&
                            row.stay_from <= day &&
                            row.stay_to > day,
                        )
                          ? "po-occupied"
                          : ""
                      }
                    >
                      {rows
                        .filter(
                          (row) => row.gite_name === gite && row.date === day,
                        )
                        .map((row) => (
                          <span className="po-chip" key={row.id}>
                            {row.title}
                          </span>
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="po-document-rows">
        {visible.map((row) => (
          <article className="po-document-row" key={`${row.kind}:${row.id}`}>
            <div className="po-document-date">
              <strong>{date(row.date)}</strong>
              <span>
                {time(row.starts_at)}
                {row.due_at
                  ? ` → ${row.due_at.slice(0, 10) !== row.starts_at.slice(0, 10) ? date(row.due_at.slice(0, 10)) + " " : ""}${time(row.due_at)}`
                  : ""}
              </span>
            </div>
            <div>
              <h3>
                {row.gite_name} · {row.title}
              </h3>
              <p>
                {row.assignee_name ?? "À attribuer"} · {status(row.status)}
              </p>
              {row.guest && (
                <small>
                  {row.guest} · {row.nights} nuit{row.nights > 1 ? "s" : ""}
                </small>
              )}
              {[row.note, row.options, row.comment, row.phone]
                .filter(Boolean)
                .map((value, index) => (
                  <p className="po-consigne" key={index}>
                    {value}
                  </p>
                ))}
            </div>
            {prices && (
              <strong className="po-document-price">
                {row.amount === null ? "—" : formatEuro(row.amount)}
              </strong>
            )}
          </article>
        ))}
      </div>
      {!visible.length && (
        <p className="po-empty">Aucune intervention pour cette sélection.</p>
      )}
      {prices && (
        <div className="po-total">
          <span>
            Total prévisionnel de toute la période
            <small>Jours passés inclus · hors rémunérations à l’heure</small>
          </span>
          <strong>
            {formatEuro(rows.reduce((sum, row) => sum + (row.amount ?? 0), 0))}
          </strong>
        </div>
      )}
      <footer>
        Édité le {new Date(generatedAt ?? Date.now()).toLocaleString("fr-FR")} ·
        Les montants prévus ne constituent pas un relevé de paiement.
      </footer>
    </section>
  );
}
