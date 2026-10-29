import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../utils/api";

type Status = {
  push_active: boolean;
  device_count: number;
  telegram_state: "active" | "standby" | "disabled";
};

export default function NotificationDeliveryStatus({
  refreshKey,
  page,
}: {
  refreshKey: string;
  page: "telegram" | "notifications";
}) {
  const [state, setState] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      apiFetch<Status>("/notifications/status")
        .then((data) => {
          if (alive) {
            setState(data);
            setFailed(false);
          }
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    void load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [refreshKey]);
  return (
    <div className="notification-delivery-status" role="status">
      {failed ? (
        <p>État des canaux indisponible. Rechargez la page pour le vérifier.</p>
      ) : !state ? (
        <p>Vérification des canaux…</p>
      ) : (
        <>
          <div className="notification-delivery-status__channels">
            <span>
              <strong>Notifications</strong> ·{" "}
              {state.push_active
                ? `${state.device_count} appareil${state.device_count > 1 ? "s" : ""} activé${state.device_count > 1 ? "s" : ""}`
                : "Désactivées"}
            </span>
            <span>
              <strong>Telegram</strong> ·{" "}
              {state.telegram_state === "standby"
                ? "En veille"
                : state.telegram_state === "active"
                  ? "Actif"
                  : "Désactivé"}
            </span>
          </div>
          <p>
            {state.push_active
              ? "Vos appareils reçoivent les alertes en priorité, sans doublon Telegram."
              : "Activez un appareil pour recevoir vos alertes en notification."}
            {state.telegram_state === "standby"
              ? " Telegram prend le relais si l’envoi échoue ou si vous désactivez tous vos appareils."
              : null}
          </p>
          {state.telegram_state === "disabled" ? (
            <p>
              Les alertes automatiques sont désactivées ou le bot n’est pas
              configuré.{" "}
              <Link to="/parametres/telegram">Configurer les alertes</Link>
            </p>
          ) : null}
          <Link
            to={
              page === "telegram"
                ? "/parametres/notifications"
                : "/parametres/telegram"
            }
          >
            {page === "telegram"
              ? "Gérer mes appareils"
              : "Régler les événements et le secours Telegram"}
          </Link>
        </>
      )}
    </div>
  );
}
