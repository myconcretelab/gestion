import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, isAbortError } from "../../utils/api";
import { normalizeReceiptAmount } from "../../utils/electronicPayments";

type View = {
  available: boolean;
  reason: string;
  needs_reporting: boolean;
  revision: number;
  rates: Array<{ vat_rate: string; total: string }>;
  payments: Array<{
    id: string;
    reference: string;
    payment_date: string;
    amount: string;
    allocations: Array<{ vat_rate: string; amount: string }>;
    status: string;
    post_started_at: string | null;
    remote_event_id: string | null;
    last_error_code: string | null;
  }>;
};
const labels: Record<string, string> = {
  recorded: "Enregistré localement — non envoyé",
  queued: "Envoi demandé",
  sending: "Envoi en cours — ne pas renvoyer",
  submitted: "Création du message 212 confirmée — suivre les événements",
  send_unknown: "Résultat inconnu — renvoi bloqué",
  paused_after_restore: "Suspendu après restauration",
};
export default function ElectronicPaymentsPanel({
  invoiceId,
}: {
  invoiceId: string;
}) {
  const endpoint = `/invoices/${encodeURIComponent(invoiceId)}/electronic/payments`;
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const reload = async () => setData(await apiFetch<View>(endpoint));
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<View>(endpoint, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!isAbortError(e)) setError(e.message);
      });
    return () => controller.abort();
  }, [endpoint]);
  const pending = data?.payments.some((p) =>
    ["queued", "sending"].includes(p.status),
  );
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let count = 0;
    const timer = window.setInterval(() => {
      if (++count > 20) {
        window.clearInterval(timer);
        return;
      }
      apiFetch<View>(endpoint, { signal: controller.signal })
        .then(setData)
        .catch((e) => {
          if (!isAbortError(e)) setError(e.message);
        });
    }, 3000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [endpoint, pending]);
  const record = async (event: FormEvent) => {
    event.preventDefault();
    if (!data) return;
    if (
      !window.confirm(
        "Enregistrer cet encaissement de TEST ? Vérifiez sa référence unique, sa date réelle et les montants TTC par taux. L’enregistrement est conservé sans modification ni suppression dans ce lot. Aucun message 212 n’est envoyé à cette étape.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      setData(
        await apiFetch<View>(endpoint, {
          method: "POST",
          json: {
            revision: data.revision,
            reference,
            payment_date: date,
            allocations: Object.entries(amounts)
              .filter(
                ([, amount]) => amount.trim() !== "" && Number(amount) !== 0,
              )
              .map(([vat_rate, amount]) => ({
                vat_rate,
                amount: normalizeReceiptAmount(amount),
              })),
            confirm_received: confirmed,
            confirm_test_data: confirmed,
          },
        }),
      );
      setReference("");
      setDate("");
      setAmounts({});
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement non confirmé.");
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const send = async (id: string) => {
    const payment = data?.payments.find((p) => p.id === id);
    if (!payment) return;
    if (
      !window.confirm(
        `Envoyer ${payment.reference} — ${payment.amount} € TTC du ${payment.payment_date} à SuperPDP de TEST (statut 212) ? Aucun renvoi ne sera possible si le résultat est inconnu.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      setData(
        await apiFetch<View>(`${endpoint}/${encodeURIComponent(id)}/send`, {
          method: "POST",
          json: { confirm_send: true, confirm_test_data: true },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Envoi non confirmé.");
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Encaissements B2C de test"
      className="electronic-payments-panel"
    >
      <h4>Encaissements B2C — test uniquement</h4>
      <p>
        Ce journal est indépendant du bouton « réglée ». Aucun montant ni date
        n’est déduit des arrhes, de l’émission ou du séjour. Il ne modifie ni
        les comptes ni le PDF. Ne ressaisissez pas un encaissement déjà déclaré
        ailleurs.
      </p>
      <p className="note">
        Les corrections, annulations et remboursements ne sont pas encore pris
        en charge. Vérifiez soigneusement avant d’enregistrer. Un reçu de
        création n’est pas une preuve de déclaration fiscale acceptée.
      </p>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Chargement des encaissements…</p>}
      {data && (
        <>
          <p>{data.reason}</p>
          {data.available && (
            <form onSubmit={record}>
              <fieldset
                disabled={busy}
                style={{ border: 0, margin: 0, padding: 0 }}
              >
                <legend>Nouvel encaissement vérifié</legend>
                <div className="grid-2">
                  <label className="field">
                    Référence unique du mouvement
                    <input
                      required
                      maxLength={120}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Référence bancaire ou de caisse fictive"
                    />
                  </label>
                  <label className="field">
                    Date réelle d’encaissement
                    <input
                      required
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  {data.rates.map((rate) => (
                    <label className="field" key={rate.vat_rate}>
                      Montant TTC encaissé à {rate.vat_rate} % (facture :{" "}
                      {rate.total} €)
                      <input
                        type="number"
                        min="0.01"
                        max={rate.total}
                        step="0.01"
                        value={amounts[rate.vat_rate] ?? ""}
                        onChange={(e) =>
                          setAmounts({
                            ...amounts,
                            [rate.vat_rate]: e.target.value,
                          })
                        }
                        placeholder="0.00"
                      />
                    </label>
                  ))}
                </div>
                <label className="field">
                  <span>
                    <input
                      required
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />{" "}
                    Je confirme la réception effective, la date, la ventilation
                    TTC et l’utilisation exclusive de données fictives.
                  </span>
                </label>
                <button
                  disabled={
                    !confirmed ||
                    !Object.values(amounts).some((a) => Number(a) > 0)
                  }
                >
                  Enregistrer localement — sans envoi
                </button>
              </fieldset>
            </form>
          )}
          <ul className="electronic-payments-list">
            {data.payments.map((payment) => (
              <li key={payment.id}>
                <p>
                  <strong>{payment.reference}</strong> — {payment.payment_date}{" "}
                  — {payment.amount} € TTC
                </p>
                <p>
                  {labels[payment.status] ?? payment.status}
                  {payment.remote_event_id
                    ? ` · Reçu ${payment.remote_event_id}`
                    : ""}
                </p>
                {payment.last_error_code && (
                  <p className="note">{payment.last_error_code}</p>
                )}
                <p>
                  {payment.allocations
                    .map((a) => `${a.amount} € TTC à ${a.vat_rate} %`)
                    .join(" · ")}
                </p>
                {payment.status === "send_unknown" && (
                  <p className="note">
                    Le message a pu être accepté. Vérifiez le journal SuperPDP
                    et contactez le support avant toute correction ; ne recréez
                    pas ce mouvement sous une autre référence.
                  </p>
                )}
                {data.available &&
                  data.needs_reporting &&
                  payment.status === "recorded" &&
                  !payment.post_started_at && (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        data.payments.some((p) =>
                          ["sending", "send_unknown"].includes(p.status),
                        )
                      }
                      onClick={() => void send(payment.id)}
                    >
                      Envoyer ce seul encaissement à SuperPDP de test
                    </button>
                  )}
              </li>
            ))}
          </ul>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setError("");
              void reload().catch((e) => setError(e.message));
            }}
          >
            Actualiser le journal local d’encaissements
          </button>
        </>
      )}
    </section>
  );
}
