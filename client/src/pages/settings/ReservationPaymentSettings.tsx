import { useEffect, useState } from "react";
import type { ReservationPaymentSettings as Settings } from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { canCurrentUserWritePage } from "../../utils/auth";

export default function ReservationPaymentSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Settings>("/settings/reservation-payments", {
      signal: controller.signal,
    })
      .then(setSettings)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Chargement impossible.",
          );
      });
    return () => controller.abort();
  }, []);
  return (
    <section
      className="settings-cluster reservation-payment-settings"
      aria-labelledby="nav-settings-payments"
    >
      <div className="settings-cluster__header">
        <div>
          <div className="settings-cluster__eyebrow">Réservations</div>
          <h2 className="settings-cluster__title">
            Règlements des réservations
          </h2>
        </div>
        <p className="settings-cluster__text">
          Choisissez le montant proposé au premier règlement et le suivi des
          paiements des plateformes.
        </p>
      </div>
      <div className="card settings-card">
        {error ? (
          <p className="note" role="alert">
            {error}
          </p>
        ) : null}
        {!settings ? (
          <p>Chargement…</p>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                setSettings(
                  await apiFetch<Settings>("/settings/reservation-payments", {
                    method: "PUT",
                    json: settings,
                  }),
                );
                setNotice(
                  "Réglage enregistré. Il s’applique aux réservations existantes et aux prochaines réservations.",
                );
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Enregistrement impossible.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Montant proposé au premier règlement
              <select
                value={settings.first_payment_default ?? "full"}
                disabled={busy || !canCurrentUserWritePage("settings")}
                onChange={(event) => {
                  setSettings({
                    ...settings,
                    first_payment_default: event.target
                      .value as Settings["first_payment_default"],
                  });
                  setNotice("");
                }}
              >
                <option value="full">Totalité du séjour (par défaut)</option>
                <option value="deposit">Arrhes</option>
              </select>
            </label>
            <p className="field-hint">
              Le montant et la nature restent modifiables avant
              l’enregistrement. Après un premier versement, le solde restant est
              proposé.
            </p>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={settings.platform_payments_received_automatically}
                disabled={busy || !canCurrentUserWritePage("settings")}
                onChange={(event) => {
                  setSettings({
                    ...settings,
                    platform_payments_received_automatically:
                      event.target.checked,
                  });
                  setNotice("");
                }}
              />
              <span>
                Considérer automatiquement l’argent des plateformes comme reçu
              </span>
            </label>
            <p className="field-hint">
              Activé par défaut. Seul l’hébergement est considéré reçu. Les
              draps, les options ajoutées dans l’application et la taxe
              collectée sur place restent à encaisser.
            </p>
            <p className="field-hint">
              Si vous désactivez ce réglage, enregistrez les versements reçus
              avec le moyen « Versement plateforme ». Les règlements déjà saisis
              sont conservés. HomeExchange n’est pas concerné.
            </p>
            {canCurrentUserWritePage("settings") ? (
              <div className="actions">
                <button disabled={busy} type="submit">
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            ) : null}
            {notice ? (
              <p className="note note--success" role="status">
                {notice}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </section>
  );
}
