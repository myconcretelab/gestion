import GaugeChart from "react-gauge-chart";

const PRIMARY_GAUGE_COLOR = "#ff5a5f";

type OccupationGaugeProps = {
  occupations: Array<{ year: number; occupation: number }>;
  selectedYear: number | "all";
  crownedYear?: number | null;
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
  showLeaderBadge?: boolean;
};

const CrownIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 18 3.5 8.75l4.4 3.35L12 5.5l4.1 6.6 4.4-3.35L19 18H5Z" />
    <path d="M6 20h12" />
  </svg>
);

export const OccupationGaugeDial = ({
  id,
  occupation,
  label,
  highlighted,
  className = "",
  animate = true,
  size = { width: 64, height: 30 },
  showLeaderBadge = false,
}: OccupationGaugeDialProps) => {
  const safeOccupation = Math.max(0, Math.min(1, occupation));

  return (
    <div className={`stats-occupation-gauge-item ${showLeaderBadge ? "stats-occupation-gauge-item--leader " : ""}${className}`.trim()}>
      {showLeaderBadge ? (
        <span className="stats-occupation-gauge-crown" aria-label="Meilleur taux de remplissage du mois">
          <CrownIcon />
        </span>
      ) : null}
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

const OccupationGauge = ({ occupations, selectedYear, crownedYear = null }: OccupationGaugeProps) => {
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
            showLeaderBadge={crownedYear === year}
          />
        );
      })}
    </div>
  );
};

export default OccupationGauge;
