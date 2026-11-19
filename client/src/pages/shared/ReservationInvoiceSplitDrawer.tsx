import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../../utils/api";
import { canCurrentUserWritePage } from "../../utils/auth";
import { formatDate, formatEuro } from "../../utils/format";
import type { Reservation } from "../../utils/types";
import ReservationDetailsDrawer from "./ReservationDetailsDrawer";
import "./ReservationInvoiceSplitDrawer.css";

type SplitSummary = {
  totalCents: number;
  remainingCents: number;
  remainingTaxCents: number;
  canComplete: boolean;
  blockedReason: string | null;
  invoices: Array<{
    id: string;
    number: string | null;
    name: string;
    lifecycle: "draft" | "issued" | "legacy";
    paid: boolean;
    credited: boolean;
    cents: number;
  }>;
};
type Recipient = { name: string; email: string; amount: string; tax: string };

const moneyInput = (cents: number) => (cents / 100).toFixed(2);
const parseCents = (value: string) =>
  /^\d+(?:[.,]\d{1,2})?$/.test(value.trim())
    ? Math.round(Number(value.replace(",", ".")) * 100)
    : NaN;
const equalShare = (cents: number, count: number, index: number) =>
  Math.floor(cents / count) + (index < cents % count ? 1 : 0);

export default function ReservationInvoiceSplitDrawer({
  reservation,
  onClose,
}: {
  reservation: Reservation;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<SplitSummary | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const endpoint = `/invoices/reservation/${encodeURIComponent(reservation.id)}/split`;
  const allowWrite = canCurrentUserWritePage("invoices");

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<SplitSummary>(endpoint, { signal: controller.signal })
      .then((data) => {
        setSummary(data);
        if (data.blockedReason || !data.remainingCents) return;
        const count = Math.min(
          50,
          data.remainingCents,
          data.canComplete ? 1 : Math.max(2, reservation.nb_adultes),
        );
        setRecipients(
          Array.from({ length: count }, (_, index) => ({
            name: index === 0 ? reservation.hote_nom : "",
            email: index === 0 ? (reservation.email ?? "") : "",
            amount: moneyInput(equalShare(data.remainingCents, count, index)),
            tax: moneyInput(equalShare(data.remainingTaxCents, count, index)),
          })),
        );
      })
      .catch((err) => {
        if (!isAbortError(err))
          setError(
            err instanceof Error
              ? err.message
              : "Impossible de charger la facturation.",
          );
      });
    return () => controller.abort();
  }, [
    endpoint,
    reservation.email,
    reservation.hote_nom,
    reservation.nb_adultes,
  ]);

  const splitAmounts = (count: number) => {
    if (!summary) return;
    setRecipients((previous) =>
      Array.from({ length: count }, (_, index) => ({
        name: previous[index]?.name ?? "",
        email: previous[index]?.email ?? "",
        amount: moneyInput(equalShare(summary.remainingCents, count, index)),
        tax: moneyInput(equalShare(summary.remainingTaxCents, count, index)),
      })),
    );
  };
  const changeRecipient = (
    index: number,
    field: keyof Recipient,
    value: string,
  ) => {
    setRecipients((previous) =>
      previous.map((recipient, row) =>
        row === index ? { ...recipient, [field]: value } : recipient,
      ),
    );
  };

  const parts = recipients.map((recipient) => ({
    name: recipient.name.trim(),
    email: recipient.email.trim(),
    cents: parseCents(recipient.amount),
    taxCents: parseCents(recipient.tax),
  }));
  const total = parts.reduce((sum, part) => sum + part.cents, 0);
  const taxTotal = parts.reduce((sum, part) => sum + part.taxCents, 0);
  const difference = (summary?.remainingCents ?? 0) - total;
  const countMin = summary?.canComplete ? 1 : 2;
  const countMax = Math.min(50, summary?.remainingCents ?? 0);
  const ready = Boolean(
    summary &&
    !summary.blockedReason &&
    recipients.length >= countMin &&
    difference === 0 &&
    taxTotal === summary.remainingTaxCents &&
    parts.every(
      (part) =>
        part.name &&
        part.cents > 0 &&
        part.taxCents >= 0 &&
        part.taxCents <= part.cents,
    ),
  );
  const formId = "reservation-invoice-split";
  const canAllocate = Boolean(
    summary && allowWrite && !summary.blockedReason && countMax >= countMin,
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !summary || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const body = { totalCents: summary.totalCents, recipients: parts };
    const payload = JSON.stringify(body);
    try {
      if (request.current?.payload !== payload)
        request.current = { payload, id: crypto.randomUUID() };
      const result = await apiFetch<SplitSummary>(endpoint, {
        method: "POST",
        json: { ...body, requestId: request.current.id },
      });
      setSummary(result);
      setRecipients([]);
      setNotice(
        parts.length > 1
          ? `${parts.length} brouillons créés.`
          : "Brouillon créé.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de créer les brouillons.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <ReservationDetailsDrawer
      open
      title="Répartir la facturation"
      busy={busy}
      onClose={onClose}
      summary={[
        reservation.hote_nom,
        [
          reservation.gite?.nom,
          `${formatDate(reservation.date_entree)} – ${formatDate(reservation.date_sortie)}`,
        ]
          .filter(Boolean)
          .join(" · "),
      ]}
      footer={
        canAllocate ? (
          <button type="submit" form={formId} disabled={busy || !ready}>
            {busy
              ? "Création en cours…"
              : recipients.length === 1
                ? "Créer le brouillon"
                : `Créer les ${recipients.length} brouillons`}
          </button>
        ) : (
          <button type="button" className="secondary" onClick={onClose}>
            Fermer
          </button>
        )
      }
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!summary && !error && <p role="status">Chargement des factures…</p>}
      {notice && (
        <p className="note note--success" role="status">
          {notice}
        </p>
      )}
      {summary && (
        <div className="reservation-invoice-split">
          <dl className="reservation-invoice-split__totals">
            <div>
              <dt>Total du séjour</dt>
              <dd>{formatEuro(summary.totalCents / 100)}</dd>
            </div>
            {!summary.blockedReason && (
              <div>
                <dt>Reste à facturer</dt>
                <dd>{formatEuro(summary.remainingCents / 100)}</dd>
              </div>
            )}
          </dl>
          {summary.blockedReason && (
            <p className="note">{summary.blockedReason}</p>
          )}
          {!summary.blockedReason &&
            summary.remainingCents > 0 &&
            countMax < countMin && (
              <p className="note">
                Le montant restant est trop faible pour créer plusieurs parts.
              </p>
            )}
          {summary.invoices.length > 0 && (
            <section aria-label="Factures du séjour">
              <h3>Factures du séjour</h3>
              <ul className="reservation-invoice-split__invoices">
                {summary.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link to={`/factures/${invoice.id}`}>
                      <strong>{invoice.name}</strong>
                      <small>
                        {invoice.number ? `${invoice.number} · ` : ""}
                        {invoice.lifecycle === "draft" ? "Brouillon · " : ""}
                        {invoice.credited
                          ? "Annulée par avoir"
                          : invoice.paid
                            ? "Réglée"
                            : "Non réglée"}
                      </small>
                    </Link>
                    <strong>{formatEuro(invoice.cents / 100)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {canAllocate && recipients.length > 0 && (
            <form id={formId} onSubmit={submit}>
              <div className="reservation-invoice-split__controls">
                <div aria-label="Nombre de destinataires" className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || recipients.length <= countMin}
                    onClick={() => splitAmounts(recipients.length - 1)}
                  >
                    Retirer une part
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || recipients.length >= countMax}
                    onClick={() => splitAmounts(recipients.length + 1)}
                  >
                    Ajouter une part
                  </button>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => splitAmounts(recipients.length)}
                >
                  Partager à parts égales
                </button>
              </div>
              {summary.remainingTaxCents > 0 && (
                <p className="field-hint">
                  Répartissez {formatEuro(summary.remainingTaxCents / 100)} de
                  taxe de séjour entre les personnes qui la doivent. Chaque
                  montant de facture inclut la taxe attribuée.
                </p>
              )}
              {recipients.map((recipient, index) => (
                <fieldset
                  key={index}
                  className="reservation-invoice-split__recipient"
                  disabled={busy}
                >
                  <legend>Destinataire {index + 1}</legend>
                  <label className="field">
                    Nom ou raison sociale
                    <input
                      required
                      maxLength={250}
                      value={recipient.name}
                      onChange={(event) =>
                        changeRecipient(index, "name", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    Adresse e-mail (facultative)
                    <input
                      type="email"
                      maxLength={254}
                      value={recipient.email}
                      onChange={(event) =>
                        changeRecipient(index, "email", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    Montant de la facture (€)
                    <input
                      required
                      inputMode="decimal"
                      value={recipient.amount}
                      onChange={(event) =>
                        changeRecipient(index, "amount", event.target.value)
                      }
                    />
                  </label>
                  {summary.remainingTaxCents > 0 && (
                    <label className="field">
                      Dont taxe de séjour (€)
                      <input
                        required
                        inputMode="decimal"
                        value={recipient.tax}
                        onChange={(event) =>
                          changeRecipient(index, "tax", event.target.value)
                        }
                      />
                    </label>
                  )}
                </fieldset>
              ))}
              <p className="field-hint" aria-live="polite">
                {!Number.isFinite(difference)
                  ? "Renseignez les montants avec deux décimales au maximum."
                  : difference > 0
                    ? `À répartir ${formatEuro(difference / 100)}`
                    : difference < 0
                      ? `Dépassement de ${formatEuro(-difference / 100)}`
                      : `Total réparti ${formatEuro(total / 100)}`}
                {summary.remainingTaxCents > 0 &&
                  taxTotal !== summary.remainingTaxCents &&
                  " · Vérifiez le total de la taxe de séjour."}
                {parts.some((part) => part.taxCents > part.cents) &&
                  " · Une part contient plus de taxe que son montant total."}
              </p>
            </form>
          )}
        </div>
      )}
    </ReservationDetailsDrawer>
  );
}
