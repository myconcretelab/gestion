import { useState } from "react";
import { Link } from "react-router-dom";
import type { ReportWorkspace } from "./ReportsPrototypePage";
import {
  cadenceLabel,
  evaluateReport,
  formatReportValue,
  getReportPeriod,
  reportPeriodKey,
  reportStatus,
} from "./reportPrototype";
import {
  ReportBadge,
  ReportEmpty,
  ReportIcon,
  ReportKindIcon,
} from "./ReportUi";

export default function ReportsOverview({
  workspace: { state, setState, month, setMonth, href, canEdit },
}: {
  workspace: ReportWorkspace;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const summaries = state.reports.map((report) => {
    const key = reportPeriodKey(report, month);
    const result = evaluateReport(report, month, state.overrides[key]);
    const progress = state.progress[key];
    return { report, result, progress, status: reportStatus(progress, result) };
  });
  const needsAttention = summaries.filter(
    (item) => item.result.reviewCount > 0 || item.status === "Écart à examiner",
  ).length;
  const done = summaries.filter(
    (item) =>
      item.status === "Prêt" || item.status === "Transmission confirmée",
  ).length;
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
      <header className="rp-page-header">
        <div>
          <p className="rp-eyebrow">Votre activité, en clair</p>
          <h1>
            Rapports et déclarations<span className="rp-title-dot">.</span>
          </h1>
          <p className="rp-page-description">
            Les bons chiffres, pour chaque démarche et chaque interlocuteur.
          </p>
        </div>
        {canEdit && (
          <Link to={href("/nouveau")} className="rp-button">
            <ReportIcon name="plus" />
            {state.drafts.new ? "Reprendre la création" : "Créer un rapport"}
          </Link>
        )}
      </header>
      <div className="rp-overview-top">
        <div className="rp-period-card">
          <span className="rp-overline">Votre période de travail</span>
          <label className="rp-period-picker">
            <ReportIcon name="clock" />
            <span className="rp-sr-only">Période de travail</span>
            <input
              type="month"
              value={month}
              min="2000-01"
              max="2099-12"
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <span className="rp-muted">
            Exemples disponibles de septembre à novembre 2026
          </span>
        </div>
        <div className="rp-stat-card">
          <span className="rp-stat-number">
            {String(state.reports.length).padStart(2, "0")}
          </span>
          <div>
            <strong>rapports à portée de main</strong>
            <span>Un périmètre clair pour chaque besoin.</span>
          </div>
        </div>
        <div className="rp-stat-card">
          <span className="rp-stat-number rp-stat-number--accent">
            {String(needsAttention).padStart(2, "0")}
          </span>
          <div>
            <strong>à examiner</strong>
            <span>
              {done
                ? `${done} rapport${done > 1 ? "s" : ""} prêt${done > 1 ? "s" : ""} ou confirmé${done > 1 ? "s" : ""}.`
                : "Quelques vérifications avant de finaliser."}
            </span>
          </div>
        </div>
      </div>
      <section className="rp-panel" aria-labelledby="rp-reports-heading">
        <div className="rp-panel-heading">
          <div>
            <h2 id="rp-reports-heading">Vos rapports</h2>
            <p>Choisissez un rapport pour préparer votre période.</p>
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
          {sorted.map(({ report, result, status, progress }) => (
            <article key={report.id} className="rp-report-row">
              <div className="rp-report-row__identity">
                <ReportKindIcon kind={report.kind} />
                <div>
                  <Link to={href(`/${report.id}`)} className="rp-report-title">
                    {report.name}
                  </Link>
                  <span>{report.recipient}</span>
                </div>
              </div>
              <div className="rp-report-row__period">
                <strong>{getReportPeriod(month, report.cadence).label}</strong>
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
                      : status === "Transmission confirmée"
                        ? "complete"
                        : status === "Prêt"
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
                  disabled={!canEdit}
                  onClick={() =>
                    setState((previous) => ({
                      ...previous,
                      reports: previous.reports.map((item) =>
                        item.id === report.id
                          ? { ...item, favorite: !item.favorite }
                          : item,
                      ),
                    }))
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
      <section className="rp-how-it-works" aria-labelledby="rp-how-heading">
        <div>
          <span className="rp-overline">Un fil conducteur simple</span>
          <h2 id="rp-how-heading">De vos opérations à votre rapport.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Rassembler</strong>
              <p>Les opérations suivent les règles de votre rapport.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Vérifier</strong>
              <p>Chaque montant explique d’où il vient.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Finaliser</strong>
              <p>Vous gardez une copie de ce que vous confirmez.</p>
            </div>
          </li>
        </ol>
      </section>
    </>
  );
}
