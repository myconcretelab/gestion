import {
  accommodationBreakdown,
  formatReportValue,
  type ReportDefinition,
  type ReportResult,
} from "./reportModel";

export default function AccommodationBreakdown({
  report,
  result,
}: {
  report: ReportDefinition;
  result: ReportResult;
}) {
  if (
    report.kind === "tourist" ||
    report.dateBasis !== "payment" ||
    !report.categories.includes("accommodation")
  )
    return null;
  const groups = accommodationBreakdown(result);
  return (
    <section
      className="rp-payment-breakdown"
      aria-label="Hébergement par mode de paiement"
    >
      <h3>Hébergement par mode de paiement</h3>
      {groups.length ? (
        <dl>
          {groups.map((group) => (
            <div key={group.id}>
              <dt>
                {group.label}
                <small>
                  {group.count} opération{group.count > 1 ? "s" : ""}
                </small>
              </dt>
              <dd>{formatReportValue(report, group.total)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rp-muted">Aucune recette d’hébergement incluse.</p>
      )}
    </section>
  );
}
