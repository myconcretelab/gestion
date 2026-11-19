import { useEffect, useState, type FormEvent } from "react";
import type { AppUser } from "../../utils/auth";
import { Link } from "react-router-dom";
import { ownerNotificationEmailsSchema } from "@contrats/shared";
import { apiFetch, isApiError } from "../../utils/api";
import NotificationDevices from "./NotificationDevices";
import { notificationError } from "./NotificationRules";

type TelegramState = {
  config: {
    enabled: boolean;
    bot_token: string;
    chat_ids: string[];
    recipient_user_ids: string[];
    gite_check_mentions: string[];
  };
  bot_configured: boolean;
};
type TelegramUser = {
  id: string;
  displayName: string;
  telegramChatId: string | null;
  isActive: boolean;
};
type EmailState = { recipients: string[]; smtpConfigured: boolean };
const splitEntries = (value: string) =>
  value
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

function TelegramChannel() {
  const [state, setState] = useState<TelegramState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [mentions, setMentions] = useState("");
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = (data: TelegramState) => {
    setState(data);
    setEnabled(data.config.enabled);
    setToken("");
    setChatIds(data.config.chat_ids.join("\n"));
    setMentions(data.config.gite_check_mentions.join(", "));
    setSelectedUsers(data.config.recipient_user_ids);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<TelegramState>("/settings/telegram");
        if (cancelled) return;
        apply(data);
        const recipients = await apiFetch<TelegramUser[]>("/users");
        if (!cancelled)
          setUsers(
            recipients.filter((user) => user.isActive && user.telegramChatId),
          );
      } catch (reason) {
        if (cancelled) return;
        if (isApiError(reason) && reason.payload.code === "MODULE_DISABLED")
          setUnavailable(true);
        else setError(notificationError(reason));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const recipients = splitEntries(chatIds);
  const hasRecipient = recipients.length > 0 || selectedUsers.length > 0;
  const dirty = Boolean(
    state &&
    (enabled !== state.config.enabled ||
      token.trim() ||
      chatIds !== state.config.chat_ids.join("\n") ||
      mentions !== state.config.gite_check_mentions.join(", ") ||
      selectedUsers.join(",") !== state.config.recipient_user_ids.join(",")),
  );
  const run = async (action: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(notificationError(reason));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (
        enabled &&
        (!hasRecipient || !(state?.bot_configured || token.trim()))
      ) {
        throw new Error(
          "Renseignez le jeton du bot et au moins un destinataire.",
        );
      }
      apply(
        await apiFetch<TelegramState>("/settings/telegram", {
          method: "PUT",
          json: {
            enabled,
            bot_token: token.trim(),
            chat_ids: recipients,
            recipient_user_ids: selectedUsers,
            gite_check_mentions: splitEntries(mentions),
          },
        }),
      );
      setNotice("Configuration Telegram enregistrée.");
    });
  };
  const test = () =>
    void run(async () => {
      const result = await apiFetch<{ sent_count: number }>(
        "/settings/telegram/test",
        {
          method: "POST",
          json: { message: "Test des notifications propriétaire." },
        },
      );
      if (!result.sent_count)
        throw new Error("Telegram n’a accepté aucun message de test.");
      setNotice(
        `Test envoyé à ${result.sent_count} destinataire${result.sent_count > 1 ? "s" : ""}.`,
      );
    });

  return (
    <section
      className="card owner-notification-channel"
      aria-labelledby="notification-telegram-title"
    >
      <div className="owner-notification-channel__heading">
        <h3 id="notification-telegram-title">Telegram</h3>
        {state && (
          <span className="owner-notification-status">
            {!state.config.enabled
              ? "Désactivé"
              : state.bot_configured
                ? "Bot configuré"
                : "À configurer"}
          </span>
        )}
      </div>
      {unavailable && (
        <p>
          Activez le module Telegram dans{" "}
          <Link to="/parametres/connexions">Connexions</Link> pour configurer le
          bot.
        </p>
      )}
      {!state && !unavailable && !error && (
        <p role="status">Chargement de Telegram…</p>
      )}
      {state && (
        <form onSubmit={save}>
          <fieldset disabled={busy} className="owner-notification-fields">
            <label className="owner-notification-choice">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Activer Telegram
            </label>
            <label className="field">
              Jeton du bot
              <input
                type="password"
                autoComplete="new-password"
                value={token}
                placeholder={
                  state.bot_configured ? "Jeton déjà enregistré" : undefined
                }
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            {users.length > 0 && (
              <fieldset className="owner-notification-fields">
                <legend>Destinataires de l’équipe</legend>
                <div className="owner-notification-choice-list">
                  {users.map((user) => (
                    <label key={user.id}>
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.id)}
                        onChange={(event) =>
                          setSelectedUsers(
                            event.target.checked
                              ? [...selectedUsers, user.id]
                              : selectedUsers.filter((id) => id !== user.id),
                          )
                        }
                      />
                      {user.displayName}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="field">
              Autres identifiants de chat
              <textarea
                rows={2}
                value={chatIds}
                onChange={(event) => setChatIds(event.target.value)}
              />
              <span className="field-hint">
                Un identifiant par ligne. Pour un groupe, utilisez l’identifiant
                de son chat.
              </span>
            </label>
            <label className="field">
              Mentions pour un gîte vérifié
              <input
                value={mentions}
                onChange={(event) => setMentions(event.target.value)}
                placeholder="@pseudo"
              />
              <span className="field-hint">
                Séparez les pseudos Telegram par des virgules.
              </span>
            </label>
            <div className="actions">
              <button type="submit" disabled={!dirty}>
                Enregistrer
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  dirty || !enabled || !state.bot_configured || !hasRecipient
                }
                onClick={test}
              >
                Envoyer un test Telegram
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="note note--success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function EmailChannel() {
  const [state, setState] = useState<EmailState | null>(null);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = (data: EmailState) => {
    setState(data);
    setEmails(data.recipients.join("\n"));
  };
  useEffect(() => {
    let cancelled = false;
    void apiFetch<EmailState>("/notifications/email")
      .then((data) => {
        if (!cancelled) apply(data);
      })
      .catch((reason) => {
        if (!cancelled) setError(notificationError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = Boolean(state && emails !== state.recipients.join("\n"));
  const run = async (action: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(notificationError(reason));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const recipients = ownerNotificationEmailsSchema.safeParse(
        splitEntries(emails),
      );
      if (!recipients.success)
        throw new Error("Renseignez jusqu’à 20 adresses e-mail valides.");
      apply(
        await apiFetch<EmailState>("/notifications/email", {
          method: "PUT",
          json: { recipients: recipients.data },
        }),
      );
      setNotice("Destinataires enregistrés.");
    });
  };
  const test = () =>
    void run(async () => {
      const result = await apiFetch<{
        sent_count: number;
        failed_count: number;
      }>("/notifications/email/test", { method: "POST" });
      const sent = `Test envoyé à ${result.sent_count} adresse${result.sent_count > 1 ? "s" : ""}.`;
      setNotice(
        result.failed_count
          ? `${sent} Échec pour ${result.failed_count} adresse(s).`
          : sent,
      );
    });

  return (
    <section
      className="card owner-notification-channel"
      aria-labelledby="notification-email-title"
    >
      <div className="owner-notification-channel__heading">
        <h3 id="notification-email-title">E-mail</h3>
        {state && (
          <span className="owner-notification-status">
            {state.smtpConfigured ? "SMTP configuré" : "SMTP indisponible"}
          </span>
        )}
      </div>
      {!state && !error && <p role="status">Chargement du canal e-mail…</p>}
      {state && (
        <form onSubmit={save}>
          <fieldset disabled={busy} className="owner-notification-fields">
            <label className="field">
              Adresses des destinataires
              <textarea
                rows={3}
                value={emails}
                onChange={(event) => setEmails(event.target.value)}
                placeholder="Une adresse par ligne"
              />
              <span className="field-hint">
                Laissez vide pour utiliser les adresses habituelles des gîtes ou
                des comptes propriétaires. Le test utilise les adresses
                enregistrées ici ou celles des comptes propriétaires.
              </span>
            </label>
            <div className="actions">
              <button type="submit" disabled={!dirty}>
                Enregistrer
              </button>
              <button
                type="button"
                className="secondary"
                disabled={dirty || !state.smtpConfigured}
                onClick={test}
              >
                Envoyer un e-mail de test
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="note note--success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

export default function NotificationChannels({
  currentUser,
}: {
  currentUser: AppUser;
}) {
  return (
    <div className="owner-notification-channels">
      <NotificationDevices currentUser={currentUser} />
      <TelegramChannel />
      <EmailChannel />
    </div>
  );
}
