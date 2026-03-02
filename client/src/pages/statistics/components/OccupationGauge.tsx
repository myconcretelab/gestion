import GaugeChart from "react-gauge-chart";

type OccupationGaugeProps = {
  occupations: Array<{ year: number; occupation: number }>;
  selectedYear: number | "all";
};

const OccupationGauge = ({ occupations, selectedYear }: OccupationGaugeProps) => {
  if (!occupations.length) {
    return <div className="stats-empty-chart">Aucune année disponible.</div>;
  }

  return (
    <div className="stats-occupation-gauges">
      {occupations.map(({ year, occupation }) => {
        const isSelected = year === selectedYear;
        return (
          <div key={year} className="stats-occupation-gauge-item">
            <GaugeChart
              id={`gauge-${year}`}
              nrOfLevels={10}
              percent={Math.max(0, Math.min(1, occupation))}
              colors={isSelected ? ["#d81060", "#d71163"] : ["#d2d2d2", "#f7f7f7"]}
              arcWidth={0.23}
              hideText
              needleColor="#2f2b2b"
              style={{ width: 64, height: 30 }}
            />
            <span className={`year ${isSelected ? "selected" : ""}`}>{year}</span>
            <strong>{Math.round(Math.max(0, occupation) * 100)}%</strong>
          </div>
        );
      })}
    </div>
  );
};

export default OccupationGauge;
