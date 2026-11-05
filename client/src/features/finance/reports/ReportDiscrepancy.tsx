import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  categoryLabel,
  formatReportValue,
  getReportPeriod,
  paymentMethodLabel,
  reportChanges,
  reportHasPendingChanges,
  reportPaymentReviewRequired,
  reportReference,
  type EvaluatedOperation,
  type ReportDefinition,
  type ReportProgress,
  type ReportResolution,
  type ReportResult,
} from "@contrats/shared";
import { canCurrentUserAccessPage } from "../../../utils/auth";
import { reservationPaymentsHref } from "../../../utils/reservationNavigation";
import type { ReportWorkspace } from "./ReportsPage";
import { ReportDialog, ReportIcon } from "./ReportUi";

export const resolutionLabel = (outcome: ReportResolution["outcome"]) =>
  outcome === "corrected"
    ? "Déclaration rectifiée"
    : "Écart examiné, déclaration conservée";

const dateLabel = (date: string | null) =>
  date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", {
        timeZone: "UTC",
      })
    : "Sans date";

export default function ReportDiscrepancy({
  workspace,
  report,
  result,
  progress,
  month,
}: {
  workspace: ReportWorkspace;
  report: ReportDefinition;
  result: ReportResult;
  progress: ReportProgress | undefined;
  month: string;
}) {
  const { state, canEdit, saving, loading, mutate, notify, propertyName } =
    workspace;
  const [opened, setOpened] = useState<{
    revision: number;
    factsRevision: string;
  } | null>(null);
  const [outcome, setOutcome] = useState<ReportResolution["outcome"] | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const fieldId = useId();
  const reference = reportReference(progress);
  const pending = reportHasPendingChanges(progress, result);
  if (!reference || (!pending && !opened)) return null;
  const changes = reportChanges(reference, result);
  const stale = Boolean(
    opened &&
    (opened.revision !== state.revision ||
      opened.factsRevision !== state.factsRevision),
  );
  const blocked =
    stale ||
    !pending ||
    result.reviewCount > 0 ||
    reportPaymentReviewRequired(result) ||
    saving ||
    loading;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !canEdit || !outcome || note.trim().length < 3) return;
    setError("");
    if (
      await mutate(
        { type: "resolve", reportId: report.id, outcome, note: note.trim() },
        month,
      )
    ) {
      setOpened(null);
      notify("Écart résolu. Ce rapport a été retiré des rapports à traiter.");
    } else {
      setError(
        "La résolution n’a pas été enregistrée. Vérifiez les données et réessayez.",
      );
    }
  };
  const operationValue = (row: EvaluatedOperation | undefined) =>
    row ? (
      <>
        <strong>{formatReportValue(report, row.value)}</strong>
        <small>
          {
            {
              included: "Inclus",
              excluded: "Hors périmètre",
              review: "À vérifier",
            }[row.status]
          }
        </small>
        <small>
          {dateLabel(row.effectiveDate)} ·{" "}
          {paymentMethodLabel(row.paymentMethod)}
        </small>
        {row.paymentDateEstimated && <small>Date estimée</small>}
      </>
    ) : (
      <span>Absente</span>
    );
  return (
    <>
      <button
        type="button"
        className="rp-button"
        disabled={saving || loading}
        onClick={() => {
          setOpened({
            revision: state.revision,
            factsRevision: state.factsRevision,
          });
          setOutcome("");
          setNote("");
          setError("");
        }}
      >
        <ReportIcon name="check" />
        {canEdit ? "Examiner et résoudre l’écart" : "Examiner l’écart"}
      </button>
      {opened && (
        <ReportDialog
          title="Examiner l’écart"
          onClose={() => setOpened(null)}
          wide
        >
          <p>
            <strong>
              {report.name} · {report.recipient}
            </strong>
            <br />
            {getReportPeriod(month, report.cadence).label}
          </p>
          <div className="rp-discrepancy-totals">
            <div>
              <span>
                {progress?.resolutions?.length
                  ? "Dernière résolution"
                  : "Copie confirmée"}
              </span>
              <strong>
                {formatReportValue(report, reference.result.total)}
              </strong>
            </div>
            <div>
              <span>Calcul actuel</span>
              <strong>{formatReportValue(report, result.total)}</strong>
            </div>
            <div>
              <span>Écart</span>
              <strong>
                {result.total > reference.result.total ? "+" : ""}
                {formatReportValue(
                  report,
                  result.total - reference.result.total,
                )}
              </strong>
            </div>
          </div>
          <h3>Opérations modifiées ({changes.length})</h3>
          <p className="rp-muted">
            Les changements de date, de mode de paiement ou de statut
            apparaissent aussi lorsque le total reste identique.
          </p>
          <div className="rp-discrepancy-changes">
            {changes.map(({ id, before, after }) => {
              const row = after ?? before!;
              return (
                <article key={id} className="rp-discrepancy-change">
                  <header>
                    <strong>
                      {row.guest} · {row.reservation}
                    </strong>
                    <span>
                      {propertyName(row.propertyId)} ·{" "}
                      {categoryLabel(row.category)} ·{" "}
                      {!before ? "Ajoutée" : !after ? "Retirée" : "Modifiée"}
                    </span>
                    {row.reservationId &&
                      canCurrentUserAccessPage("reservations") && (
                        <Link
                          className="rp-text-button"
                          to={reservationPaymentsHref(
                            row.reservationId,
                            row.stayDate,
                          )}
                        >
                          Voir les règlements
                        </Link>
                      )}
                  </header>
                  {before &&
                    after &&
                    before.declarationSourceSignature !==
                      after.declarationSourceSignature && (
                      <p className="rp-field-help">
                        Les informations du registre de déclaration ont changé.
                        Consultez le registre des séjours pour les vérifier.
                      </p>
                    )}
                  <div className="rp-discrepancy-values">
                    <div>
                      <span>Avant</span>
                      {operationValue(before)}
                    </div>
                    <div>
                      <span>Maintenant</span>
                      {operationValue(after)}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {stale && (
            <p className="rp-notice" role="alert">
              Les données ont changé pendant l’examen. Fermez puis rouvrez
              l’écart pour examiner la nouvelle comparaison.
            </p>
          )}
          {result.reviewCount > 0 && (
            <p className="rp-notice" role="alert">
              Corrigez les opérations à vérifier avant d’enregistrer la
              résolution.
            </p>
          )}
          {reportPaymentReviewRequired(result) && (
            <p className="rp-notice" role="alert">
              Vérifiez les règlements des séjours terminés dans le rapport avant
              d’enregistrer cette résolution.
            </p>
          )}
          {canEdit ? (
            <form onSubmit={submit}>
              <fieldset className="rp-resolution-choices" disabled={blocked}>
                <legend>Comment avez-vous traité cet écart ?</legend>
                {(["corrected", "kept"] as const).map((value) => (
                  <label
                    key={value}
                    className={outcome === value ? "is-selected" : ""}
                  >
                    <input
                      type="radio"
                      name={`${fieldId}-outcome`}
                      value={value}
                      checked={outcome === value}
                      onChange={() => setOutcome(value)}
                      required
                    />
                    <span>
                      <strong>{resolutionLabel(value)}</strong>
                      <small>
                        {value === "corrected"
                          ? "J’ai effectué la démarche de correction auprès du destinataire avec les chiffres actuels."
                          : "Après examen, je conserve la déclaration déjà effectuée et j’explique mon choix."}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className="rp-field" htmlFor={`${fieldId}-note`}>
                Justification de la résolution
                <textarea
                  id={`${fieldId}-note`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  required
                  minLength={3}
                  maxLength={1000}
                  rows={3}
                  disabled={blocked}
                  placeholder="Indiquez la démarche effectuée, sa référence ou la raison de conserver la déclaration…"
                />
              </label>
              <p className="rp-muted">
                La copie confirmée d’origine reste conservée. Cette action
                n’envoie aucune déclaration. Le rapport sortira de « À traiter »
                et réapparaîtra si les données changent à nouveau.
              </p>
              {error && (
                <p className="rp-notice" role="alert">
                  {error}
                </p>
              )}
              <div className="rp-dialog__actions">
                <button
                  type="button"
                  className="rp-button rp-button--secondary"
                  onClick={() => setOpened(null)}
                >
                  Revenir au rapport
                </button>
                <button
                  type="submit"
                  className="rp-button"
                  disabled={blocked || !outcome || note.trim().length < 3}
                >
                  Enregistrer la résolution
                </button>
              </div>
            </form>
          ) : (
            <p className="rp-muted">
              Un accès en écriture est nécessaire pour enregistrer une
              résolution.
            </p>
          )}
        </ReportDialog>
      )}
    </>
  );
}
