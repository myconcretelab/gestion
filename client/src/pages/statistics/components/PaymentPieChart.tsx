import { useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatEuro } from "../../../utils/format";
import { buildPaymentColorMap, getPaymentColorFromMap } from "../../../utils/paymentColors";

type PaymentPieChartProps = {
  payments: Record<string, number>;
  sourceColors?: Record<string, string>;
};

const PaymentPieChart = ({ payments, sourceColors }: PaymentPieChartProps) => {
  const [activeLegend, setActiveLegend] = useState<string | null>(null);
  const paymentColorMap = buildPaymentColorMap(sourceColors);
  const data = Object.entries(payments || {}).map(([name, value]) => ({
    name,
    value: Math.round(value * 100) / 100,
  }));

  if (!data.length) {
    return <div className="stats-empty-chart">Aucun paiement</div>;
  }

  const renderLegend = ({ payload }: { payload?: Array<{ value?: string; color?: string; payload?: { value?: number } }> }) => {
    if (!payload || payload.length === 0) return null;

    return (
      <div className="stats-pie-legend">
        {payload.map((entry) => {
          const label = entry.value ?? "";
          const amount = Number(entry.payload?.value ?? 0);
          const isActive = activeLegend === label;
          return (
            <div
              key={label}
              className="stats-pie-legend-item"
              onMouseEnter={() => setActiveLegend(label)}
              onMouseLeave={() => setActiveLegend(null)}
              onFocus={() => setActiveLegend(label)}
              onBlur={() => setActiveLegend(null)}
              tabIndex={0}
            >
              <span className="dot" style={{ backgroundColor: entry.color }} />
              <span>{label}</span>
              <span className={`stats-pie-amount ${isActive ? "active" : ""}`}>{formatEuro(amount)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={140}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="30%"
          cy="50%"
          innerRadius={30}
          outerRadius={50}
          labelLine={false}
          isAnimationActive
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={getPaymentColorFromMap(entry.name, paymentColorMap)} />
          ))}
        </Pie>
        <Legend
          verticalAlign="middle"
          align="right"
          iconType="circle"
          layout="vertical"
          content={renderLegend}
          wrapperStyle={{ right: 0, top: "50%", transform: "translateY(-50%)", fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default PaymentPieChart;
