import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ownerNotificationEvents,
  type OwnerNotificationEvent,
  type OwnerNotificationRule,
  type OwnerNotificationSettings,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";

const groups: Array<{
  title: string;
  events: Array<{
    id: OwnerNotificationEvent;
    label: string;
    description?: string;
  }>;
}> = [
  {
    title: "Réservations et paiements",
    events: [
      {
        id: "booking_requested",
        label: "Nouvelle demande de réservation",
        description: "Demande à valider reçue via le site.",
      },
      {
        id: "booking_confirmed",
        label: "Réservation confirmée",
        description:
          "Validation manuelle ou confirmation après paiement en ligne.",
      },
      {
        id: "payment_received",
        label: "Paiement reçu",
        description: "Paiement en ligne d’une réservation déjà confirmée.",
      },
      { id: "payment_review", label: "Paiement à vérifier" },
      { id: "payment_refunded", label: "Remboursement enregistré" },
    ],
  },
  {
    title: "Tâches et ménage",
    events: [
      { id: "task_completed", label: "Tâche terminée" },
      { id: "cleaning_completed", label: "Ménage terminé" },
      { id: "gite_checked", label: "Gîte vérifié" },
      {
        id: "cleaning_check_reminder",
        label: "Ménage ou contrôle à faire",
        description: "Rappel avant l’arrivée des voyageurs.",
      },
    ],
  },
  {
    title: "Contrats et factures",
    events: [
      { id: "contract_received", label: "Contrat signé reçu" },
      { id: "contract_overdue", label: "Contrat non reçu après échéance" },
      { id: "invoice_overdue", label: "Facture impayée après échéance" },
    ],
  },
];

type RulesState = {
  settings: OwnerNotificationSettings;
  defaults: Record<OwnerNotificationEvent, OwnerNotificationRule>;
  telegramAvailable: boolean;
  digestAvailable: boolean;
  properties: { id: string; nom: string }[];
  templates: { id: string; title: string; gite_id: string }[];
  legacyCleaningGiteIds: string[];
};

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const refreshDraft = (
  draft: OwnerNotificationSettings | null,
  previous: OwnerNotificationSettings | null,
  next: OwnerNotificationSettings,
): OwnerNotificationSettings => {
  if (!draft || !previous || same(draft, previous)) return next;
  const rules = { ...next.rules };
  for (const event of ownerNotificationEvents) {
    const edited = draft.rules[event];
    const original = previous.rules[event];
    if (same(edited, original)) continue;
    rules[event] = {
      ...next.rules[event],
      ...Object.fromEntries(
        Object.entries(edited ?? {}).filter(
          ([field, value]) =>
            value !== original?.[field as keyof OwnerNotificationRule],
        ),
      ),
    };
  }
  return {
    rules,
    taskOverrides: same(draft.taskOverrides, previous.taskOverrides)
      ? next.taskOverrides
      : draft.taskOverrides,
    cleaningScope:
      draft.cleaningScope === previous.cleaningScope
        ? next.cleaningScope
        : draft.cleaningScope,
    cleaningGiteIds: same(draft.cleaningGiteIds, previous.cleaningGiteIds)
      ? next.cleaningGiteIds
      : draft.cleaningGiteIds,
  };
};

export const notificationError = (reason: unknown) =>
  reason instanceof Error ? reason.message : "L’opération a échoué.";

