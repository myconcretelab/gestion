import { useState } from "react";
import ReservationDetailsDrawer from "../shared/ReservationDetailsDrawer";
import { CategoryChoice, TaskIcon } from "./TaskIcons";
import {
  addDays,
  emptyTemplate,
  parisDay,
  type ActionResponse,
  type ActionTemplate,
  type CompensationMode,
} from "./types";

type SharedProps = {
  data: ActionResponse;
  busy: boolean;
  error: string | null;
  onClose: () => void;
};
function CompensationFields({
  mode,
  amount,
  minutes,
  onChange,
}: {
  mode: CompensationMode;
  amount: number | null;
  minutes: number | null;
  onChange: (value: {
    compensation_mode?: CompensationMode;
    compensation_amount?: number;
    minutes?: number | null;
  }) => void;
}) {
  return (
    <>
      <label>
        Rémunération
        <select
          value={mode}
          onChange={(event) =>
            onChange({
              compensation_mode: event.target.value as CompensationMode,
            })
          }
        >
          <option value="none">Sans rémunération spécifique</option>
          <option value="flat_rate">Au forfait</option>
          <option value="time">Au temps passé</option>
        </select>
      </label>
      {mode === "flat_rate" ? (
        <label>
          Forfait (€)
          <input
            type="number"
            required
            min="0.01"
            max="100000"
            step="0.01"
            value={amount ?? ""}
            onChange={(event) =>
              onChange({ compensation_amount: Number(event.target.value) })
            }
          />
        </label>
      ) : null}
      {mode === "time" ? (
        <label>
          Durée prévue (minutes)
          <input
            type="number"
            required
            min="1"
            max="1440"
            value={minutes ?? ""}
            onChange={(event) =>
              onChange({
                minutes: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
          <span className="tw-help">
            Le temps réellement passé sera confirmé à la réalisation.
          </span>
        </label>
      ) : null}
    </>
  );
}

export function TaskCreateDrawer({
  data,
  busy,
  error,
  onClose,
  giteId,
  onCreate,
}: SharedProps & {
  giteId: string;
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState({
    gite_id: giteId || data.gites[0]?.id || "",
    title: "",
    category: "short" as "short" | "long",
    note: "",
    assignee_id: "",
    start_day: parisDay(),
    start_time: "09:00",
    due_day: addDays(parisDay(), 1),
    due_time: "12:00",
    compensation_mode: "none" as CompensationMode,
    compensation_amount: 0,
    spent_minutes: null as number | null,
  });
  const [showAll, setShowAll] = useState(false);
  const chooseCategory = (category: "short" | "long") =>
    setDraft((current) => ({
      ...current,
      category,
      due_day: addDays(parisDay(), category === "short" ? 1 : 30),
      due_time: category === "short" ? "12:00" : "18:00",
    }));
  return (
    <ReservationDetailsDrawer
      open
      className="tw-form-drawer"
      eyebrow="Organisation des gîtes"
      title="Nouvelle tâche"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="tw-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            form="task-create-form"
            type="submit"
            className="tw-primary"
            disabled={busy || !draft.gite_id || draft.title.trim().length < 2}
          >
            <TaskIcon name="plus" />
            {busy ? "Création…" : "Créer la tâche"}
          </button>
        </>
      }
    >
      <form
        id="task-create-form"
        className="tw-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const { compensation_amount, ...rest } = draft;
          if (
            await onCreate({
              ...rest,
              assignee_id: draft.assignee_id || null,
              ...(data.can_edit_compensation ? { compensation_amount } : {}),
            })
          )
            onClose();
        }}
      >
        <fieldset disabled={busy}>
          {error ? (
            <p className="tw-error" role="alert">
              {error}
            </p>
          ) : null}
          <label>
            Dans quel gîte ?
            <select
              required
              value={draft.gite_id}
              onChange={(event) =>
                setDraft({ ...draft, gite_id: event.target.value })
              }
            >
              {data.gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
            </select>
          </label>
          {data.shortcuts.length ? (
            <div className="tw-form-shortcuts">
              <span className="tw-label">Partir d’un raccourci</span>
              <div>
                {(showAll ? data.shortcuts : data.shortcuts.slice(0, 5)).map(
                  (item) => (
                    <button
                      type="button"
                      key={item.key}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          title: item.title,
                          category: item.category,
                          note: item.note,
                          due_day: addDays(
                            parisDay(),
                            item.category === "short" ? 1 : 30,
                          ),
                          due_time:
                            item.category === "short" ? "12:00" : "18:00",
                        }));
                      }}
                    >
                      <TaskIcon name="plus" />
                      {item.title}
                    </button>
                  ),
                )}
              </div>
              {data.shortcuts.length > 5 ? (
                <button
                  type="button"
                  className="tw-text-button"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll
                    ? "Réduire"
                    : `Voir les ${data.shortcuts.length} raccourcis`}
                </button>
              ) : null}
            </div>
          ) : null}
          <label>
            Que faut-il faire ?
            <input
              autoFocus
              required
              minLength={2}
              maxLength={120}
              placeholder="Ex. Remplacer le pommeau de douche"
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <CategoryChoice value={draft.category} onChange={chooseCategory} />
          <label>
            Consignes <span className="tw-optional">facultatif</span>
            <textarea
              rows={2}
              maxLength={2000}
              placeholder="Quelques précisions utiles…"
              value={draft.note}
              onChange={(event) =>
                setDraft({ ...draft, note: event.target.value })
              }
            />
          </label>
          <label>
            Intervenant
            <select
              value={draft.assignee_id}
              onChange={(event) =>
                setDraft({ ...draft, assignee_id: event.target.value })
              }
            >
              <option value="">Non attribuée · à décider plus tard</option>
              {data.assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <details className="tw-advanced">
            <summary>Dates et rémunération</summary>
            <div className="tw-form-grid">
              <label>
                Début
                <input
                  required
                  type="date"
                  value={draft.start_day}
                  onChange={(event) =>
                    setDraft({ ...draft, start_day: event.target.value })
                  }
                />
                <input
                  required
                  type="time"
                  aria-label="Heure de début"
                  value={draft.start_time}
                  onChange={(event) =>
                    setDraft({ ...draft, start_time: event.target.value })
                  }
                />
              </label>
              <label>
                Échéance
                <input
                  required
                  type="date"
                  min={draft.start_day}
                  value={draft.due_day}
                  onChange={(event) =>
                    setDraft({ ...draft, due_day: event.target.value })
                  }
                />
                <input
                  required
                  type="time"
                  aria-label="Heure d’échéance"
                  value={draft.due_time}
                  onChange={(event) =>
                    setDraft({ ...draft, due_time: event.target.value })
                  }
                />
              </label>
            </div>
            {data.can_edit_compensation ? (
              <CompensationFields
                mode={draft.compensation_mode}
                amount={draft.compensation_amount}
                minutes={draft.spent_minutes}
                onChange={({ minutes, ...value }) =>
                  setDraft({
                    ...draft,
                    ...value,
                    ...(minutes !== undefined
                      ? { spent_minutes: minutes }
                      : {}),
                  })
                }
              />
            ) : null}
          </details>
        </fieldset>
      </form>
    </ReservationDetailsDrawer>
  );
}

