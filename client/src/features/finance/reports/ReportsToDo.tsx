import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buildReportWorklist } from "@contrats/shared";
import type { ReportWorkspace } from "./ReportsPage";
import { cadenceLabel, formatReportValue } from "./reportModel";
import {
  ReportBadge,
  ReportEmpty,
  ReportIcon,
  ReportKindIcon,
} from "./ReportUi";

export default function ReportsToDo({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const { state, href } = workspace;
  const [params, setParams] = useSearchParams();
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(36);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const selectedReport = state.reports.some(
    (report) => report.id === params.get("rapport"),
  )
    ? params.get("rapport")!
    : "all";
  const items = useMemo(() => buildReportWorklist(state, now), [state, now]);
  const filtered = items.filter(
    ({ report, period }) =>
      (selectedReport === "all" || selectedReport === report.id) &&
      `${report.name} ${report.recipient} ${period.label}`
        .toLocaleLowerCase("fr")
        .includes(search.toLocaleLowerCase("fr")),
  );
  useEffect(() => setLimit(36), [selectedReport, search]);
  const updateFilter = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      return next;
    });
  return (
    <section className="rp-panel" aria-labelledby="rp-todo-heading">
      <div className="rp-panel-heading">
        <div>
          <h2 id="rp-todo-heading">
            Rapports à traiter{" "}
            <span className="rp-todo-count">{filtered.length}</span>
          </h2>
          <p>
            Une ligne par rapport et période terminée. Les transmissions
            confirmées et les déclarations déjà enregistrées sont retirées de
            cette liste.
          </p>
        </div>
        <label className="rp-search">
          <ReportIcon name="search" />
          <span className="rp-sr-only">Rechercher un rapport à traiter</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rapport, destinataire, période…"
          />
        </label>
      </div>
      <div className="rp-todo-filters">
        <label>
          <span>Rapport</span>
          <select
            aria-label="Rapport à traiter"
            value={selectedReport}
            onChange={(event) => updateFilter("rapport", event.target.value)}
          >
            <option value="all">Tous les rapports</option>
            {state.reports.map((report) => (
              <option key={report.id} value={report.id}>
                {report.name} · {report.recipient}
              </option>
            ))}
          </select>
        </label>
        <p>Les périodes les plus anciennes sont présentées en premier.</p>
      </div>
      <div className="rp-report-list">
        <div className="rp-report-list__head" aria-hidden="true">
          <span>Rapport et destinataire</span>
          <span>Période terminée</span>
          <span>Résultat inclus</span>
          <span>Avancement</span>
          <span />
        </div>
        {filtered
          .slice(0, limit)
          .map(({ key, report, period, month, result, status }) => (
            <article
              key={key}
              className="rp-report-row"
              data-report-id={report.id}
              data-period={month}
            >
              <div className="rp-report-row__identity">
                <ReportKindIcon kind={report.kind} />
                <div>
                  <Link
                    to={href(`/${report.id}`, month)}
                    className="rp-report-title"
                  >
                    {report.name}
                  </Link>
                  <span>{report.recipient}</span>
                </div>
              </div>
              <div className="rp-report-row__period">
                <strong>{period.label}</strong>
                <span>{cadenceLabel(report.cadence)}</span>
              </div>
              <div className="rp-report-row__amount">
                <strong>{formatReportValue(report, result.total)}</strong>
                <span>
                  {result.includedCount} opération
                  {result.includedCount > 1 ? "s" : ""} incluse
                  {result.includedCount > 1 ? "s" : ""}
                </span>
              </div>
              <div>
                <ReportBadge
                  tone={
                    status === "Écart à examiner" || result.reviewCount
                      ? "attention"
                      : status === "Prêt à confirmer"
                        ? "primary"
                        : "neutral"
                  }
                >
                  {status}
                </ReportBadge>
              </div>
              <div className="rp-report-row__actions">
                <Link
                  to={href(`/${report.id}`, month)}
                  className="rp-icon-link"
                  aria-label={`Ouvrir ${report.name} · ${period.label}`}
                >
                  <ReportIcon name="arrow" />
                </Link>
              </div>
            </article>
          ))}
        {!filtered.length && (
          <ReportEmpty
            title={
              items.length
                ? "Aucun rapport dans cette sélection"
                : "Aucun rapport à traiter"
            }
          >
            {items.length
              ? "Essayez un autre rapport ou une autre recherche."
              : "Aucune période terminée n’attend de confirmation. Les nouvelles périodes apparaissent automatiquement une fois terminées."}
          </ReportEmpty>
        )}
      </div>
      {filtered.length > limit && (
        <div className="rp-todo-more">
          <button
            type="button"
            className="rp-button rp-button--secondary"
            onClick={() => setLimit((value) => value + 36)}
          >
            Afficher les {Math.min(36, filtered.length - limit)} rapports
            suivants
          </button>
        </div>
      )}
    </section>
  );
}
