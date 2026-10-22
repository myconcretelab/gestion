import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../utils/api";
import {
  reminderFrequency,
  type TaskReminderSettings as Settings,
} from "../tasks/taskUrgency";

type State = {
  settings: Settings;
  telegram_ready: boolean;
  scheduler_enabled: boolean;
  users: Array<{ id: string; name: string; telegram_ready: boolean }>;
};

export default function TaskReminderSettings() {
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => {
    setError("");
    try {
      const result = await apiFetch<State>("/action-tasks/reminder-settings");
      setState(result);
      setDraft(result.settings);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible de charger les réglages.",
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const update = (patch: Partial<Settings>) => {
    setDraft((value) => (value ? { ...value, ...patch } : value));
    setNotice("");
  };
  return (
    <section
      className="card task-reminder-settings"
      aria-label="Paramètres des tâches"
    >
      <header>
        <div className="settings-cluster__eyebrow">
          Organisation du quotidien
        </div>
        <h2>Tâches & rappels</h2>
        <p className="field-hint">
          Un petit coup de pouce, au bon moment. Les deux urgences attendent le
          prochain départ des locataires avant d’envoyer leur premier message.
        </p>
      </header>
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
      {!draft || !state ? (
        <>
          {!error ? (
            <p>Chargement…</p>
          ) : (
            <button type="button" onClick={() => void load()}>
              Réessayer
            </button>
          )}
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const result = await apiFetch<{ settings: Settings }>(
                "/action-tasks/reminder-settings",
                { method: "PUT", json: draft },
              );
              setDraft(result.settings);
              setState({ ...state, settings: result.settings });
              setNotice(
                "Réglages enregistrés. Ils s’appliquent aussi aux tâches urgentes en cours.",
              );
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Impossible d’enregistrer les réglages.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <label className="task-reminder-settings__check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update({ enabled: event.target.checked })}
              />
              <strong>Activer les rappels des tâches rapides</strong>
            </label>
            {!state.telegram_ready ? (
              <p className="note">
                Les rappels attendront l’activation du bot dans les{" "}
                <Link to="/parametres/telegram">paramètres Telegram</Link>.
              </p>
            ) : null}
            {!state.scheduler_enabled ? (
              <p className="note">
                Le planificateur automatique est désactivé sur ce serveur. Les
                réglages sont conservés, mais aucun rappel ne partira tant qu’il
                n’est pas activé.
              </p>
            ) : null}
            {!draft.enabled ? (
              <p className="field-hint">
                Les envois sont en pause. Les tâches restent à faire. Une
                réactivation reprendra les rappels encore nécessaires, sans
                rattraper chaque répétition passée.
              </p>
            ) : null}
            <div className="task-reminder-settings__levels">
              <div className="task-reminder-settings__level">
                <h3>🔔 Urgence 1</h3>
                <p>
                  Un message au prochain départ, avec toutes les tâches
                  concernées du logement.
                </p>
                <label className="task-reminder-settings__check">
                  <input
                    type="checkbox"
                    checked={draft.level_1_enabled}
                    onChange={(event) =>
                      update({ level_1_enabled: event.target.checked })
                    }
                  />
                  Autoriser ce niveau
                </label>
              </div>
              <div className="task-reminder-settings__level">
                <h3>🚨 Urgence 2</h3>
                <p>
                  Un premier message au même départ, puis des rappels jusqu’à ce
                  que la tâche soit faite ou les rappels arrêtés.
                </p>
                <label className="task-reminder-settings__check">
                  <input
                    type="checkbox"
                    checked={draft.level_2_enabled}
                    onChange={(event) =>
                      update({ level_2_enabled: event.target.checked })
                    }
                  />
                  Autoriser ce niveau
                </label>
                <label className="field">
                  Répéter toutes les…
                  <select
                    value={draft.repeat_interval_minutes}
                    onChange={(event) =>
                      update({
                        repeat_interval_minutes: Number(event.target.value),
                      })
                    }
                  >
                    {[15, 30, 60, 120, 180, 240, 360, 720, 1440].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value < 60
                            ? `${value} minutes`
                            : `${value / 60} heure${value > 60 ? "s" : ""}`}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
            </div>
            <div className="grid-2">
              <label className="field">
                Qui reçoit les messages ?
                <select
                  value={draft.recipient_policy}
                  onChange={(event) =>
                    update({
                      recipient_policy: event.target
                        .value as Settings["recipient_policy"],
                    })
                  }
                >
                  <option value="creator_first">
                    Le créateur, puis l’intervenant, puis le gestionnaire
                  </option>
                  <option value="assignee_or_manager">
                    L’intervenant affecté, sinon le gestionnaire
                  </option>
                  <option value="manager_only">
                    Toujours le gestionnaire du logement
                  </option>
                </select>
                <span className="field-hint">
                  Par défaut, le créateur est prioritaire. Le compte doit être
                  actif et son identifiant Telegram renseigné. Chaque message
                  regroupe les tâches d’un logement pour un destinataire.
                </span>
              </label>
              <label className="field">
                Destinataire de secours
                <select
                  value={draft.fallback_user_id ?? ""}
                  onChange={(event) =>
                    update({ fallback_user_id: event.target.value || null })
                  }
                >
                  <option value="">
                    Un propriétaire avec Telegram, si disponible
                  </option>
                  {state.users.map((user) => (
                    <option
                      key={user.id}
                      value={user.id}
                      disabled={!user.telegram_ready}
                    >
                      {user.name}
                      {!user.telegram_ready ? " · Telegram non renseigné" : ""}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Utilisé si le gestionnaire du logement ne peut pas recevoir de
                  message. Sans destinataire disponible, l’envoi attend.
                </span>
              </label>
            </div>
            <details>
              <summary>Personnaliser les messages et les boutons</summary>
              <div className="grid-2" style={{ marginTop: 16 }}>
                <label className="field">
                  Titre du message
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={draft.message_heading}
                    onChange={(event) =>
                      update({ message_heading: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Validité des liens (jours)
                  <input
                    required
                    type="number"
                    min={1}
                    max={90}
                    value={draft.link_validity_days}
                    onChange={(event) =>
                      update({ link_validity_days: Number(event.target.value) })
                    }
                  />
                  <span className="field-hint">
                    Chaque nouveau message fournit des liens renouvelés,
                    utilisables sans connexion.
                  </span>
                </label>
                <label className="field">
                  Bouton pour terminer la tâche
                  <input
                    required
                    minLength={2}
                    maxLength={40}
                    value={draft.done_button_label}
                    onChange={(event) =>
                      update({ done_button_label: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Bouton pour arrêter les rappels
                  <input
                    required
                    minLength={2}
                    maxLength={40}
                    value={draft.stop_button_label}
                    onChange={(event) =>
                      update({ stop_button_label: event.target.value })
                    }
                  />
                </label>
              </div>
            </details>
            <div
              className="task-reminder-settings__preview"
              aria-label="Aperçu d’un rappel de niveau 2"
            >
              <strong>{draft.message_heading}</strong>
              <p>🏡 Votre logement</p>
              <p>1. 🚨 Apporter du savon</p>
              <p className="field-hint">
                Au prochain départ, puis{" "}
                {reminderFrequency(draft.repeat_interval_minutes)}.
              </p>
              <span>{draft.done_button_label}</span>
              <span>{draft.stop_button_label}</span>
              <small>
                « C’est fait » termine la tâche. « Arrêter les rappels » la
                laisse à faire.
              </small>
            </div>
            <p className="field-hint">
              L’heure du départ est celle du contrat, ou à défaut celle du gîte,
              dans le fuseau de Paris. S’il n’y a aucun séjour à venir, les
              rappels attendent une réservation. Une tâche créée reste sans
              urgence tant que vous ne choisissez pas de niveau.
            </p>
            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? "Enregistrement…" : "Enregistrer les réglages"}
              </button>
            </div>
            {notice ? <p role="status">{notice}</p> : null}
          </fieldset>
        </form>
      )}
    </section>
  );
}
