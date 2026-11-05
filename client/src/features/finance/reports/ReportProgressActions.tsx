import { useState } from "react";
import {
  getReportPeriod,
  reportDefinitionSchema,
  formatReportValue,
  reportPaymentReviewRequired,
  type ReportDefinition,
  type ReportProgress,
  type ReportResult,
} from "@contrats/shared";
import type { ReportWorkspace } from "./ReportsPage";
import { ReportDialog, ReportIcon, ReportKindIcon } from "./ReportUi";

export default function ReportProgressActions({
  workspace,
  report,
  result,
  progress,
  month,
  compact = false,
}: {
  workspace: ReportWorkspace;
  report: ReportDefinition;
  result: ReportResult;
  progress: ReportProgress | undefined;
  month: string;
  compact?: boolean;
}) {
  const { state, canEdit, saving, loading, mutate, notify } = workspace;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const period = getReportPeriod(month, report.cadence);
  const propertyNames = report.propertyIds.map(
    (id) =>
      state.properties.find((property) => property.id === id)?.name ??
      "Gîte à vérifier",
  );
  const scopeValid = report.propertyIds.every((id) =>
    state.properties.some((property) => property.id === id),
  );
  const managerValid =
    !report.managerId ||
    (state.managers?.some((manager) => manager.id === report.managerId) &&
      report.propertyIds.every(
        (id) => state.propertyManagers?.[id] === report.managerId,
      ));
  const operatorValid =
    report.kind !== "social" ||
    (state.operators.some(
      (operator) => operator.id === report.operatorId && !operator.legacy,
    ) &&
      report.propertyIds.every(
        (id) =>
          state.propertyOperators[id] === report.operatorId &&
          !state.operatorIssues?.[id] &&
          !state.socialIssues?.[id],
      ));
  const eligible =
    canEdit &&
    !progress?.snapshot &&
    !result.reviewCount &&
    !reportPaymentReviewRequired(result) &&
    reportDefinitionSchema.safeParse(report).success &&
    scopeValid &&
    managerValid &&
    operatorValid;
  if (!eligible && !confirming) return null;
  const label = progress?.ready
    ? "Confirmer la transmission"
    : "Marquer comme prêt";
  return (
    <>
      <button
        type="button"
        className={`rp-button rp-progress-button${compact ? " rp-progress-button--compact" : ""}${progress?.ready ? " is-ready" : ""}`}
        disabled={!eligible || saving || loading}
        aria-label={
          compact
            ? `${label} : ${[report.name, ...(report.kind === "tourist" ? propertyNames : []), report.recipient, period.label].join(" · ")}`
            : undefined
        }
        title={label}
        onClick={async () => {
          if (!eligible || saving || loading) return;
          if (progress?.ready) {
            setError("");
            setConfirming(true);
          } else if (
            await mutate({ type: "ready", reportId: report.id }, month)
          ) {
            notify("Rapport marqué comme prêt.");
          }
        }}
      >
        <ReportIcon name="check" />
        {compact
          ? progress?.ready
            ? "Confirmer l’envoi"
            : "Marquer prêt"
          : label}
      </button>
      {confirming && (
        <ReportDialog
          title="Conserver une copie confirmée"
          onClose={() => setConfirming(false)}
        >
          <div className="rp-confirm-identity">
            <strong>
              {report.name} · {report.recipient}
            </strong>
            {report.kind === "tourist" && (
              <span>{propertyNames.join(" · ")}</span>
            )}
          </div>
          <div className="rp-confirm-value">
            <ReportKindIcon kind={report.kind} />
            <strong>{formatReportValue(report, result.total)}</strong>
            <span>{period.label}</span>
          </div>
          <p>
            Confirmez cette action après avoir effectué la démarche externe. Les
            chiffres, les règles et les opérations de cette période seront
            conservés sur le serveur dans une copie figée.
          </p>
          <p className="rp-muted">
            Cette action n’envoie aucune information à un organisme.
          </p>
          {(!eligible || !progress?.ready) && (
            <p className="rp-notice" role="alert">
              Le rapport a changé. Revenez aux rapports pour vérifier son état
              avant de confirmer.
            </p>
          )}
          {error && (
            <p className="rp-notice" role="alert">
              {error}
            </p>
          )}
          <div className="rp-dialog__actions">
            <button
              type="button"
              className="rp-button rp-button--secondary"
              onClick={() => setConfirming(false)}
            >
              {compact ? "Revenir aux rapports" : "Revenir au rapport"}
            </button>
            <button
              type="button"
              className="rp-button"
              disabled={!eligible || !progress?.ready || saving || loading}
              onClick={async () => {
                if (!eligible || !progress?.ready || saving || loading) return;
                setError("");
                if (
                  await mutate({ type: "confirm", reportId: report.id }, month)
                ) {
                  setConfirming(false);
                  notify("Copie confirmée enregistrée.");
                } else {
                  setError(
                    "La confirmation n’a pas pu être enregistrée. Vérifiez l’état du rapport puis réessayez.",
                  );
                }
              }}
            >
              Confirmer la transmission
            </button>
          </div>
        </ReportDialog>
      )}
    </>
  );
}
