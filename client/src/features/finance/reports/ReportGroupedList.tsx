import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ReportWorkspace } from "./ReportsPage";
import { cadenceLabel, formatReportValue } from "./reportModel";
import { reportMonthLabel, type ReportMonthGroup } from "./reportGrouping";
import { ReportBadge, ReportIcon, ReportKindIcon } from "./ReportUi";
import ReportProgressActions from "./ReportProgressActions";

export default function ReportGroupedList({
  groups,
  workspace,
  showFavorites = false,
}: {
  groups: ReportMonthGroup[];
  workspace: ReportWorkspace;
  showFavorites?: boolean;
}) {
  const { state, href, canEdit, saving, mutate } = workspace;
  const id = useId();
  const [params, setParams] = useSearchParams();
  const twoColumns = params.get("colonnes") === "2";
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const allCollapsed = groups.every((group) => collapsed.has(group.month));
  return (
    <div
      className={`rp-grouped-list${twoColumns ? " rp-grouped-list--columns" : ""}`}
    >
      <div className="rp-grouped-list__guide">
        <span>
          <ReportIcon name="calendar" />
          Par mois <span aria-hidden="true">/</span> Par gestionnaire
        </span>
        <div className="rp-grouped-list__actions">
          <button
            type="button"
            className="rp-layout-toggle"
            aria-label="Afficher les gestionnaires sur deux colonnes"
            aria-pressed={twoColumns}
            title={
              twoColumns
                ? "Revenir à une colonne"
                : "Afficher les gestionnaires côte à côte"
            }
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                if (twoColumns) next.delete("colonnes");
                else next.set("colonnes", "2");
                return next;
              })
            }
          >
            <ReportIcon name="columns" />2 colonnes
          </button>
          <button
            type="button"
            className="rp-text-button"
            onClick={() =>
              setCollapsed(
                new Set(allCollapsed ? [] : groups.map((group) => group.month)),
              )
            }
          >
            {allCollapsed ? "Tout déplier" : "Tout replier"}
          </button>
        </div>
      </div>
      {groups.map((group) => {
        const expanded = !collapsed.has(group.month);
        const monthId = `${id}-${group.month}`;
        return (
          <section
            className="rp-month-group"
            key={group.month}
            data-month={group.month}
          >
            <h3 className="rp-month-group__heading">
              <button
                type="button"
                className="rp-month-group__toggle"
                aria-expanded={expanded}
                aria-controls={monthId}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (expanded) next.add(group.month);
                    else next.delete(group.month);
                    return next;
                  })
                }
              >
                <span className="rp-month-group__calendar" aria-hidden="true">
                  <span>{group.month.slice(0, 4)}</span>
                  <strong>{group.month.slice(5)}</strong>
                </span>
                <span className="rp-month-group__identity">
                  <span className="rp-month-group__title">
                    {reportMonthLabel(group.month)}
                  </span>
                  <span className="rp-month-group__meta">
                    {group.managers.length}{" "}
                    {group.managers.every((manager) =>
                      manager.id.startsWith("manager:"),
                    )
                      ? "gestionnaire"
                      : "groupe"}
                    {group.managers.length > 1 ? "s" : ""}
                    <span aria-hidden="true"> · </span>
                    {group.count} rapport{group.count > 1 ? "s" : ""}
                  </span>
                </span>
                {group.attentionCount > 0 && (
                  <span className="rp-month-group__attention">
                    {group.attentionCount} à vérifier
                  </span>
                )}
                <ReportIcon
                  name="chevron"
                  className="rp-month-group__chevron"
                />
              </button>
            </h3>
            <div
              className="rp-month-group__body"
              id={monthId}
              hidden={!expanded}
            >
              {group.managers.map((manager) => (
                <section
                  className="rp-manager-group"
                  key={manager.id}
                  data-manager={manager.id}
                  aria-label={`${manager.name} · ${reportMonthLabel(group.month)}`}
                >
                  <header className="rp-manager-group__header">
                    <span
                      className="rp-manager-group__avatar"
                      aria-hidden="true"
                    >
                      {manager.id.startsWith("manager:") ? (
                        manager.name
                          .split(/\s+/)
                          .filter(Boolean)
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join("")
                      ) : (
                        <ReportIcon name="people" />
                      )}
                    </span>
                    <div className="rp-manager-group__identity">
                      <h4>{manager.name}</h4>
                      <span>{manager.label}</span>
                    </div>
                    <span className="rp-manager-group__count">
                      {manager.items.length} rapport
                      {manager.items.length > 1 ? "s" : ""}
                    </span>
                  </header>
                  {manager.items.map(
                    ({
                      key,
                      report,
                      period,
                      month,
                      result,
                      status,
                      confirmed,
                      progress,
                    }) => (
                      <article
                        key={key}
                        className="rp-report-row rp-grouped-row"
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
                            <span>
                              {report.recipient !== manager.name && (
                                <>{report.recipient} · </>
                              )}
                              <span>{cadenceLabel(report.cadence)}</span>
                              {report.cadence !== "monthly" && (
                                <> · {period.label}</>
                              )}
                            </span>
                            {report.kind === "tourist" &&
                              report.propertyIds.length > 0 && (
                                <ul
                                  className="rp-report-properties"
                                  aria-label="Gîtes concernés"
                                >
                                  {report.propertyIds.map((propertyId) => (
                                    <li
                                      className="rp-report-property-badge"
                                      key={propertyId}
                                    >
                                      <ReportIcon name="home" />
                                      <span>
                                        {state.properties.find(
                                          (property) =>
                                            property.id === propertyId,
                                        )?.name ?? "Gîte à vérifier"}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                          </div>
                        </div>
                        <div className="rp-report-row__amount">
                          <strong>
                            {formatReportValue(report, result.total)}
                          </strong>
                          <span>
                            {result.includedCount} opération
                            {result.includedCount > 1 ? "s" : ""} incluse
                            {result.includedCount > 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="rp-grouped-row__status">
                          <ReportBadge
                            tone={
                              status === "Écart à examiner" ||
                              result.reviewCount
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
                          {!confirmed && (
                            <ReportProgressActions
                              workspace={workspace}
                              report={report}
                              result={result}
                              progress={progress}
                              month={month}
                              compact
                            />
                          )}
                          {showFavorites && state.drafts[report.id] && (
                            <span className="rp-draft-hint">
                              Brouillon de règles conservé
                            </span>
                          )}
                        </div>
                        <div className="rp-report-row__actions">
                          {showFavorites && (
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
                          )}
                          {canEdit && (
                            <Link
                              to={href(`/${report.id}/modifier`, month)}
                              className="rp-icon-link"
                              aria-label={`Réglages de ${report.name} · ${report.recipient} · ${period.label}`}
                              title="Réglages du rapport"
                            >
                              <ReportIcon name="settings" />
                            </Link>
                          )}
                          <Link
                            to={href(`/${report.id}`, month)}
                            className="rp-icon-link rp-grouped-row__open"
                            aria-label={`Ouvrir ${report.name} · ${report.recipient} · ${period.label}`}
                            title="Ouvrir le rapport"
                          >
                            <ReportIcon name="arrow" />
                          </Link>
                        </div>
                      </article>
                    ),
                  )}
                </section>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
