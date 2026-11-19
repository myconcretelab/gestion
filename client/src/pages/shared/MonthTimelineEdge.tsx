export default function MonthTimelineEdge({
  direction,
  busy,
  onLoad,
}: {
  direction: "previous" | "next";
  busy: boolean;
  onLoad: () => void;
}) {
  return (
    <div className="month-timeline-edge">
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={onLoad}
      >
        {direction === "previous" ? "Mois précédents" : "Mois suivants"}
      </button>
    </div>
  );
}
