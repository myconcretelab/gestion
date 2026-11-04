import { useRef, useState } from "react";
import {
  suggestPaymentTouristTax,
  type ReservationPaymentEntry,
  type ReservationPaymentTracking,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { formatEuro } from "../../utils/format";

export type PaymentTaxDraft = {
  checked: boolean;
  amount: string;
  sourceRevision: string;
};
export const paymentTaxDraft = (
  tracking: ReservationPaymentTracking,
  amount: number,
  purpose: string,
): PaymentTaxDraft | null => {
  const suggestion = suggestPaymentTouristTax(tracking, amount, purpose);
  return suggestion
    ? {
        checked: suggestion.checked,
        amount: (suggestion.amountCents / 100).toFixed(2),
        sourceRevision: suggestion.sourceRevision,
      }
    : null;
};
export function PaymentTaxFields({
  draft,
  onChange,
  maxCents,
  disabled,
  unassigned = false,
}: {
  draft: PaymentTaxDraft;
  onChange: (draft: PaymentTaxDraft) => void;
  maxCents: number;
  disabled: boolean;
  unassigned?: boolean;
}) {
  return (
    <div className="reservation-tax-fields">
      <label className="reservation-tax-fields__check">
        <input
          type="checkbox"
          checked={draft.checked}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, checked: event.target.checked })
          }
        />
        Ce règlement comprend de la taxe de séjour
      </label>
      {draft.checked && (
        <label>
          Dont taxe de séjour (€)
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={maxCents / 100}
            required
            value={draft.amount}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...draft, amount: event.target.value })
            }
          />
        </label>
      )}
      <small>
        Cette part est comprise dans le montant du règlement. Elle reprend sa
        date d’encaissement. Enregistrer confirme ces informations pour le
        registre des séjours.
      </small>
      {unassigned && (
        <small>
          Des paiements précédents n’ont pas de part de taxe identifiée.
          Vérifiez-les pour confirmer le montant encore à collecter.
        </small>
      )}
    </div>
  );
}

export default function ReservationPaymentTax({
  reservationId,
  entry,
  tracking,
  canEdit,
  disabled,
  onBusy,
  onUpdated,
}: {
  reservationId: string;
  entry: ReservationPaymentEntry;
  tracking: ReservationPaymentTracking;
  canEdit: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onUpdated: (tracking: ReservationPaymentTracking) => void;
}) {
  const [draft, setDraft] = useState<PaymentTaxDraft | null>(null);
  const [expected, setExpected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const quote = tracking.tourist_tax;
  const eligible =
    !entry.voided_at &&
    ["manual", "legacy"].includes(entry.origin) &&
    !entry.ota &&
    entry.method !== "Versement plateforme";
  const visible = Boolean(
    entry.tourist_tax ||
    entry.tourist_tax_stale ||
    (eligible && quote?.available && quote.expectedCents > 0),
  );
  if (!visible) return null;
  const save = async (remove = false) => {
    if (lock.current || disabled || !canEdit || !draft) return;
    lock.current = true;
    onBusy(true);
    setError("");
    try {
      const next = await apiFetch<ReservationPaymentTracking>(
        `/reservations/${reservationId}/payments/${encodeURIComponent(entry.id)}/tourist-tax`,
        {
          method: "PATCH",
          json: {
            tourist_tax: remove
              ? null
              : {
                  amount_cents: Math.round(
                    Number(draft.amount.replace(",", ".")) * 100,
                  ),
                  source_revision: draft.sourceRevision,
                },
            expected_revision: expected,
          },
        },
      );
      onUpdated(next);
      setDraft(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "La part de taxe n’a pas pu être enregistrée.",
      );
    } finally {
      lock.current = false;
      onBusy(false);
    }
  };
  return (
    <div className="reservation-payment-tax">
      {entry.tourist_tax && (
        <small>
          Dont taxe de séjour :{" "}
          <strong>{formatEuro(entry.tourist_tax.amountCents / 100)}</strong>
        </small>
      )}
      {entry.tourist_tax_stale && (
        <small role="status">
          Part de taxe à vérifier : les données du séjour ont changé.
        </small>
      )}
      {canEdit && eligible && !draft && (
        <button
          type="button"
          className="reservation-ledger__payment-date"
          disabled={disabled}
          onClick={() => {
            setExpected(entry.tourist_tax_revision ?? null);
            setError("");
            setDraft({
              checked: true,
              amount: (
                (entry.tourist_tax?.amountCents ??
                  Math.min(
                    Math.round(entry.amount * 100),
                    quote?.remainingCents ?? 0,
                  )) / 100
              ).toFixed(2),
              sourceRevision: quote?.sourceRevision ?? "",
            });
          }}
        >
          {entry.tourist_tax || entry.tourist_tax_stale
            ? "Vérifier ou modifier la part de taxe"
            : "Renseigner la part de taxe"}
        </button>
      )}
      {draft && (
        <form
          className="reservation-ledger__form"
          aria-label="Part de taxe du règlement"
          onSubmit={(event) => {
            event.preventDefault();
            void save(!draft.checked);
          }}
        >
          {quote?.available ? (
            <PaymentTaxFields
              draft={draft}
              onChange={setDraft}
              maxCents={Math.min(
                Math.round(entry.amount * 100),
                Math.max(
                  0,
                  quote.expectedCents -
                    quote.allocatedCents +
                    (entry.tourist_tax?.amountCents ?? 0),
                ),
              )}
              disabled={disabled}
            />
          ) : (
            <p>
              {quote?.reason ??
                "Les données de taxe sont à renseigner dans la réservation."}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="reservation-ledger__form-actions">
            {quote?.available && (
              <button type="submit" disabled={disabled}>
                Confirmer la part de taxe
              </button>
            )}
            {(entry.tourist_tax || entry.tourist_tax_stale) && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void save(true)}
              >
                Retirer cette affectation
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDraft(null)}
            >
              Fermer
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
