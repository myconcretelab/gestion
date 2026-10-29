import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AppUser } from "../../utils/auth";
import { apiFetch } from "../../utils/api";
import {
  disableDeviceNotifications,
  enableDeviceNotifications,
  getLocalPushSubscription,
  pushEnvironment,
  type PushState,
} from "../../utils/pushNotifications";
import SettingsShell from "./SettingsShell";
import NotificationDeliveryStatus from "./NotificationDeliveryStatus";
import "./notificationSettings.css";

export default function NotificationSettings({
  currentUser,
}: {
  currentUser: AppUser | null;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const environment = pushEnvironment();
  const owner = Boolean(currentUser?.permissions.isOwner);
  const load = useCallback(async () => {
    const [data, local] = await Promise.all([
      apiFetch<PushState>("/notifications"),
      getLocalPushSubscription(),
    ]);
    setState(data);
    setEndpoint(local?.endpoint ?? null);
  }, []);
  useEffect(() => {
    if (!owner) return;
    void load().catch((reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible de charger les notifications.",
      ),
    );
  }, [load, owner]);
  const currentDevice = state?.devices.find(
    (device) => device.endpoint === endpoint,
  );
  const perform = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice(message);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "L’opération a échoué.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsShell>
      <section className="card" aria-labelledby="notifications-title">
        <h2 id="notifications-title">Notifications sur vos appareils</h2>
        <p>
          Recevez vos alertes sur votre téléphone ou votre ordinateur. Telegram
          reste disponible en secours, sans envoyer les mêmes alertes en double.
        </p>
        {!owner ? (
          <p>
            Connectez-vous avec un compte propriétaire pour activer les
            notifications.
          </p>
        ) : (
          <>
            <NotificationDeliveryStatus
              page="notifications"
              refreshKey={JSON.stringify(
                state?.devices.map((device) => device.id) ?? [],
              )}
            />
            <p className="field-hint">
              Les notifications reprennent les événements activés dans{" "}
              <Link to="/parametres/telegram">Telegram</Link> : demandes et
              confirmations de réservation, paiements, contrats et factures en
              retard, ménages et contrôles. Les{" "}
              <Link to="/parametres/taches">rappels de tâches</Link> vous sont
              également envoyés lorsque vous en êtes le destinataire.
            </p>
            {environment.needsHomeScreen ? (
              <div className="note">
                <strong>Sur iPhone ou iPad</strong>
                <p>
                  Ouvrez ce site dans Safari, touchez Partager, puis « Sur
                  l’écran d’accueil ». Ouvrez ensuite l’application avec cette
                  icône et revenez ici pour activer les notifications. iOS 16.4
                  ou une version ultérieure est nécessaire.
                </p>
              </div>
            ) : !environment.supported ? (
              <p className="note">
                Ce navigateur ne permet pas les notifications. Utilisez une
                version récente de Safari, Chrome, Edge ou Firefox, avec une
                connexion HTTPS.
              </p>
            ) : null}
            {environment.denied && !environment.needsHomeScreen ? (
              <p className="note">
                Les notifications sont bloquées. Autorisez-les dans les réglages
                de notifications de votre appareil ou les permissions de ce
                site, puis revenez ici.
              </p>
            ) : null}
            {error ? (
              <p className="note" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="note note--success" role="status">
                {notice}
              </p>
            ) : null}
            {!state ? (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void perform(load, "Réglages chargés.")}
              >
                Charger les réglages
              </button>
            ) : (
              <>
                <p>
                  <strong>
                    {currentDevice && !environment.denied
                      ? "Notifications activées sur cet appareil"
                      : "Notifications désactivées sur cet appareil"}
                  </strong>
                </p>
                <div className="actions">
                  {!currentDevice ? (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        !environment.supported ||
                        environment.needsHomeScreen ||
                        environment.denied
                      }
                      onClick={() => {
                        if (currentUser)
                          void perform(
                            () =>
                              enableDeviceNotifications(
                                state.publicKey,
                                currentUser.id,
                              ),
                            "Notifications activées. Telegram reste en veille pour vos alertes.",
                          );
                      }}
                    >
                      Activer sur cet appareil
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy || environment.denied}
                        onClick={() =>
                          void perform(
                            () =>
                              apiFetch("/notifications/test", {
                                method: "POST",
                              }),
                            "Test envoyé. Vérifiez vos notifications.",
                          )
                        }
                      >
                        Envoyer un test
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            () => disableDeviceNotifications(currentDevice.id),
                            "Notifications désactivées sur cet appareil.",
                          )
                        }
                      >
                        Désactiver sur cet appareil
                      </button>
                    </>
                  )}
                </div>
                <p className="field-hint">
                  Activez chaque appareil séparément. Les alertes peuvent
                  afficher des informations de réservation sur l’écran
                  verrouillé, selon vos réglages système.
                </p>
                <p className="field-hint">
                  Sur iPhone, la mention « from » suivie du nom de l’application
                  est ajoutée par iOS. Les titres et résumés privilégient
                  l’information utile.
                </p>
                {state.devices.length ? (
                  <>
                    <h3>Vos appareils activés</h3>
                    <ul>
                      {state.devices.map((device) => (
                        <li key={device.id}>
                          {device.label}
                          {device.id === currentDevice?.id
                            ? " · cet appareil"
                            : ""}{" "}
                          · ajouté le{" "}
                          {new Date(device.createdAt).toLocaleDateString(
                            "fr-FR",
                          )}{" "}
                          {device.id !== currentDevice?.id ? (
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void perform(
                                  () =>
                                    apiFetch(
                                      `/notifications/subscriptions/${encodeURIComponent(device.id)}`,
                                      { method: "DELETE" },
                                    ),
                                  "Appareil retiré des notifications.",
                                )
                              }
                            >
                              Retirer
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </SettingsShell>
  );
}
