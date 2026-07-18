import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
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

  const renderLegend = () => {
    return (
      <div className="stats-pie-legend">
        {data.map((entry) => {
          const color = getPaymentColorFromMap(entry.name, paymentColorMap);
          const isActive = activeLegend === entry.name;
          return (
            <div
              key={entry.name}
              className="stats-pie-legend-item"
              onMouseEnter={() => setActiveLegend(entry.name)}
              onMouseLeave={() => setActiveLegend(null)}
              onFocus={() => setActiveLegend(entry.name)}
              onBlur={() => setActiveLegend(null)}
              tabIndex={0}
            >
              <span className="dot" style={{ backgroundColor: color }} />
              <span>{entry.name}</span>
              <span className={`stats-pie-amount ${isActive ? "active" : ""}`}>{formatEuro(entry.value)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="stats-payment-pie-chart">
      <div className="stats-payment-pie-visual">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
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
          </PieChart>
        </ResponsiveContainer>
      </div>
      {renderLegend()}
    </div>
  );
};

export default PaymentPieChart;
