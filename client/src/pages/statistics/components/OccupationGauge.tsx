import GaugeChart from "react-gauge-chart";

const PRIMARY_GAUGE_COLOR = "#ff5a5f";

type OccupationGaugeProps = {
  occupations: Array<{ year: number; occupation: number }>;
  selectedYear: number | "all";
};

type OccupationGaugeDialProps = {
  id: string;
  occupation: number;
  label?: string;
  highlighted: boolean;
  className?: string;
  animate?: boolean;
  size?: {
    width: number;
    height: number;
  };
};

export const OccupationGaugeDial = ({
  id,
  occupation,
  label,
  highlighted,
  className = "",
  animate = true,
  size = { width: 64, height: 30 },
}: OccupationGaugeDialProps) => {
  const safeOccupation = Math.max(0, Math.min(1, occupation));

  return (
    <div className={`stats-occupation-gauge-item ${className}`.trim()}>
      <GaugeChart
        id={id}
        nrOfLevels={10}
        percent={safeOccupation}
        colors={highlighted ? ["#d81060", "#d71163"] : ["#ffffff", PRIMARY_GAUGE_COLOR]}
        arcWidth={0.23}
        hideText
        needleColor="#2f2b2b"
        animate={animate}
        style={size}
      />
      {label ? <span className={`year ${highlighted ? "selected" : ""}`}>{label}</span> : null}
      <strong>{Math.round(safeOccupation * 100)}%</strong>
    </div>
  );
};

const OccupationGauge = ({ occupations, selectedYear }: OccupationGaugeProps) => {
  if (!occupations.length) {
    return <div className="stats-empty-chart">Aucune année disponible.</div>;
  }

  return (
    <div className="stats-occupation-gauges">
      {occupations.map(({ year, occupation }) => {
        return (
          <OccupationGaugeDial
            key={year}
            id={`gauge-${year}`}
            occupation={occupation}
            label={String(year)}
            highlighted={year === selectedYear}
          />
        );
      })}
    </div>
  );
};

export default OccupationGauge;
