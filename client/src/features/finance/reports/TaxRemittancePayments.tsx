import { useState } from "react";
import { taxRemittanceTotals, type TaxRemittance } from "@contrats/shared";
import { buildApiUrl } from "../../../utils/api";
import type { ReportWorkspace } from "./ReportsPage";
import { ReportDialog } from "./ReportUi";
import { parseRemittanceMoney, remittanceMoney } from "./TaxRemittanceForm";

export default function TaxRemittancePayments({
  remittance,
  workspace,
}: {
  remittance: TaxRemittance;
  workspace: ReportWorkspace;
}) {
  const [adding, setAdding] = useState(false);
  const [paymentId, setPaymentId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [voidId, setVoidId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const busy = workspace.saving || workspace.loading || uploading;
  const canEdit = workspace.canEdit && !remittance.cancelledAt;
  return (
    <div className="rp-remittance-payments">
      <h3>Paiements à la collectivité</h3>
      {error && (
        <p role="alert" className="rp-notice">
          {error}
        </p>
      )}
      {!remittance.payments.length && <p>Aucun paiement enregistré.</p>}
      {remittance.payments.map((payment) => (
        <article
          key={payment.id}
          className="rp-remittance-payment"
          aria-label={`Paiement du ${payment.paidOn}`}
        >
          <p>
            <strong>{remittanceMoney(payment.amountCents)}</strong> ·{" "}
            {payment.paidOn.split("-").reverse().join("/")}
            {payment.voidedAt && " · Annulé"}
          </p>
          {payment.reference && <p>Référence : {payment.reference}</p>}
          {payment.note && <p>{payment.note}</p>}
          {payment.voidReason && (
            <p>Motif de l’annulation : {payment.voidReason}</p>
          )}
          {payment.receipts?.map((receipt) => (
            <p key={receipt.id}>
              <a
                href={buildApiUrl(
                  `/reports/remittances/${encodeURIComponent(remittance.id)}/payments/${encodeURIComponent(payment.id)}/receipts/${encodeURIComponent(receipt.id)}`,
                )}
                download
              >
                {receipt.name}
              </a>
            </p>
          ))}
          {canEdit && !payment.voidedAt && (
            <>
              <label className="rp-field">
                Ajouter un justificatif à ce paiement
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={busy}
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    setError("");
                    if (file.size > 5_000_000) {
                      setError("Le justificatif doit faire 5 Mo maximum.");
                      return;
                    }
                    setUploading(true);
                    try {
                      const data = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onerror = () =>
                            reject(new Error("Lecture du fichier impossible."));
                          reader.onload = () =>
                            resolve(String(reader.result).split(",")[1]);
                          reader.readAsDataURL(file);
                        },
                      );
                      if (
                        await workspace.mutate({
                          type: "remittance-receipt",
                          remittanceId: remittance.id,
                          paymentId: payment.id,
                          file: { name: file.name, data },
                        })
                      )
                        workspace.notify("Justificatif conservé.");
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "Ajout impossible.",
                      );
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
              <small className="rp-field-help">
                PDF, PNG ou JPEG · 5 Mo maximum.
              </small>
              <button
                className="rp-text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setVoidId(payment.id);
                  setReason("");
                }}
              >
                Annuler ce paiement saisi par erreur
              </button>
            </>
          )}
        </article>
      ))}
      {canEdit && (
        <button
          type="button"
          className="rp-button rp-button--secondary"
          disabled={busy}
          onClick={() => {
            setPaymentId(crypto.randomUUID());
            setAmount(
              (
                Math.max(0, taxRemittanceTotals(remittance).balanceCents) / 100
              ).toFixed(2),
            );
            setDate("");
            setReference("");
            setNote("");
            setAdding(true);
          }}
        >
          Enregistrer un paiement à la collectivité
        </button>
      )}
      {adding && (
        <ReportDialog
          title="Enregistrer un paiement à la collectivité"
          onClose={() => setAdding(false)}
        >
          {workspace.error && (
            <p role="alert" className="rp-notice">
              {workspace.error}
            </p>
          )}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const cents = parseRemittanceMoney(amount);
              if (!Number.isSafeInteger(cents) || cents <= 0) return;
              if (
                await workspace.mutate({
                  type: "remittance-payment",
                  remittanceId: remittance.id,
                  payment: {
                    id: paymentId,
                    amountCents: cents,
                    paidOn: date,
                    reference,
                    note,
                  },
                })
              ) {
                setAdding(false);
                workspace.notify("Paiement enregistré.");
              }
            }}
          >
            <p>
              Enregistrez ici un règlement déjà effectué sur le portail ou par
              un autre moyen.
            </p>
            <label className="rp-field">
              Montant versé (€)
              <input
                autoFocus
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="rp-field">
              Date réelle du paiement
              <input
                required
                type="date"
                min="2000-01-01"
                max="2099-12-31"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="rp-field">
              Référence du paiement
              <input
                value={reference}
                maxLength={200}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label className="rp-field">
              Note (facultative)
              <textarea
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="rp-dialog__actions">
              <button
                className="rp-button"
                disabled={
                  busy ||
                  !date ||
                  !(parseRemittanceMoney(amount) > 0) ||
                  parseRemittanceMoney(amount) > 1_000_000_000
                }
              >
                Enregistrer le paiement
              </button>
            </div>
          </form>
        </ReportDialog>
      )}
      {voidId && (
        <ReportDialog
          title="Annuler un paiement saisi par erreur"
          onClose={() => setVoidId(null)}
        >
          <p>
            Cette correction conserve la trace du paiement et ses justificatifs.
            Elle n’annule aucun paiement bancaire.
          </p>
          {workspace.error && (
            <p role="alert" className="rp-notice">
              {workspace.error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await workspace.mutate({
                  type: "remittance-void-payment",
                  remittanceId: remittance.id,
                  paymentId: voidId,
                  reason,
                })
              )
                setVoidId(null);
            }}
          >
            <label className="rp-field">
              Motif de l’annulation
              <textarea
                autoFocus
                required
                minLength={3}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="rp-dialog__actions">
              <button
                className="rp-button"
                disabled={busy || reason.trim().length < 3}
              >
                Confirmer l’annulation du paiement
              </button>
            </div>
          </form>
        </ReportDialog>
      )}
    </div>
  );
}
