import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AppUser } from "../../utils/auth";
import NotificationChannels from "./NotificationChannels";
import NotificationRules from "./NotificationRules";
import SettingsShell from "./SettingsShell";
import "./notificationSettings.css";

export default function NotificationSettings({
  currentUser,
}: {
  currentUser: AppUser | null;
}) {
  const [searchParams] = useSearchParams();
  const showChannels = searchParams.get("onglet") === "canaux";
  const [visited, setVisited] = useState({
    rules: !showChannels,
    channels: showChannels,
  });
  return (
    <SettingsShell>
      <div className="owner-notifications">
        <header className="owner-notifications__header">
          <h1>Notifications propriétaire</h1>
          <p>
            Choisissez comment être averti des réservations, des tâches et des
            échéances.
          </p>
        </header>
        {currentUser?.permissions.isOwner ? (
          <>
            <nav
              className="owner-notifications__tabs"
              aria-label="Notifications propriétaire"
            >
              <Link
                to="/parametres/notifications"
                aria-current={!showChannels ? "page" : undefined}
                onClick={() =>
                  setVisited((current) => ({ ...current, rules: true }))
                }
              >
                Règles d’envoi
              </Link>
              <Link
                to="/parametres/notifications?onglet=canaux"
                aria-current={showChannels ? "page" : undefined}
                onClick={() =>
                  setVisited((current) => ({ ...current, channels: true }))
                }
              >
                Appareils et canaux
              </Link>
            </nav>
            <div hidden={showChannels}>
              {(visited.rules || !showChannels) && (
                <NotificationRules active={!showChannels} />
              )}
            </div>
            <div hidden={!showChannels}>
              {(visited.channels || showChannels) && (
                <NotificationChannels currentUser={currentUser} />
              )}
            </div>
          </>
        ) : (
          <p className="note">
            Ces réglages sont réservés aux comptes propriétaires.
          </p>
        )}
      </div>
    </SettingsShell>
  );
}
