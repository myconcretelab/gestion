import { type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEuro } from "../../../utils/format";
import { type ExpenseReport as ExpenseReportData } from "../statisticsUtils";

type ExpenseReportProps = {
  report: ExpenseReportData;
  periodLabel: string;
  dynamicLabel: string;
};

const formatPercent = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(value || 0);

const formatEuroCompact = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);

const ExpenseReport = ({ report, periodLabel, dynamicLabel }: ExpenseReportProps) => {
  const chartRows = report.rowsByGite.map((row) => ({
    name: row.name,
    "CA brut": Math.round(row.revenue * 100) / 100,
    Frais: Math.round(row.expenses * 100) / 100,
    "Résultat net": Math.round(row.net * 100) / 100,
  }));
  const categoryRows = report.rowsByCategory.map((category) => ({
    name: category.name,
    value: Math.round(category.amount * 100) / 100,
    color: category.color,
  }));

  return (
    <section className="card stats-expense-report">
      <div className="stats-expense-report__header">
        <div>
          <p className="stats-expense-report__eyebrow">Rapport financier</p>
          <h2>Frais par gîte</h2>
          <p>
            Frais récurrents proratisés et {dynamicLabel.toLocaleLowerCase("fr-FR")} calculés pour {periodLabel}.
          </p>
        </div>
        <span className="stats-expense-report__period">{periodLabel}</span>
      </div>

      <div className="stats-expense-kpis">
        <article>
          <span>Frais fixes</span>
          <strong>{formatEuro(report.fixed)}</strong>
        </article>
        <article>
          <span>{dynamicLabel}</span>
          <strong>{formatEuro(report.dynamic)}</strong>
        </article>
        <article>
          <span>Total des frais</span>
          <strong>{formatEuro(report.expenses)}</strong>
          <small>{formatEuro(report.monthlyAverage)} / mois en moyenne</small>
        </article>
        <article className={report.net < 0 ? "is-negative" : "is-positive"}>
          <span>Résultat après frais</span>
          <strong>{formatEuro(report.net)}</strong>
          <small>{formatPercent(report.expenseRate)} du CA consacré aux frais</small>
        </article>
      </div>

      <div className="stats-expense-charts">
        <article className="stats-expense-chart-panel">
          <div className="stats-expense-chart-panel__heading">
            <h3>CA, frais et résultat par gîte</h3>
            <span>Comparaison sur la période</span>
          </div>
          {chartRows.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartRows} margin={{ top: 12, right: 12, left: 0, bottom: 12 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="name" interval={0} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(value) => formatEuroCompact(Number(value))} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => formatEuro(Number(value))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="CA brut" fill="#2D8CFF" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Frais" fill="#F5A623" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Résultat net" fill="#43B77D" radius={[5, 5, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="stats-empty-chart">Aucun gîte disponible</div>
          )}
        </article>

        <article className="stats-expense-chart-panel stats-expense-category-chart">
          <div className="stats-expense-chart-panel__heading">
            <h3>Répartition par catégorie</h3>
            <span>{formatEuro(report.expenses)} au total</span>
          </div>
          {categoryRows.length ? (
            <>
              <div className="stats-expense-category-chart__pie">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={categoryRows}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {categoryRows.map((category) => (
                        <Cell key={category.name} fill={category.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatEuro(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
                <strong>Frais</strong>
              </div>
              <div className="stats-expense-category-legend">
                {report.rowsByCategory.map((category) => (
                  <div
                    key={category.id}
                    style={{ "--expense-category-color": category.color } as CSSProperties}
                  >
                    <span className="stats-expense-category-legend__dot" />
                    <span>{category.name}</span>
                    <strong>{formatEuro(category.amount)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="stats-empty-chart">Aucun frais configuré</div>
          )}
        </article>
      </div>

      <div className="stats-expense-table-wrap">
        <table className="stats-expense-table">
          <thead>
            <tr>
              <th>Gîte</th>
              <th>CA brut</th>
              <th>Frais fixes</th>
              <th>{dynamicLabel}</th>
              <th>Total frais</th>
              <th>Résultat net</th>
              <th>Poids des frais</th>
            </tr>
          </thead>
          <tbody>
            {report.rowsByGite.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.name}</strong></td>
                <td>{formatEuro(row.revenue)}</td>
                <td>{formatEuro(row.fixed)}</td>
                <td>{formatEuro(row.dynamic)}</td>
                <td><strong>{formatEuro(row.expenses)}</strong></td>
                <td className={row.net < 0 ? "is-negative" : "is-positive"}>{formatEuro(row.net)}</td>
                <td>
                  <div className="stats-expense-rate">
                    <span style={{ width: `${Math.min(100, row.expenseRate * 100)}%` }} />
                  </div>
                  <small>{formatPercent(row.expenseRate)}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default ExpenseReport;