function RuleChannels({
  label,
  rule,
  change,
  confirmationEmail,
}: {
  label: string;
  rule: OwnerNotificationRule;
  change: (patch: Partial<OwnerNotificationRule>) => void;
  confirmationEmail?: "inherited" | "yes" | "no";
}) {
  return (
    <>
      <label className="owner-notification-rule__check">
        <span>Appareils</span>
        <input
          type="checkbox"
          aria-label={`${label} sur les appareils`}
          checked={rule.push}
          onChange={(event) => change({ push: event.target.checked })}
        />
      </label>
      <label className="owner-notification-rule__telegram">
        <span>Telegram</span>
        <select
          aria-label={`${label} sur Telegram`}
          value={rule.telegram}
          onChange={(event) =>
            change({
              telegram: event.target.value as OwnerNotificationRule["telegram"],
            })
          }
        >
          <option value="off">Désactivé</option>
          <option value="fallback">En secours</option>
          <option value="always">Toujours</option>
        </select>
      </label>
      <label className="owner-notification-rule__check owner-notification-rule__email">
        <span>E-mail</span>
        {confirmationEmail ? (
          <select
            aria-label={`${label} par e-mail`}
            value={confirmationEmail}
            onChange={(event) =>
              change({
                email:
                  event.target.value === "inherited"
                    ? undefined
                    : event.target.value === "yes",
              })
            }
          >
            <option value="inherited">Si payé</option>
            <option value="yes">Activé</option>
            <option value="no">Désactivé</option>
          </select>
        ) : (
          <input
            type="checkbox"
            aria-label={`${label} par e-mail`}
            checked={rule.email}
            onChange={(event) => change({ email: event.target.checked })}
          />
        )}
      </label>
    </>
  );
}

