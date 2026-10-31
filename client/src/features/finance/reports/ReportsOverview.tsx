import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { reportWorkItem } from "@contrats/shared";
import ReportPageHeader from "./ReportPageHeader";
import ReportsToDo from "./ReportsToDo";
import type { ReportWorkspace } from "./ReportsPage";
import {
  cadenceLabel,
  formatReportValue,
  getReportPeriod,
} from "./reportModel";
import {
  ReportBadge,
  ReportEmpty,
  ReportIcon,
  ReportKindIcon,
} from "./ReportUi";

export default function ReportsOverview({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const {
    state,
    mutate,
    month,
    setMonth,
    href,
    canEdit,
    saving,
    loading,
    refresh,
  } = workspace;
  const [params, setParams] = useSearchParams();
  const view = params.get("vue") === "periode" ? "period" : "todo";
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const summaries = state.reports.map((report) =>
    reportWorkItem(state, report, month),
  );
  const filtered = summaries.filter(
    ({ report, result, status }) =>
      (filter !== "favorites" || report.favorite) &&
      (filter !== "attention" ||
        result.reviewCount ||
        status === "Écart à examiner") &&
      `${report.name} ${report.recipient}`
        .toLocaleLowerCase("fr")
        .includes(search.toLocaleLowerCase("fr")),
  );
  const sorted = [...filtered].sort(
    (a, b) => Number(b.report.favorite) - Number(a.report.favorite),
  );
  return (
    <>
      <ReportPageHeader
        title="Rapports et déclarations"
        actions={
          <div className="rp-header-actions">
            {canEdit && (
              <Link
                to={href("/import-airbnb")}
                className="rp-button rp-button--secondary"
              >
                <ReportIcon name="download" />
                Importer un relevé Airbnb
              </Link>
            )}
            <button
              type="button"
              className="rp-icon-button"
              aria-label="Actualiser les données"
              disabled={saving || loading}
              onClick={refresh}
            >
              <ReportIcon name="refresh" />
            </button>
            {canEdit && (
              <Link to={href("/nouveau")} className="rp-button">
                <ReportIcon name="plus" />
                Créer un rapport
              </Link>
            )}
          </div>
        }
      />
      {state.operations.some(
        (row) => row.basis === "payment" && !row.paymentDate,
      ) && (
        <p className="rp-notice">
          Des versements sans date restent hors des totaux.{" "}
          <Link to={href("/versements-a-dater")}>
            Consulter les versements à dater
          </Link>
        </p>
      )}
      <div
        className="rp-overview-views"
        role="group"
        aria-label="Vue des rapports"
      >
        {[
          { id: "todo", label: "À traiter" },
          { id: "period", label: "Par période" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={view === tab.id ? "is-active" : ""}
            aria-pressed={view === tab.id}
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                if (tab.id === "period") next.set("vue", "periode");
                else next.delete("vue");
                return next;
              })
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
      {view === "todo" ? (
        <ReportsToDo workspace={workspace} />
      ) : (
        <>
          <label className="rp-period-compact">
            <ReportIcon name="clock" />
            <span>Période à consulter</span>
            <input
              aria-label="Période de travail"
              type="month"
              value={month}
              min="2000-01"
              max="2099-12"
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <section className="rp-panel" aria-labelledby="rp-reports-heading">
            <div className="rp-panel-heading">
              <div>
                <h2 id="rp-reports-heading">Rapports</h2>
              </div>
              <label className="rp-search">
                <ReportIcon name="search" />
                <span className="rp-sr-only">Rechercher un rapport</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Rechercher un rapport…"
                />
              </label>
            </div>
            <div className="rp-filter-tabs" aria-label="Filtrer les rapports">
              {[
                { id: "all", label: "Tous les rapports" },
                { id: "favorites", label: "Favoris" },
                { id: "attention", label: "À examiner" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={filter === tab.id ? "is-active" : ""}
                  aria-pressed={filter === tab.id}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="rp-report-list">
              <div className="rp-report-list__head" aria-hidden="true">
                <span>Rapport et destinataire</span>
                <span>Période</span>
                <span>Résultat inclus</span>
                <span>Avancement</span>
                <span />
              </div>
              {sorted.map(({ report, result, status, confirmed }) => (
                <article key={report.id} className="rp-report-row">
                  <div className="rp-report-row__identity">
                    <ReportKindIcon kind={report.kind} />
                    <div>
                      <Link
                        to={href(`/${report.id}`)}
                        className="rp-report-title"
                      >
                        {report.name}
                      </Link>
                      <span>{report.recipient}</span>
                    </div>
                  </div>
                  <div className="rp-report-row__period">
                    <strong>
                      {getReportPeriod(month, report.cadence).label}
                    </strong>
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
                          : confirmed
                            ? "complete"
                            : status === "Prêt à confirmer"
                              ? "primary"
                              : "neutral"
                      }
                    >
                      {status}
                    </ReportBadge>
                    {state.drafts[report.id] && (
                      <span className="rp-draft-hint">
                        Brouillon de règles conservé
                      </span>
                    )}
                  </div>
                  <div className="rp-report-row__actions">
                    <button
                      type="button"
                      className={`rp-icon-button${report.favorite ? " is-favorite" : ""}`}
                      aria-label={`${report.favorite ? "Retirer des" : "Ajouter aux"} favoris : ${report.name}`}
                      aria-pressed={report.favorite}
                      disabled={!canEdit || saving}
                      onClick={() =>
                        void mutate({
                          type: "favorite",
                          reportId: report.id,
                          favorite: !report.favorite,
                        })
                      }
                    >
                      <ReportIcon name="star" />
                    </button>
                    <Link
                      to={href(`/${report.id}`)}
                      className="rp-icon-link"
                      aria-label={`Ouvrir ${report.name}`}
                    >
                      <ReportIcon name="arrow" />
                    </Link>
                  </div>
                </article>
              ))}
              {!sorted.length && (
                <ReportEmpty title="Aucun rapport dans cette sélection">
                  Essayez un autre filtre ou recherchez un autre nom.
                </ReportEmpty>
              )}
            </div>
          </section>
        </>
      )}
      {view === "period" && state.legacyDeclarations.length > 0 && (
        <details className="rp-panel rp-legacy-history">
          <summary>
            Déclarations historiques ({state.legacyDeclarations.length})
          </summary>
          <p className="rp-muted">
            Montants enregistrés avant les nouveaux rapports. Les opérations et
            les règles utilisées à l’époque ne sont pas disponibles ; ces
            montants sont conservés tels quels.
          </p>
          <div className="rp-history-list">
            {state.legacyDeclarations
              .filter((row) => row.period.startsWith(month.slice(0, 4)))
              .map((row) => (
                <div key={`${row.kind}:${row.id}`}>
                  <span>
                    <strong>{row.subject}</strong>
                    <small>
                      {row.period} ·{" "}
                      {row.kind === "social"
                        ? "Cotisations sociales"
                        : "Nuitées"}
                    </small>
                  </span>
                  <b>{formatReportValue(row, row.value)}</b>
                </div>
              ))}
          </div>
        </details>
      )}
    </>
  );
}
