import { useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { ReportWorkspace } from "./ReportsPrototypePage";
import {
  applySourceCorrection,
  DEMO_OPERATIONS,
  propertyName,
  REPORT_OPERATORS,
  REPORT_PAYMENT_METHODS,
  REPORT_PROPERTIES,
  type EvaluatedOperation,
  type ReportIssue,
  type ReportPaymentMethod,
} from "./reportPrototype";
import { ReportIcon } from "./ReportUi";

export const sourceCorrectionHref = (
  workspace: ReportWorkspace,
  reportId: string,
  row: EvaluatedOperation,
  issue: ReportIssue,
) =>
  `${workspace.href(`/corriger/${issue.kind}/${issue.kind === "operator" ? row.propertyId : row.id}`)}&rapport=${encodeURIComponent(reportId)}`;

export default function ReportSourceEditor({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const { issueType, sourceId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { state, setState, href, canEdit, notify } = workspace;
  const returnReport = state.reports.find(
    (report) => report.id === params.get("rapport"),
  );
  const returnHref = href(returnReport ? `/${returnReport.id}` : "");
  const property = REPORT_PROPERTIES.find((item) => item.id === sourceId);
  const operation = DEMO_OPERATIONS.find((item) => item.id === sourceId);
  const edit = sourceId ? state.operationEdits[sourceId] : undefined;
  const [operatorId, setOperatorId] = useState(
    property ? (state.propertyOperators[property.id] ?? "") : "",
  );
  const [paymentDate, setPaymentDate] = useState(
    edit?.paymentDate ?? operation?.paymentDate ?? "",
  );
  const [paymentMethod, setPaymentMethod] = useState<ReportPaymentMethod>(
    edit?.paymentMethod ?? operation?.paymentMethod ?? "unknown",
  );
  const [error, setError] = useState("");
  if (
    (issueType !== "operator" && issueType !== "payment") ||
    (issueType === "operator" ? !property : !operation)
  )
    return (
      <div className="rp-empty">
        <h1>Élément introuvable</h1>
        <Link to={returnHref}>Revenir au rapport</Link>
      </div>
    );
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    if (issueType === "operator") {
      if (!operatorId) {
        setError("Sélectionnez un exploitant.");
        return;
      }
      setState((previous) =>
        applySourceCorrection(previous, {
          kind: "operator",
          propertyId: property!.id,
          operatorId,
        }),
      );
      notify(
        "Exploitant enregistré. Les rapports concernés ont été recalculés.",
      );
    } else {
      if (
        !paymentDate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
        !Number.isFinite(Date.parse(`${paymentDate}T12:00:00Z`)) ||
        new Date(`${paymentDate}T12:00:00Z`).toISOString().slice(0, 10) !==
          paymentDate ||
        paymentMethod === "unknown"
      ) {
        setError("Renseignez une date valide et un mode de paiement.");
        return;
      }
      setState((previous) =>
        applySourceCorrection(previous, {
          kind: "payment",
          operationId: operation!.id,
          paymentDate,
          paymentMethod,
        }),
      );
      notify(
        "Encaissement enregistré. Les rapports concernés ont été recalculés.",
      );
    }
    navigate(returnHref);
  };
  return (
    <>
      <Link className="rp-back-link" to={returnHref}>
        <ReportIcon name="back" />
        Revenir au rapport
      </Link>
      <header className="rp-page-header">
        <div>
          <h1>
            {issueType === "operator"
              ? "Rattacher le gîte à un exploitant"
              : "Renseigner l’encaissement"}
          </h1>
        </div>
      </header>
      <form className="rp-panel rp-source-editor" onSubmit={save}>
        <h2>
          {issueType === "operator"
            ? property!.name
            : `${operation!.guest} · ${operation!.reservation}`}
        </h2>
        <p className="rp-muted">
          {issueType === "operator"
            ? "Ce rattachement s’applique à toutes les opérations de ce gîte dans la démonstration."
            : `${propertyName(operation!.propertyId)}. La date saisie détermine la période des rapports basés sur les encaissements.`}
        </p>
        {issueType === "operator" ? (
          <label className="rp-field">
            Exploitant
            <select
              required
              disabled={!canEdit}
              value={operatorId}
              onChange={(event) => setOperatorId(event.target.value)}
            >
              <option value="">Sélectionner un exploitant</option>
              {REPORT_OPERATORS.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="rp-field">
              Date du paiement reçu
              <input
                required
                disabled={!canEdit}
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </label>
            <label className="rp-field">
              Mode de paiement
              <select
                required
                disabled={!canEdit}
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(event.target.value as ReportPaymentMethod)
                }
              >
                <option value="unknown">Sélectionner un mode</option>
                {REPORT_PAYMENT_METHODS.filter(
                  (method) => method.id !== "unknown",
                ).map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="rp-form-error">
            {error}
          </p>
        )}
        <div className="rp-dialog__actions">
          <Link className="rp-button rp-button--secondary" to={returnHref}>
            Annuler
          </Link>
          {canEdit && (
            <button type="submit" className="rp-button">
              <ReportIcon name="check" />
              Enregistrer
            </button>
          )}
        </div>
      </form>
    </>
  );
}
