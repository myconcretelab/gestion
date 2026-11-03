import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { buildReportWorklist } from "@contrats/shared";
import type { ReportWorkspace } from "./ReportsPage";
import { ReportEmpty, ReportIcon } from "./ReportUi";
import ReportGroupedList from "./ReportGroupedList";
import {
  groupReportWorkItems,
  reportClosingMonth,
  reportManagerGroup,
  reportMonthLabel,
} from "./reportGrouping";

export default function ReportsToDo({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const { state } = workspace;
  const [params, setParams] = useSearchParams();
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(6);
  const monthFilter = params.get("mois") ?? "all";
  const selectedMonth = /^20\d{2}-(0[1-9]|1[0-2])$/.test(monthFilter)
    ? monthFilter
    : "all";
  const selectedManager = params.get("gestionnaire") ?? "all";
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
  const managers = [
    ...new Map(
      items.map(({ report }) => {
        const manager = reportManagerGroup(report, state);
        return [manager.id, manager] as const;
      }),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const months = [...new Set(items.map(reportClosingMonth))].sort();
  const filtered = items
    .filter(
      ({ report, period }) =>
        (selectedReport === "all" || selectedReport === report.id) &&
        (selectedManager === "all" ||
          selectedManager === reportManagerGroup(report, state).id) &&
        `${report.name} ${report.recipient} ${reportManagerGroup(report, state).name} ${period.label}`
          .toLocaleLowerCase("fr")
          .includes(search.toLocaleLowerCase("fr")),
    )
    .filter(
      (item) =>
        selectedMonth === "all" || reportClosingMonth(item) === selectedMonth,
    );
  const groups = groupReportWorkItems(filtered, state);
  useEffect(
    () => setLimit(6),
    [selectedReport, selectedMonth, selectedManager, search],
  );
  const updateFilter = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      return next;
    });
  return (
    <section
      className="rp-panel rp-todo-panel"
      aria-labelledby="rp-todo-heading"
    >
      <div className="rp-panel-heading">
        <div>
          <h2 id="rp-todo-heading">
            Rapports à traiter{" "}
            <span className="rp-todo-count">{filtered.length}</span>
          </h2>
          <p>
            Retrouvez chaque gestionnaire dans son mois. Les rapports confirmés
            et les écarts résolus quittent automatiquement la liste.
          </p>
        </div>
        <label className="rp-search">
          <ReportIcon name="search" />
          <span className="rp-sr-only">Rechercher un rapport à traiter</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rapport, gestionnaire, période…"
          />
        </label>
      </div>
      <div className="rp-todo-filters">
        <label>
          <span>Mois</span>
          <select
            aria-label="Mois des rapports"
            value={selectedMonth}
            onChange={(event) => updateFilter("mois", event.target.value)}
          >
            <option value="all">Tous les mois</option>
            {selectedMonth !== "all" && !months.includes(selectedMonth) && (
              <option value={selectedMonth}>
                {reportMonthLabel(selectedMonth)}
              </option>
            )}
            {months.map((month) => (
              <option key={month} value={month}>
                {reportMonthLabel(month)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Gestionnaire</span>
          <select
            aria-label="Gestionnaire des rapports"
            value={selectedManager}
            onChange={(event) =>
              updateFilter("gestionnaire", event.target.value)
            }
          >
            <option value="all">Tous les gestionnaires</option>
            {selectedManager !== "all" &&
              !managers.some((manager) => manager.id === selectedManager) && (
                <option value={selectedManager}>
                  Gestionnaire sans rapport à traiter
                </option>
              )}
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </label>
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
        {(selectedMonth !== "all" ||
          selectedManager !== "all" ||
          selectedReport !== "all" ||
          search) && (
          <button
            className="rp-text-button"
            type="button"
            onClick={() => {
              setSearch("");
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                ["mois", "gestionnaire", "rapport"].forEach((key) =>
                  next.delete(key),
                );
                return next;
              });
            }}
          >
            <ReportIcon name="close" /> Effacer les filtres
          </button>
        )}
      </div>
      {groups.length > 0 && (
        <ReportGroupedList
          groups={groups.slice(0, limit)}
          workspace={workspace}
        />
      )}
      {!filtered.length && (
        <ReportEmpty
          title={
            items.length
              ? "Aucun rapport dans cette sélection"
              : "Aucun rapport à traiter"
          }
        >
          {items.length
            ? "Essayez un autre mois, un autre gestionnaire ou effacez les filtres."
            : "Aucune période terminée n’attend de confirmation. Les nouvelles périodes apparaissent automatiquement une fois terminées."}
        </ReportEmpty>
      )}
      {groups.length > limit && (
        <div className="rp-todo-more">
          <button
            type="button"
            className="rp-button rp-button--secondary"
            onClick={() => setLimit((value) => value + 6)}
          >
            {groups.length - limit === 1
              ? "Afficher le mois suivant"
              : `Afficher les ${Math.min(6, groups.length - limit)} mois suivants`}
          </button>
        </div>
      )}
    </section>
  );
}