export default function NotificationRules({ active }: { active: boolean }) {
  const [state, setState] = useState<RulesState | null>(null);
  const [draft, setDraft] = useState<OwnerNotificationSettings | null>(null);
  const savedSettings = useRef<OwnerNotificationSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void apiFetch<RulesState>("/notifications/rules")
      .then((data) => {
        if (cancelled) return;
        const previous = savedSettings.current;
        savedSettings.current = data.settings;
        setState(data);
        setDraft((current) => refreshDraft(current, previous, data.settings));
        setError("");
      })
      .catch((reason) => {
        if (!cancelled) setError(notificationError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!state || !draft) {
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Chargement des règles d’envoi…"}
      </p>
    );
  }
  const dirty = !same(draft, state.settings);
  const selectedProperties =
    draft.cleaningGiteIds ?? state.legacyCleaningGiteIds;
  const ruleFor = (event: OwnerNotificationEvent) => ({
    ...state.defaults[event],
    ...draft.rules[event],
  });
  const update = (patch: Partial<OwnerNotificationSettings>) => {
    setNotice("");
    setDraft((current) => current && { ...current, ...patch });
  };
  const changeRule = (
    event: OwnerNotificationEvent,
    patch: Partial<OwnerNotificationRule>,
  ) => {
    update({
      rules: { ...draft.rules, [event]: { ...draft.rules[event], ...patch } },
    });
  };
  const save = async () => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const saved = await apiFetch<RulesState>("/notifications/rules", {
        method: "PUT",
        json: draft,
      });
      savedSettings.current = saved.settings;
      setState(saved);
      setDraft(saved.settings);
      setNotice("Règles enregistrées.");
    } catch (reason) {
      setError(notificationError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="owner-notifications__hint">
        Sur Telegram, <strong>En secours</strong> prend le relais si aucun
        appareil du destinataire n’accepte l’alerte. <strong>Toujours</strong>{" "}
        envoie un message même lorsque l’alerte sur appareil aboutit.
      </p>
      {!state.telegramAvailable && (
        <p className="note">
          Le module Telegram est désactivé. Vous pouvez l’activer dans les
          paramètres de connexion.
        </p>
      )}
      <fieldset disabled={busy} className="owner-notification-matrix">
        <div className="owner-notification-matrix__columns" aria-hidden="true">
          <span>Événement</span>
          <span>Appareils</span>
          <span>Telegram</span>
          <span>E-mail</span>
        </div>
        {groups.map((group) => (
          <section
            key={group.title}
            className="owner-notification-group"
            aria-label={group.title}
          >
            <h2>{group.title}</h2>
            {group.events.map(({ id, label, description }) => (
              <div key={id} className="owner-notification-rule">
                <div className="owner-notification-rule__label">
                  <strong>{label}</strong>
                  {description && <small>{description}</small>}
                </div>
                <RuleChannels
                  label={label}
                  rule={ruleFor(id)}
                  change={(patch) => changeRule(id, patch)}
                  confirmationEmail={
                    id === "booking_confirmed"
                      ? draft.rules[id]?.email === undefined
                        ? "inherited"
                        : draft.rules[id].email
                          ? "yes"
                          : "no"
                      : undefined
                  }
                />
                {id === "cleaning_completed" && (
                  <details className="owner-notification-rule__details">
                    <summary>
                      {draft.cleaningScope === "all"
                        ? "Tous les gîtes"
                        : `Gîtes sélectionnés (${selectedProperties.length})`}
                    </summary>
                    <label className="field">
                      Appliquer la règle
                      <select
                        value={draft.cleaningScope}
                        onChange={(event) =>
                          update({
                            cleaningScope: event.target
                              .value as OwnerNotificationSettings["cleaningScope"],
                          })
                        }
                      >
                        <option value="selected">Aux gîtes sélectionnés</option>
                        <option value="all">À tous les gîtes</option>
                      </select>
                    </label>
                    {draft.cleaningScope === "selected" && (
                      <div className="owner-notification-choice-list">
                        {state.properties.map((property) => (
                          <label key={property.id}>
                            <input
                              type="checkbox"
                              checked={selectedProperties.includes(property.id)}
                              onChange={(event) =>
                                update({
                                  cleaningGiteIds: event.target.checked
                                    ? [...selectedProperties, property.id]
                                    : selectedProperties.filter(
                                        (id) => id !== property.id,
                                      ),
                                })
                              }
                            />
                            {property.nom}
                          </label>
                        ))}
                      </div>
                    )}
                  </details>
                )}
                {id === "task_completed" && state.templates.length > 0 && (
                  <details className="owner-notification-rule__details">
                    <summary>
                      Exceptions par modèle de tâche (
                      {Object.keys(draft.taskOverrides).length})
                    </summary>
                    <p className="field-hint">
                      Chaque modèle peut utiliser ses propres canaux.
                    </p>
                    {state.templates.map((template) => {
                      const override = draft.taskOverrides[template.id];
                      const property = state.properties.find(
                        (item) => item.id === template.gite_id,
                      );
                      const name = property
                        ? `${template.title} · ${property.nom}`
                        : template.title;
                      return (
                        <div
                          className="owner-notification-rule owner-notification-rule--exception"
                          key={template.id}
                        >
                          <label className="owner-notification-rule__label">
                            <input
                              type="checkbox"
                              checked={Boolean(override)}
                              aria-label={`Personnaliser ${name}`}
                              onChange={(event) => {
                                const taskOverrides = {
                                  ...draft.taskOverrides,
                                };
                                if (event.target.checked)
                                  taskOverrides[template.id] =
                                    ruleFor("task_completed");
                                else delete taskOverrides[template.id];
                                update({ taskOverrides });
                              }}
                            />
                            {name}
                          </label>
                          {override && (
                            <RuleChannels
                              label={name}
                              rule={override}
                              change={(patch) =>
                                update({
                                  taskOverrides: {
                                    ...draft.taskOverrides,
                                    [template.id]: { ...override, ...patch },
                                  },
                                })
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </details>
                )}
              </div>
            ))}
          </section>
        ))}
      </fieldset>
      <div className="owner-notification-save">
        <button type="submit" disabled={!dirty || busy}>
          {busy ? "Enregistrement…" : "Enregistrer les règles"}
        </button>
        {error && <span role="alert">{error}</span>}
        {notice && <span role="status">{notice}</span>}
      </div>
      {state.digestAvailable && (
        <div className="card owner-notification-digest">
          <div>
            <h2>E-mail quotidien</h2>
            <p>
              Synthèse des nouvelles réservations, avec son horaire et ses
              destinataires.
            </p>
          </div>
          <Link to="/parametres/email-quotidien">
            Régler l’e-mail quotidien
          </Link>
        </div>
      )}
    </form>
  );
}