export function TaskAutomationDrawer({
  data,
  busy,
  error,
  onClose,
  template,
  onSave,
}: SharedProps & {
  template: ActionTemplate | null;
  onSave: (draft: Omit<ActionTemplate, "id">, id?: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Omit<ActionTemplate, "id">>(
    template ? { ...template } : emptyTemplate(data.gites[0]?.id ?? ""),
  );
  return (
    <ReservationDetailsDrawer
      open
      className="tw-form-drawer"
      eyebrow="Automatisation"
      title={template ? "Modifier l’automatisation" : "Nouvelle automatisation"}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="tw-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            form="task-automation-form"
            type="submit"
            className="tw-primary"
            disabled={busy || !draft.gite_id || draft.title.trim().length < 2}
          >
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      }
    >
      <form
        id="task-automation-form"
        className="tw-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await onSave(draft, template?.id)) onClose();
        }}
      >
        <fieldset disabled={busy}>
          {error ? (
            <p className="tw-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="tw-help">
            Crée une tâche à chaque arrivée ou départ du gîte choisi. Pour un
            simple raccourci à utiliser à la demande, utilisez l’onglet
            Préenregistrées.
          </p>
          <label>
            Nom de la tâche
            <input
              autoFocus
              required
              minLength={2}
              maxLength={120}
              placeholder="Ex. Préparer le linge"
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          <CategoryChoice
            value={draft.category}
            onChange={(category) => setDraft({ ...draft, category })}
          />
          <div className="tw-form-grid">
            <label>
              Gîte
              <select
                value={draft.gite_id}
                onChange={(event) =>
                  setDraft({ ...draft, gite_id: event.target.value })
                }
              >
                {data.gites.map((gite) => (
                  <option key={gite.id} value={gite.id}>
                    {gite.nom}
                  </option>
                ))}
              </select>
            </label>
            <label>
              À chaque
              <select
                value={draft.trigger_event}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    trigger_event: event.target
                      .value as ActionTemplate["trigger_event"],
                  })
                }
              >
                <option value="departure">Départ</option>
                <option value="arrival">Arrivée</option>
              </select>
            </label>
          </div>
          <div className="tw-form-block">
            <h3>Quand ?</h3>
            <p className="tw-help">
              0 = le jour du séjour, −1 = la veille, +1 = le lendemain.
            </p>
            <div className="tw-form-grid">
              <label>
                Début (jours de décalage)
                <input
                  required
                  type="number"
                  min={-30}
                  max={30}
                  value={draft.starts_offset_days}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      starts_offset_days: Number(event.target.value),
                    })
                  }
                />
                <input
                  required
                  type="time"
                  aria-label="Heure de début"
                  value={draft.start_time}
                  onChange={(event) =>
                    setDraft({ ...draft, start_time: event.target.value })
                  }
                />
              </label>
              <label>
                Échéance (jours de décalage)
                <input
                  required
                  type="number"
                  min={-30}
                  max={30}
                  value={draft.due_offset_days}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      due_offset_days: Number(event.target.value),
                    })
                  }
                />
                <input
                  required
                  type="time"
                  aria-label="Heure d’échéance"
                  value={draft.due_time}
                  onChange={(event) =>
                    setDraft({ ...draft, due_time: event.target.value })
                  }
                />
              </label>
            </div>
          </div>
          <label>
            Attribution
            <select
              value={draft.assignment_mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  assignment_mode: event.target
                    .value as ActionTemplate["assignment_mode"],
                })
              }
            >
              <option value="unassigned">À attribuer plus tard</option>
              <option value="fixed">Toujours le même intervenant</option>
              <option value="rotation">À tour de rôle</option>
            </select>
          </label>
          {draft.assignment_mode === "fixed" ? (
            <label>
              Intervenant
              <select
                required
                value={draft.default_assignee_id ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    default_assignee_id: event.target.value || null,
                  })
                }
              >
                <option value="">Choisir…</option>
                {data.assignees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {draft.assignment_mode === "rotation" ? (
            <fieldset className="tw-rotation">
              <legend>Tour de rôle</legend>
              <p className="tw-help">
                Sélectionnez les personnes dans l’ordre souhaité.
              </p>
              {data.assignees.map((person) => (
                <label className="tw-check-label" key={person.id}>
                  <input
                    type="checkbox"
                    checked={draft.rotation_assignee_ids.includes(person.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        rotation_assignee_ids: event.target.checked
                          ? [...draft.rotation_assignee_ids, person.id]
                          : draft.rotation_assignee_ids.filter(
                              (id) => id !== person.id,
                            ),
                      })
                    }
                  />
                  {person.name}
                  {draft.rotation_assignee_ids.includes(person.id) ? (
                    <span className="tw-pill">
                      {draft.rotation_assignee_ids.indexOf(person.id) + 1}
                    </span>
                  ) : null}
                </label>
              ))}
            </fieldset>
          ) : null}
          {data.can_edit_compensation ? (
            <details
              className="tw-advanced"
              open={draft.compensation_mode !== "none"}
            >
              <summary>Rémunération</summary>
              <CompensationFields
                mode={draft.compensation_mode}
                amount={draft.compensation_amount}
                minutes={draft.default_minutes}
                onChange={({ minutes, ...value }) =>
                  setDraft({
                    ...draft,
                    ...value,
                    ...(minutes !== undefined
                      ? { default_minutes: minutes }
                      : {}),
                  })
                }
              />
            </details>
          ) : null}
          <label className="tw-check-label">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.target.checked })
              }
            />
            Automatisation active
          </label>
        </fieldset>
      </form>
    </ReservationDetailsDrawer>
  );
}
