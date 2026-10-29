import "./ReservationPaymentLinkDialog.css";
import { useEffect, useRef, useState } from "react";
import { apiFetch, isAbortError } from "../../utils/api";
import { formatDate, formatEuro } from "../../utils/format";
import { getPaymentLinkStaySummary, type PaymentLinkReservation } from "../../utils/reservationPaymentSharing";
import ReservationDetailsDrawer from "./ReservationDetailsDrawer";
import ReservationPaymentLinkShareActions from "./ReservationPaymentLinkShareActions";

type PaymentLink = {
  id: string;
  purpose: "deposit" | "balance";
  amount: number;
  status: string;
  expires_at: string;
  url: string;
};
type Choices = {
  enabled: boolean;
  mode: "test" | "live" | null;
  total: number;
  received: number;
  deposit_due: number;
  balance_due: number;
  source: string;
  platform: boolean;
  links: PaymentLink[];
};
export default function ReservationPaymentLinkDialog({
  reservation,
  onClose,
}: {
  reservation: PaymentLinkReservation;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [purpose, setPurpose] = useState<"deposit" | "balance">("balance");
  const [link, setLink] = useState<PaymentLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const path = `/reservations/${encodeURIComponent(reservation.id)}/payment-links`;
  useEffect(() => {
    const controller = new AbortController();
    setChoices(null);
    setLink(null);
    setError("");
    apiFetch<Choices>(path, { signal: controller.signal })
      .then((data) => {
        setChoices(data);
        setPurpose(data.deposit_due >= 0.5 ? "deposit" : "balance");
        setLink(data.links[0] ?? null);
      })
      .catch((error) => {
        if (!isAbortError(error)) setError(error.message);
      });
    return () => controller.abort();
  }, [path]);
  const generate = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setLink(
        await apiFetch<PaymentLink>(path, {
          method: "POST",
          json: { purpose },
        }),
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Création du lien impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!link) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(path + `/${link.id}/revoke`, { method: "POST" });
      setLink(null);
      setChoices(await apiFetch<Choices>(path));
      setNotice("Le lien a été annulé. Il ne permet plus de payer.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Annulation impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setNotice("Lien copié. Vous pouvez le coller dans un SMS ou un message.");
    } catch {
      field.current?.focus();
      field.current?.select();
      setNotice("Le lien est sélectionné : copiez-le pour le partager.");
    }
  };
  const amount =
    purpose === "deposit" ? choices?.deposit_due : choices?.balance_due;
  const local =
    link && ["localhost", "127.0.0.1"].includes(new URL(link.url).hostname);
  const staySummary = getPaymentLinkStaySummary(reservation);
  return (
    <ReservationDetailsDrawer
      className="reservation-payment-link"
      open
      title="Lien de paiement Stripe"
      eyebrow="Règlement de réservation"
      summary={[
        reservation.hote_nom,
        `${formatDate(reservation.date_entree)} → ${formatDate(reservation.date_sortie)}`,
      ]}
      onClose={onClose}
      busy={busy}
    >
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {!choices && !error ? <p>Chargement des montants…</p> : null}
      {choices ? (
        <>
          {choices.mode === "test" ? (
            <p className="note">Mode test : aucun paiement réel.</p>
          ) : null}
          <div className="grid-2">
            <div className="field">
              <span>
                {choices.source === "contract"
                  ? "Total du contrat"
                  : "Total du séjour"}
              </span>
              <strong>{formatEuro(choices.total)}</strong>
            </div>
            <div className="field">
              <span>Déjà reçu</span>
              <strong>{formatEuro(choices.received)}</strong>
            </div>
          </div>
          <section className="reservation-payment-link__stay" aria-label="Détail du séjour">
            <div className="reservation-payment-link__stay-heading">
              <h3>Détail du séjour</h3>
              <strong>{staySummary.nights}</strong>
            </div>
            {staySummary.optionLabels.length ? <ul aria-label="Options choisies">
              {staySummary.optionLabels.map((label) => <li key={label}>{label}</li>)}
            </ul> : <p>Aucune option sélectionnée.</p>}
          </section>
          {choices.platform ? (
            <p className="note">
              Cette réservation provient d’une plateforme. Vérifiez que le
              montant demandé n’a pas déjà été encaissé par celle-ci.
            </p>
          ) : null}
          {!choices.enabled ? (
            <p>
              Le paiement Stripe n’est pas encore disponible pour ce compte.
            </p>
          ) : link ? (
            <>
              <h3>
                {link.purpose === "deposit"
                  ? "Arrhes à régler"
                  : "Montant restant à régler"}{" "}
                : {formatEuro(link.amount)}
              </h3>
              <label className="field">
                Lien à partager
                <input
                  ref={field}
                  readOnly
                  value={link.url}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              {link.status === "revoking" ? (
                <p className="note">
                  L’annulation est en cours. Réessayez « Annuler ce lien » pour
                  la terminer.
                </p>
              ) : null}
              <p className="field-hint">
                Valable jusqu’au {formatDate(link.expires_at)}. Le paiement sera
                enregistré automatiquement sur cette réservation.
              </p>
              {local ? (
                <p className="note">
                  Ce lien de test est accessible sur cet ordinateur. Les liens
                  seront utilisables par vos clients lorsque le paiement sera
                  activé sur le site en ligne.
                </p>
              ) : null}
              {link.status === "active" && !busy ? <>
                <ReservationPaymentLinkShareActions reservation={reservation} link={link} />
                <p className="field-hint">Le message est prérempli dans votre application. Vous pouvez le modifier avant de l’envoyer.</p>
              </> : null}
              <div className="actions">
                <button
                  type="button"
                  onClick={() => void copy()}
                  disabled={busy}
                >
                  Copier le lien
                </button>
                <a
                  className="button-secondary"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ouvrir le lien
                </a>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void revoke()}
                >
                  Annuler ce lien
                </button>
              </div>
            </>
          ) : choices.balance_due < 0.5 ? (
            <p>Cette réservation est déjà réglée.</p>
          ) : (
            <>
              <fieldset
                disabled={busy}
                style={{ border: 0, padding: 0, margin: "24px 0" }}
              >
                <legend>Quel montant souhaitez-vous demander ?</legend>
                {choices.deposit_due >= 0.5 ? (
                  <label className="field" style={{ marginTop: 16 }}>
                    <span>
                      <input
                        type="radio"
                        name="payment-link-purpose"
                        checked={purpose === "deposit"}
                        onChange={() => setPurpose("deposit")}
                      />{" "}
                      Arrhes restant à régler —{" "}
                      {formatEuro(choices.deposit_due)}
                    </span>
                  </label>
                ) : null}
                <label className="field" style={{ marginTop: 16 }}>
                  <span>
                    <input
                      type="radio"
                      name="payment-link-purpose"
                      checked={purpose === "balance"}
                      onChange={() => setPurpose("balance")}
                    />{" "}
                    {choices.received > 0
                      ? "Solde du séjour"
                      : "Totalité du séjour"}{" "}
                    — {formatEuro(choices.balance_due)}
                  </span>
                </label>
              </fieldset>
              <button
                type="button"
                disabled={busy || !amount || amount < 0.5}
                onClick={() => void generate()}
              >
                {busy
                  ? "Création…"
                  : `Créer le lien de ${formatEuro(amount || 0)}`}
              </button>
            </>
          )}
        </>
      ) : null}
      {notice ? (
        <p role="status" className="note">
          {notice}
        </p>
      ) : null}
    </ReservationDetailsDrawer>
  );
}
