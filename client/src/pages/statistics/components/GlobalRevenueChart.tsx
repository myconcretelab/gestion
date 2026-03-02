import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatEuro } from "../../../utils/format";

export type RevenueChartGroup = {
  key: string;
  title: string;
  total: number;
  months: Array<{
    month: number;
    ca: number;
    avg: number;
    isFuture: boolean;
  }>;
};

type GlobalRevenueChartProps = {
  groups: RevenueChartGroup[];
  avgMode: "current" | "full";
  onAvgModeChange: (mode: "current" | "full") => void;
};

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Avr", "Mai", "Juin", "Juil", "Aout", "Sep", "Oct", "Nov", "Dec"];

const getColor = (value: number, max: number) => {
  const ratio = max > 0 ? value / max : 0;
  const hue = 60 - ratio * 60;
  return `hsla(${hue}, 90%, 70%, 1)`;
};

const formatEUR0 = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);

const GlobalRevenueChart = ({ groups, avgMode, onAvgModeChange }: GlobalRevenueChartProps) => {
  const hasFutureMonths = groups.some((group) => group.months.some((month) => month.isFuture));

  return (
    <div className="stats-global-chart">
      <div className="stats-global-chart-toolbar">
        <div className="stats-global-toggle">
          <span>Moyenne</span>
          <div className="stats-avg-mode">
            <button
              type="button"
              className={avgMode === "current" ? "active" : ""}
              onClick={() => onAvgModeChange("current")}
            >
              Mois courants
            </button>
            <button type="button" className={avgMode === "full" ? "active" : ""} onClick={() => onAvgModeChange("full")}>
              Complete
            </button>
          </div>
        </div>
        {hasFutureMonths ? (
          <div className="stats-future-legend">
            <span className="box" />
            <span>Mois futurs</span>
          </div>
        ) : null}
      </div>

      {groups.map((group) => {
        const groupMax = Math.max(...group.months.map((month) => month.ca), 0);
        const roundedMax = Math.ceil(groupMax / 100) * 100;
        const ticks = Array.from({ length: Math.max(2, roundedMax / 100 + 1) }, (_, idx) => idx * 100);

        return (
          <article key={group.key} className="stats-chart-group chart-mode">
            <header>
              <h3>{group.title}</h3>
              <strong>{formatEUR0(group.total)}</strong>
            </header>

            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={group.months} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="month" tickFormatter={(value) => MONTH_NAMES[value - 1]} stroke="#777" />
                <YAxis domain={[0, Math.max(100, roundedMax)]} ticks={ticks} stroke="#777" />
                <Tooltip formatter={(value) => formatEuro(Number(value))} />
                <Line type="monotone" dataKey="avg" stroke="#c7ced8" strokeWidth={4} dot={false} />
                <Bar dataKey="ca" radius={[6, 6, 0, 0]}>
                  {group.months.map((entry, idx) => (
                    <Cell
                      key={`${group.key}-${idx}`}
                      fill={entry.isFuture ? "#d0d0d0" : getColor(entry.ca, groupMax)}
                      stroke={entry.isFuture ? "#b0b0b0" : undefined}
                      strokeWidth={entry.isFuture ? 1 : undefined}
                    />
                  ))}
                  <LabelList dataKey="ca" position="top" formatter={(value: number) => formatEUR0(value)} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </article>
        );
      })}

      {groups.length === 0 ? <p>Aucune donnée de chiffre d'affaire disponible pour le graphique.</p> : null}
    </div>
  );
};

export default GlobalRevenueChart;
