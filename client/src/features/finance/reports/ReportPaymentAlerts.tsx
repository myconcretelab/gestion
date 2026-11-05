import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  reportPaymentAlertSignature,
  type ReportResult,
} from "@contrats/shared";
import type { ReportWorkspace } from "./ReportsPage";
import { canCurrentUserAccessPage } from "../../../utils/auth";
import { reservationPaymentsHref } from "../../../utils/reservationNavigation";

const money = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const date = (value: string) => value.split("-").reverse().join("/");

export default function ReportPaymentAlerts({
  workspace,
  reportId,
  month,
  result,
  archived = false,
}: {
  workspace: ReportWorkspace;
  reportId: string;
  month: string;
  result: ReportResult;
  archived?: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const alerts = result.paymentAlerts ?? [];
  if (!alerts.length) return null;
  const reviewed = Boolean(result.paymentReview);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !workspace.canEdit ||
      archived ||
      workspace.saving ||
      workspace.loading ||
      note.trim().length < 3
    )
      return;
    setError("");
    if (
      await workspace.mutate(
        {
          type: "payment-review",
          reportId,
          signature: reportPaymentAlertSignature(result),
          note: note.trim(),
        },
        month,
      )
    ) {
      setNote("");
      workspace.notify("Vérification des règlements enregistrée.");
    } else
      setError(
        "La vérification n’a pas été enregistrée. Actualisez les données puis réessayez.",
      );
  };
  return (
    <section
      className="rp-panel rp-payment-alerts"
      id="rp-payment-alerts"
      aria-label="Paiements des séjours terminés"
    >
      <h2>
        Séjours terminés :{" "}
        {reviewed
          ? "situation des règlements vérifiée"
          : "règlements à vérifier"}{" "}
        ({alerts.length})
      </h2>
      <p>
        Ces séjours terminés avant aujourd’hui ont un règlement absent,
        incomplet ou à vérifier. Enregistrez les paiements déjà reçus, ou
        expliquez les sommes encore impayées. Les montants ci-dessous ne sont
        pas ajoutés aux recettes.
      </p>
      <ul className="rp-payment-alerts__list">
        {(expanded ? alerts : alerts.slice(0, 5)).map((alert) => (
          <li key={alert.reservationId}>
            <div>
              <strong>{alert.guest}</strong>
              <span>
                {alert.stays
                  .map(
                    (stay) =>
                      `${stay.propertyLabel} · ${date(stay.arrival)} au ${date(stay.departure)}`,
                  )
                  .join(" ; ")}{" "}
                · {alert.bookingSource}
              </span>
              <span>
                {alert.reason === "missing"
                  ? "Aucun règlement enregistré"
                  : alert.reason === "partial"
                    ? "Règlement partiel"
                    : "Règlement ou date à vérifier"}
                {" · "}Montant du séjour : {money(alert.totalCents)}
                {" · "}Reçu enregistré : {money(alert.receivedCents)}
                {" · "}
                <strong>
                  Reste à justifier : {money(alert.remainingCents)}
                </strong>
              </span>
              {alert.stays.length > 1 && (
                <small>
                  Solde de l’ensemble du séjour partagé entre les gîtes.
                </small>
              )}
            </div>
            {!archived && canCurrentUserAccessPage("reservations") && (
              <Link
                className="rp-text-button"
                to={reservationPaymentsHref(
                  alert.reservationId,
                  alert.stays[0].arrival,
                )}
              >
                Voir les règlements
              </Link>
            )}
          </li>
        ))}
      </ul>
      {alerts.length > 5 && (
        <button
          type="button"
          className="rp-text-button"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Réduire la liste"
            : `Afficher les ${alerts.length} séjours`}
        </button>
      )}
      {reviewed ? (
        <div className="rp-notice rp-notice--primary">
          <strong>
            Situation vérifiée le{" "}
            {new Date(result.paymentReview!.reviewedAt).toLocaleDateString(
              "fr-FR",
              { timeZone: "Europe/Paris" },
            )}
          </strong>
          <p>{result.paymentReview!.note}</p>
          <p>
            Une modification de ces règlements demandera une nouvelle
            vérification.
          </p>
        </div>
      ) : !archived && workspace.canEdit ? (
        <form onSubmit={submit}>
          <label className="rp-field">
            Situation des règlements après vérification
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              minLength={3}
              maxLength={1000}
              required
              placeholder="Exemple : solde encore impayé, paiement attendu le…"
              disabled={workspace.saving || workspace.loading}
            />
          </label>
          <p className="rp-muted">
            Cette justification est nécessaire avant de marquer le rapport comme
            prêt.
          </p>
          {error && (
            <p className="rp-notice" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="rp-button"
            disabled={
              workspace.saving || workspace.loading || note.trim().length < 3
            }
          >
            Confirmer la vérification des règlements
          </button>
        </form>
      ) : null}
    </section>
  );
}
