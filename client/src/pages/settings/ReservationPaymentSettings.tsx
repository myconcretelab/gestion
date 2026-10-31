import { useEffect, useState } from "react";
import {
  DEFAULT_RESERVATION_PAYMENT_SHORTCUTS,
  RESERVATION_PAYMENT_METHODS,
  type ReservationPaymentSettings as Settings,
  type ReservationPaymentShortcut,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { canCurrentUserWritePage } from "../../utils/auth";
import { getContrastTextColor } from "../../utils/paymentColors";
import OtaChannelSettings from "./OtaChannelSettings";

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
  const shortcuts =
    settings?.shortcuts ?? DEFAULT_RESERVATION_PAYMENT_SHORTCUTS;
  const setShortcuts = (items: ReservationPaymentShortcut[]) => {
    if (!settings) return;
    setSettings({ ...settings, shortcuts: items });
    setNotice("");
  };
  const updateShortcut = (
    id: string,
    patch: Partial<ReservationPaymentShortcut>,
  ) =>
    setShortcuts(
      shortcuts.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const moveShortcut = (index: number, direction: number) => {
    const items = [...shortcuts];
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    setShortcuts(items);
  };
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
              Pour les réservations existantes et futures, les versements OTA
              sans date sont datés au lendemain de l’arrivée et inclus dans les
              rapports avec la mention « Date estimée ». Une date saisie ou
              importée prend la priorité.
            </p>
            <p className="field-hint">Le réglage propre à chaque canal ci-dessous est prioritaire sur ce réglage général.</p>
            <p className="field-hint">
              Si vous désactivez ce réglage, enregistrez les versements reçus
              avec le moyen « Versement plateforme ». Les règlements déjà saisis
              sont conservés. HomeExchange n’est pas concerné.
            </p>
            <OtaChannelSettings value={settings.platforms} automatic={settings.platform_payments_received_automatically} disabled={busy || !canCurrentUserWritePage("settings")} onChange={platforms => { setSettings({ ...settings, platforms }); setNotice(""); }} />
            <fieldset
              className="reservation-shortcut-settings"
              disabled={busy || !canCurrentUserWritePage("settings")}
            >
              <legend>Raccourcis de règlement</legend>
              <p className="field-hint">
                Ces boutons enregistrent un règlement en un clic, à la date du
                jour. Ils apparaissent à côté de « Ajouter un règlement », avec
                le montant à encaisser. Les arrhes déjà reçues par contrat, en
                ligne ou saisies manuellement sont déduites.
              </p>
              <div className="reservation-shortcut-settings__list">
                {shortcuts.map((shortcut, index) => (
                  <div
                    key={shortcut.id}
                    className="reservation-shortcut-settings__item"
                  >
                    <label className="field">
                      Libellé court
                      <input
                        aria-label={`Libellé du raccourci ${index + 1}`}
                        required
                        maxLength={12}
                        value={shortcut.label}
                        onChange={(event) =>
                          updateShortcut(shortcut.id, {
                            label: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Montant à encaisser
                      <select
                        aria-label={`Montant du raccourci ${index + 1}`}
                        value={shortcut.target}
                        onChange={(event) =>
                          updateShortcut(shortcut.id, {
                            target: event.target
                              .value as ReservationPaymentShortcut["target"],
                          })
                        }
                      >
                        <option value="remaining">Tout le reste à payer</option>
                        <option value="deposit">Arrhes restantes</option>
                      </select>
                    </label>
                    <label className="field">
                      Moyen de paiement
                      <select
                        aria-label={`Moyen du raccourci ${index + 1}`}
                        value={shortcut.method}
                        onChange={(event) =>
                          updateShortcut(shortcut.id, {
                            method: event.target
                              .value as ReservationPaymentShortcut["method"],
                          })
                        }
                      >
                        {RESERVATION_PAYMENT_METHODS.map((method) => (
                          <option key={method}>{method}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field reservation-shortcut-settings__color">
                      Couleur
                      <input
                        aria-label={`Couleur du raccourci ${index + 1}`}
                        type="color"
                        value={shortcut.color}
                        onChange={(event) =>
                          updateShortcut(shortcut.id, {
                            color: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="reservation-shortcut-settings__tools">
                      <span
                        className="reservation-shortcut-settings__preview"
                        style={{
                          backgroundColor: shortcut.color,
                          color: getContrastTextColor(shortcut.color),
                        }}
                      >
                        {shortcut.label || "Aperçu"}
                      </span>
                      <div className="reservation-shortcut-settings__order">
                        <button
                          type="button"
                          className="secondary"
                          disabled={index === 0}
                          aria-label={`Avancer le raccourci ${index + 1}`}
                          onClick={() => moveShortcut(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={index === shortcuts.length - 1}
                          aria-label={`Reculer le raccourci ${index + 1}`}
                          onClick={() => moveShortcut(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Supprimer le raccourci ${index + 1}`}
                          onClick={() =>
                            setShortcuts(
                              shortcuts.filter(
                                (item) => item.id !== shortcut.id,
                              ),
                            )
                          }
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {!shortcuts.length ? (
                <p className="field-hint">
                  Aucun raccourci. La saisie détaillée reste disponible.
                </p>
              ) : null}
              <button
                type="button"
                className="secondary"
                disabled={shortcuts.length >= 20}
                onClick={() =>
                  setShortcuts([
                    ...shortcuts,
                    {
                      id: crypto.randomUUID(),
                      label: "Nouveau",
                      target: "remaining",
                      method: "Virement",
                      color: "#2563EB",
                    },
                  ])
                }
              >
                ＋ Ajouter un raccourci
              </button>
              <p className="field-hint">
                Pour des arrhes reçues hors contrat, utilisez un raccourci «
                Arrhes restantes » ou la saisie détaillée avec la nature «
                Arrhes » pour choisir un autre montant ou une autre date.
              </p>
            </fieldset>
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
