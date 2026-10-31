import {
  formatReportValue,
  platformAmountBreakdown,
  reportAmountBasisLabel,
  type ReportDefinition,
  type ReportResult,
} from "./reportModel";

export default function ReportPlatformAmounts({
  report,
  result,
}: {
  report: ReportDefinition;
  result: ReportResult;
}) {
  if (report.kind === "tourist" || report.dateBasis !== "payment") return null;
  const amounts = platformAmountBreakdown(result);
  if (!amounts.detailedCount && !amounts.undetailedCount) return null;
  const net = report.otaAmountBasis === "net";
  return (
    <section
      className="rp-platform-amounts"
      aria-label="Brut, commissions et net des plateformes"
    >
      <p className="rp-platform-basis">
        <span>
          {amounts.detailedCount
            ? "Base retenue pour les versements détaillés"
            : "Montants de plateforme inclus"}
        </span>
        <strong>
          {amounts.detailedCount
            ? reportAmountBasisLabel(report)
            : "Brut / net non déterminé"}
        </strong>
        {amounts.undetailedCount > 0 && (
          <small>Choix du rapport : {reportAmountBasisLabel(report)}.</small>
        )}
      </p>
      {amounts.detailedCount > 0 && (
        <dl className="rp-platform-amounts__details">
          <div className={!net ? "is-selected" : undefined}>
            <dt>
              Brut avant commissions
              {!net && <small>Retenu dans le total</small>}
            </dt>
            <dd>{formatReportValue(report, amounts.grossCents)}</dd>
          </div>
          <div>
            <dt>Commissions prélevées</dt>
            <dd>{formatReportValue(report, -amounts.feeCents)}</dd>
          </div>
          <div className={net ? "is-selected" : undefined}>
            <dt>
              Net après commissions{net && <small>Retenu dans le total</small>}
            </dt>
            <dd>{formatReportValue(report, amounts.netCents)}</dd>
          </div>
        </dl>
      )}
      {amounts.undetailedCount > 0 && (
        <div className="rp-platform-amounts__undetailed">
          <div>
            <strong>Montants enregistrés sans détail de commission</strong>
            <b>{formatReportValue(report, amounts.undetailedCents)}</b>
          </div>
          <p>
            {amounts.undetailedCount} opération
            {amounts.undetailedCount > 1 ? "s" : ""} incluse
            {amounts.undetailedCount > 1 ? "s" : ""} telle
            {amounts.undetailedCount > 1 ? "s" : ""} quelle
            {amounts.undetailedCount > 1 ? "s" : ""}. Le brut et le net ne sont
            pas distingués : changer la base du rapport ne modifie pas ces
            montants.
          </p>
        </div>
      )}
      {amounts.otherCents !== 0 && (
        <dl className="rp-platform-amounts__details">
          <div>
            <dt>Autres recettes incluses</dt>
            <dd>{formatReportValue(report, amounts.otherCents)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
