import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import { getGiteColor } from "../utils/giteColors";
import {
  computeAverageCA,
  computeAverageNights,
  computeAveragePrice,
  computeAverageReservations,
  computeChequeVirementNightsByGite,
  computeGiteStats,
  computeGlobalStats,
  computeUrssafByManager,
  getMonthlyAverageCA,
  getMonthlyCAByGiteForYear,
  getMonthlyCAByYear,
  getOccupationPerYear,
  parseStatisticsPayload,
  type ParsedStatisticsEntry,
  type ParsedStatisticsPayload,
  type StatisticsGite,
  type StatisticsPayload,
} from "./statistics/statisticsUtils";
import GlobalRevenueChart, { type RevenueChartGroup } from "./statistics/components/GlobalRevenueChart";
import OccupationGauge from "./statistics/components/OccupationGauge";
import PaymentPieChart from "./statistics/components/PaymentPieChart";
import StatSwitch from "./statistics/components/StatSwitch";

type PeriodYear = number | "all";
type PeriodMonth = number | "";
type ChartSelection = "Tous" | string | number;
type AverageMode = "current" | "full";

const MONTHS = [
  { value: "", label: "-- année entière --" },
  { value: 1, label: "Janvier" },
  { value: 2, label: "Février" },
  { value: 3, label: "Mars" },
  { value: 4, label: "Avril" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juin" },
  { value: 7, label: "Juillet" },
  { value: 8, label: "Août" },
  { value: 9, label: "Septembre" },
  { value: 10, label: "Octobre" },
  { value: 11, label: "Novembre" },
  { value: 12, label: "Décembre" },
] as const;

const renderTrend = (value: number, average: number, isCurrency = false) => {
  if (!Number.isFinite(average) || average <= 0) return null;
  const up = value >= average;
  return (
    <span className={`stats-trend ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {isCurrency ? formatEuro(average) : average.toFixed(1)}
    </span>
  );
};

const getPeriodLabel = (year: PeriodYear, month: PeriodMonth) => {
  if (month) return `Mois ${month}${year === "all" ? "" : `/${year}`}`;
  return year === "all" ? "Toutes les années" : String(year);
};

const getChartTitle = (selectedItem: ChartSelection, giteById: Map<string, StatisticsGite>, year: number) => {
  if (selectedItem === "Tous") return `Chiffre d'affaire ${year}`;
  if (typeof selectedItem === "string") return `Chiffre d'affaire ${giteById.get(selectedItem)?.nom ?? "Gîte"} ${year}`;
  return `Chiffre d'affaire ${year}`;
};

const buildChartGroups = (params: {
  entriesByGite: Record<string, ParsedStatisticsEntry[]>;
  gites: StatisticsGite[];
  selectedItem: ChartSelection;
  avgMode: AverageMode;
}): RevenueChartGroup[] => {
  const { entriesByGite, gites, selectedItem, avgMode } = params;
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const giteById = new Map(gites.map((gite) => [gite.id, gite]));
  const excludeFutureMonthsInCurrentYear = avgMode === "current";

  if (typeof selectedItem === "number") {
    const byGite = getMonthlyCAByGiteForYear(entriesByGite, gites, selectedItem);
    return gites.map((gite) => {
      const stats = byGite[gite.id];
      const avgMonths = getMonthlyAverageCA({ [gite.id]: entriesByGite[gite.id] ?? [] }, { excludeFutureMonthsInCurrentYear });
      return {
        key: gite.id,
        title: `Chiffre d'affaire ${gite.nom} ${selectedItem}`,
        total: stats.total,
        months: stats.months.map((month, idx) => ({
          month: month.month,
          ca: month.ca,
          avg: avgMonths[idx]?.ca ?? 0,
          isFuture: selectedItem === currentYear && idx > currentMonth,
        })),
      };
    });
  }

  const filteredEntriesByGite = selectedItem === "Tous" ? entriesByGite : { [selectedItem]: entriesByGite[selectedItem] ?? [] };
  const byYear = getMonthlyCAByYear(filteredEntriesByGite);
  const average = getMonthlyAverageCA(filteredEntriesByGite, { excludeFutureMonthsInCurrentYear });
  const years = Object.keys(byYear)
    .map(Number)
    .sort((a, b) => b - a);

  return years.map((year) => ({
    key: String(year),
    title: getChartTitle(selectedItem, giteById, year),
    total: byYear[year]?.total ?? 0,
    months:
      byYear[year]?.months.map((month, idx) => ({
        month: month.month,
        ca: month.ca,
        avg: average[idx]?.ca ?? 0,
        isFuture: year === currentYear && idx > currentMonth,
      })) ?? [],
  }));
};

const copyRounded = (value: number) => {
  const text = String(Math.round(value));
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

const StatisticsPage = () => {
  const currentYear = new Date().getUTCFullYear();
  const [dataset, setDataset] = useState<ParsedStatisticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<PeriodYear>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<PeriodMonth>("");
  const [selectedItem, setSelectedItem] = useState<ChartSelection>("Tous");
  const [showUrssaf, setShowUrssaf] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [avgMode, setAvgMode] = useState<AverageMode>("current");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await apiFetch<StatisticsPayload>("/statistics");
      setDataset(parseStatisticsPayload(payload));
    } catch (err) {
      if (isApiError(err)) setError(err.message);
      else setError("Impossible de charger les statistiques.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!dataset) return;
    if (dataset.availableYears.length === 0) {
      setSelectedYear("all");
      return;
    }
    if (selectedYear !== "all" && !dataset.availableYears.includes(selectedYear)) {
      setSelectedYear(dataset.availableYears[0]);
    }
  }, [dataset, selectedYear]);

  useEffect(() => {
    if (!dataset) return;
    if (selectedItem === "Tous" || typeof selectedItem === "number") return;
    const exists = dataset.gites.some((gite) => gite.id === selectedItem);
    if (!exists) setSelectedItem("Tous");
  }, [dataset, selectedItem]);

  const gites = dataset?.gites ?? [];
  const entriesByGite = dataset?.entriesByGite ?? {};
  const availableYears = dataset?.availableYears ?? [];
  const allEntries = useMemo(() => Object.values(entriesByGite).flat(), [entriesByGite]);

  const globalStats = useMemo(() => computeGlobalStats(entriesByGite, selectedYear, selectedMonth), [entriesByGite, selectedMonth, selectedYear]);
  const averageReservations = useMemo(() => computeAverageReservations(allEntries, selectedYear, selectedMonth), [allEntries, selectedMonth, selectedYear]);
  const averageNights = useMemo(() => computeAverageNights(allEntries, selectedYear, selectedMonth), [allEntries, selectedMonth, selectedYear]);
  const averageCA = useMemo(() => computeAverageCA(allEntries, selectedYear, selectedMonth), [allEntries, selectedMonth, selectedYear]);

  const urssafByManager = useMemo(
    () => computeUrssafByManager(entriesByGite, gites, selectedYear, selectedMonth),
    [entriesByGite, gites, selectedMonth, selectedYear]
  );
  const chequeVirementNights = useMemo(
    () => computeChequeVirementNightsByGite(entriesByGite, gites, selectedYear, selectedMonth),
    [entriesByGite, gites, selectedMonth, selectedYear]
  );

  const chartGroups = useMemo(
    () =>
      buildChartGroups({
        entriesByGite,
        gites,
        selectedItem,
        avgMode,
      }),
    [avgMode, entriesByGite, gites, selectedItem]
  );

  const selectedItemValue = typeof selectedItem === "number" ? `year:${selectedItem}` : selectedItem;

  if (loading) {
    return (
      <div className="card">
        <div className="section-title">Statistiques</div>
        <p>Chargement des statistiques...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="section-title">Statistiques</div>
        <p style={{ color: "#b91c1c" }}>{error}</p>
        <button type="button" onClick={loadData}>
          Recharger
        </button>
      </div>
    );
  }

  return (
    <div className="stats-page">
      <section className="card stats-header-card">
        <div className="stats-toolbar">
          <div className="stats-filters">
            <label className="field">
              <span>Année</span>
              <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value === "all" ? "all" : Number(event.target.value))}>
                <option value="all">Toutes les années</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Mois</span>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value ? Number(event.target.value) : "")}>
                {MONTHS.map((month) => (
                  <option key={month.value || "all"} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="stats-switches">
            <StatSwitch label="Mode déclaration" checked={showUrssaf} onChange={setShowUrssaf} />
            <StatSwitch label="Stats" checked={showStats} onChange={setShowStats} />
          </div>
        </div>

        {showUrssaf ? (
          <div className="stats-urssaf">
            <div className="stats-urssaf-managers">
              {urssafByManager.map((manager, index) => (
                <div key={manager.manager} className="stats-urssaf-manager">
                  <span className={`stats-urssaf-owner stats-urssaf-owner--${index % 4}`}>URSSAF {manager.manager}</span>
                  <span className="stats-urssaf-value">{formatEuro(manager.amount)}</span>
                  <button type="button" className="stats-copy-btn" onClick={() => copyRounded(manager.amount)}>
                    copier
                  </button>
                </div>
              ))}
              {urssafByManager.length === 0 ? <div>Aucun montant URSSAF sur la période.</div> : null}
            </div>
            <div className="stats-urssaf-nights">
              {gites.map((gite) => (
                <div key={gite.id} className="stats-urssaf-night-item">
                  <strong>{gite.nom}</strong>
                  <span>{Math.round(chequeVirementNights[gite.id] ?? 0)} nuitées</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="stats-global-cards">
          <article>
            <p>Total réservations</p>
            <strong>{globalStats.totalReservations}</strong>
            {showStats ? renderTrend(globalStats.totalReservations, averageReservations) : null}
          </article>
          <article>
            <p>Total nuits réservées</p>
            <strong>{globalStats.totalNights}</strong>
            {showStats ? renderTrend(globalStats.totalNights, averageNights) : null}
          </article>
          <article>
            <p>Chiffre d'affaire brut</p>
            <strong>{formatEuro(globalStats.totalCA)}</strong>
            {showStats ? renderTrend(globalStats.totalCA, averageCA, true) : null}
          </article>
        </div>

        <div className="stats-tax-bar stats-tax-bar--header">
          <div className="stats-tax-track-wrap">
            <div className="stats-tax-track">
              <div className="stats-tax-fill" style={{ width: `${globalStats.totalCA > 0 ? 94 : 0}%` }} />
            </div>
            <span className="stats-tax-percent">6% impôt</span>
          </div>
          <div className="stats-tax-values">
            <span>CA net: {formatEuro(globalStats.totalCA * 0.94)}</span>
            <span>Impôt : {formatEuro(globalStats.totalCA * 0.06)}</span>
          </div>
        </div>
      </section>

      <section className="stats-gites-grid">
        {gites.map((gite, index) => {
          const giteColor = getGiteColor(gite, index);
          const entries = entriesByGite[gite.id] ?? [];
          const stats = computeGiteStats(entries, selectedYear, selectedMonth);
          const avgReservations = computeAverageReservations(entries, selectedYear, selectedMonth);
          const avgNightsByGite = computeAverageNights(entries, selectedYear, selectedMonth);
          const avgCAByGite = computeAverageCA(entries, selectedYear, selectedMonth);
          const avgPriceByGite = computeAveragePrice(entries, selectedYear, selectedMonth);
          const occupations = getOccupationPerYear(entries, availableYears, selectedMonth);

          return (
            <article
              key={gite.id}
              className="card stats-gite-card gite-accent"
              style={{ "--gite-accent-color": giteColor } as CSSProperties}
            >
              <header>
                <h3>{gite.nom}</h3>
                <span>{getPeriodLabel(selectedYear, selectedMonth)}</span>
              </header>

              <div className="stats-gite-metrics">
                <div>
                  <p>Réservations</p>
                  <strong>{stats.reservations}</strong>
                  {showStats ? renderTrend(stats.reservations, avgReservations) : null}
                </div>
                <div>
                  <p>Nuits</p>
                  <strong>{stats.totalNights}</strong>
                  {showStats ? renderTrend(stats.totalNights, avgNightsByGite) : null}
                </div>
                <div>
                  <p>CA brut</p>
                  <strong>{formatEuro(stats.totalCA)}</strong>
                  {showStats ? renderTrend(stats.totalCA, avgCAByGite, true) : null}
                </div>
                <div>
                  <p>Durée moy.</p>
                  <strong>{stats.meanStay.toFixed(1)} nuits</strong>
                </div>
                <div>
                  <p>Prix moy./nuit</p>
                  <strong>{formatEuro(stats.meanPrice)}</strong>
                  {showStats ? renderTrend(stats.meanPrice, avgPriceByGite, true) : null}
                </div>
              </div>

              <div className="stats-tax-bar compact">
                <div className="stats-tax-track">
                  <div className="stats-tax-fill" style={{ width: `${stats.totalCA > 0 ? 94 : 0}%` }} />
                </div>
                <div className="stats-tax-values">
                  <span>Net: {formatEuro(stats.totalCA * 0.94)}</span>
                  <span>Impôt: {formatEuro(stats.totalCA * 0.06)}</span>
                </div>
              </div>

              <div className="stats-gite-bottom charty">
                <div>
                  <p className="stats-subtitle">Répartition des paiements</p>
                  <PaymentPieChart payments={stats.payments} />
                </div>
                <div>
                  <p className="stats-subtitle">Taux d'occupation</p>
                  <OccupationGauge occupations={occupations} selectedYear={selectedYear} />
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="card stats-chart-card">
        <div className="stats-chart-toolbar">
          <label className="field">
            <span>Gîte ou année</span>
            <select
              value={selectedItemValue}
              onChange={(event) => {
                const next = event.target.value;
                if (next.startsWith("year:")) setSelectedItem(Number(next.slice(5)));
                else setSelectedItem(next);
              }}
            >
              <option value="Tous">Tous les gîtes</option>
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
              {availableYears.map((year) => (
                <option key={year} value={`year:${year}`}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>

        <GlobalRevenueChart groups={chartGroups} avgMode={avgMode} onAvgModeChange={setAvgMode} />
      </section>
    </div>
  );
};

export default StatisticsPage;
