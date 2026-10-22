import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../utils/api";
import GiteTasksDrawer, { TaskEditIcon } from "./shared/GiteTasksDrawer";
import ReservationDetailsDrawer from "./shared/ReservationDetailsDrawer";
import TaskPresetsEditor from "./tasks/TaskPresetsEditor";
import { TaskAutomationDrawer, TaskCreateDrawer } from "./tasks/TaskForms";
import { CategoryIcon, TaskIcon } from "./tasks/TaskIcons";
import TaskUrgencyControl from "./tasks/TaskUrgencyControl";
import type { TaskReminderSettings, UrgencyLevel } from "./tasks/taskUrgency";
import {
  displayDate,
  type ActionResponse,
  type ActionTask,
  type ActionTemplate,
  type Category,
} from "./tasks/types";
import "./tasks/tasks.css";

type Tab = "tasks" | "presets" | "automations";
type View = "pending" | "in_progress" | "completed" | "all";
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");

function TaskRow({
  task,
  busy,
  manager,
  onEdit,
  onComplete,
  onStatus,
  onNote,
  onUrgency,
  reminderSettings,
  canEditUrgency,
}: {
  task: ActionTask;
  busy: boolean;
  manager: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onStatus: (status: "planned" | "in_progress") => void;
  onNote: (note: string) => Promise<boolean>;
  onUrgency: (level: UrgencyLevel) => void;
  reminderSettings?: TaskReminderSettings;
  canEditUrgency: boolean;
}) {
  const [note, setNote] = useState(task.note);
  const overdue =
    task.status !== "done" && new Date(task.due_at).getTime() < Date.now();
  return (
    <article className={`tw-task${task.status === "done" ? " is-done" : ""}`}>
      <div className="tw-task-line">
        <button
          type="button"
          className="tw-complete"
          aria-label={
            task.status === "done"
              ? `Rouvrir ${task.title}`
              : `Terminer ${task.title}`
          }
          title={
            task.status === "done"
              ? "Rouvrir la tâche"
              : "Marquer comme terminée"
          }
          disabled={busy || (task.status === "done" && !manager)}
          onClick={
            task.status === "done" ? () => onStatus("planned") : onComplete
          }
        >
          {task.status === "done" ? <TaskIcon name="check" /> : null}
        </button>
        <div className="tw-task-copy">
          <h3>
            {task.status === "done" ? (
              task.title
            ) : (
              <button type="button" onClick={onEdit}>
                {task.title}
              </button>
            )}
          </h3>
          <div className="tw-task-meta">
            {task.created_by_name ? <span>Créée par {task.created_by_name}</span> : null}
            <span>
              <TaskIcon name="home" />
              {task.gite_name}
            </span>
            <span className={overdue ? "tw-overdue" : ""}>
              {overdue ? "En retard · " : ""}
              {displayDate(task.due_at)}
            </span>
            {task.status === "in_progress" ? (
              <span className="tw-pill">En cours</span>
            ) : null}
            {task.template_id ? (
              <span title="Tâche issue d’une automatisation">
                <TaskIcon name="repeat" />
                <span className="tw-sr-only">Automatique</span>
              </span>
            ) : null}
          </div>
        </div>
        <span
          className={`tw-assignee${task.assignee_name ? "" : " is-unassigned"}`}
          title={task.assignee_name || "Non attribuée"}
        >
          <TaskIcon name="person" />
          <span>{task.assignee_name || "Non attribuée"}</span>
        </span>
        <div className="tw-row-actions">
          {task.category === "short" && task.status !== "done" ? <TaskUrgencyControl value={task.urgency_level ?? 0} taskTitle={task.title} stopped={task.urgency_stopped_at} disabled={busy || !canEditUrgency || !task.updated_at} settings={reminderSettings} onChange={onUrgency} /> : null}
          {task.status === "planned" ? (
            <button
              type="button"
              className="tw-text-button tw-start"
              disabled={busy}
              onClick={() => onStatus("in_progress")}
            >
              Commencer
            </button>
          ) : null}
          {task.status !== "done" ? (
            <button
              type="button"
              className="tw-icon-button"
              aria-label={`Modifier ${task.title}`}
              onClick={onEdit}
            >
              <TaskEditIcon />
            </button>
          ) : null}
        </div>
      </div>
      {task.compensation_mode !== "none" ? (
        <div className="tw-task-payment">
          {task.compensation_mode === "flat_rate"
            ? task.compensation_amount === null
              ? "Au forfait"
              : `Forfait ${task.compensation_amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`
            : `Au temps passé${task.spent_minutes ? ` · ${task.spent_minutes} min` : ""}`}
        </div>
      ) : null}
      <details className="tw-task-note">
        <summary>
          {task.note ? "Consignes et note" : "Ajouter une note"}
        </summary>
        <div>
          <textarea
            rows={2}
            maxLength={2000}
            aria-label={`Note de ${task.title}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            type="button"
            className="tw-secondary"
            disabled={busy || note === task.note}
            onClick={() => void onNote(note)}
          >
            Enregistrer la note
          </button>
        </div>
      </details>
    </article>
  );
}

export default function ActionsPanel({
  from,
  to,
  section,
}: {
  from: string;
  to: string;
  section?: Tab;
}) {
  const [data, setData] = useState<ActionResponse | null>(null);
  const [tab, setTab] = useState<Tab>(section ?? "tasks");
  useEffect(() => { if (section) setTab(section); }, [section]);
  const [view, setView] = useState<View>("pending");
  const [category, setCategory] = useState<"all" | Category>("all");
  const [giteId, setGiteId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ActionTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [automation, setAutomation] = useState<{
    template: ActionTemplate | null;
  } | null>(null);
  const [completion, setCompletion] = useState<{
    task: ActionTask;
    assignee: string;
    minutes: string;
  } | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await apiFetch<ActionResponse>(
        `/action-tasks?${new URLSearchParams({ from, to })}`,
      );
      if (id === requestId.current) {
        // Keep an already open page usable while the frontend/backend are being deployed.
        const shortcuts = result.shortcuts.map((item) => ({
          ...item,
          note: item.note ?? "",
          enabled: item.enabled ?? true,
        }));
        setData({
          ...result,
          shortcuts,
          shortcut_catalog: result.shortcut_catalog ?? shortcuts,
          can_edit_compensation: result.can_edit_compensation ?? false,
          current_user_id: result.current_user_id ?? null,
        });
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [from, to]);
  useEffect(() => {
    setError(null);
    void load().catch((reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible de charger les tâches.",
      ),
    );
  }, [load]);
  const run = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      if (success) setNotice(success);
      // A refresh failure must not invite a second creation of an already saved task.
      try {
        await load();
      } catch {
        setError(
          "Modification enregistrée, mais la liste n’a pas pu être actualisée. Rechargez la page.",
        );
      }
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible d’enregistrer cette modification.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = (task: ActionTask, status: "planned" | "in_progress") =>
    run(
      () =>
        apiFetch(`/action-tasks/tasks/${encodeURIComponent(task.id)}/status`, {
          method: "PATCH",
          json: { status },
        }),
      status === "planned" ? "Tâche rouverte." : "Tâche démarrée.",
    );
  const saveAutomation = (draft: Omit<ActionTemplate, "id">, id?: string) =>
    run(() => {
      const { compensation_amount, ...rest } = draft;
      return apiFetch(
        `/action-tasks/templates${id ? `/${encodeURIComponent(id)}` : ""}`,
        {
          method: id ? "PUT" : "POST",
          json: {
            ...rest,
            ...(data?.can_edit_compensation ? { compensation_amount } : {}),
          },
        },
      );
    }, "Automatisation enregistrée.");
  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const counts = {
    short: tasks.filter(
      (task) => task.category === "short" && task.status !== "done",
    ).length,
    long: tasks.filter(
      (task) => task.category === "long" && task.status !== "done",
    ).length,
    completed: tasks.filter((task) => task.status === "done").length,
  };
  const gites = data?.gites.length
    ? data.gites
    : Array.from(
        new Map(
          tasks.map((task) => [
            task.gite_id,
            { id: task.gite_id, nom: task.gite_name },
          ]),
        ).values(),
      );
  const people = Array.from(
    new Map(
      tasks
        .filter((task) => task.assignee_id)
        .map((task) => [
          task.assignee_id!,
          { id: task.assignee_id!, name: task.assignee_name || "Intervenant" },
        ]),
    ).values(),
  );
  const visibleTasks = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            (!giteId || task.gite_id === giteId) &&
            (!assigneeId ||
              (assigneeId === "unassigned"
                ? !task.assignee_id
                : task.assignee_id === assigneeId)) &&
            (category === "all" || task.category === category) &&
            (view === "all" ||
              (view === "pending"
                ? task.status !== "done"
                : task.status ===
                  (view === "completed" ? "done" : "in_progress"))) &&
            normalize(
              `${task.title} ${task.note} ${task.gite_name} ${task.assignee_name ?? ""}`,
            ).includes(normalize(search)),
        )
        .sort(
          (a, b) =>
            a.due_at.localeCompare(b.due_at) ||
            a.gite_name.localeCompare(b.gite_name, "fr"),
        ),
    [tasks, giteId, assigneeId, category, view, search],
  );
  const clearFilters = () => {
    setGiteId("");
    setAssigneeId("");
    setCategory("all");
    setView("pending");
    setSearch("");
  };
  const chooseMetric = (value: "short" | "long" | "completed") => {
    setTab("tasks");
    setCategory(value === "completed" ? "all" : value);
    setView(value === "completed" ? "completed" : "pending");
    setGiteId("");
    setAssigneeId("");
    setSearch("");
  };

  return (
    <div className="task-workspace" aria-busy={loading || busy}>
      <div className="tw-overview" aria-label="Résumé de la période" hidden={Boolean(section && section !== "tasks")}>
        {(
          [
            ["short", "Rapides à faire", "Les petits gestes du quotidien"],
            ["long", "À long terme", "Les projets à anticiper"],
            ["completed", "Terminées", "Le travail accompli"],
          ] as const
        ).map(([key, label, description]) => (
          <button
            type="button"
            className={`tw-metric tw-metric--${key}`}
            aria-pressed={
              tab === "tasks" &&
              (key === "completed"
                ? view === "completed"
                : view === "pending" && category === key)
            }
            key={key}
            onClick={() => chooseMetric(key)}
          >
            <span className="tw-metric-icon">
              {key === "completed" ? (
                <TaskIcon name="check" />
              ) : (
                <CategoryIcon category={key} />
              )}
            </span>
            <span>
              <strong>{data ? counts[key] : "—"}</strong>
              <span>{label}</span>
              <small>{description}</small>
            </span>
            <TaskIcon name="arrow" />
          </button>
        ))}
      </div>
      <div className="tw-navigation">
        <div className="tw-tabs" role="tablist" aria-label="Gestion des tâches" hidden={Boolean(section)}>
          {(
            [
              ["tasks", "À faire", "check"],
              ["presets", "Préenregistrées", "presets"],
              ["automations", "Automatisations", "repeat"],
            ] as const
          )
            .filter(([key]) => key === "tasks" || data?.can_manage)
            .map(([key, label, icon]) => (
              <button
                type="button"
                role="tab"
                id={`tasks-tab-${key}`}
                aria-controls={`tasks-panel-${key}`}
                aria-selected={tab === key}
                tabIndex={tab === key ? 0 : -1}
                key={key}
                onClick={() => {
                  setTab(key);
                  setError(null);
                  setNotice(null);
                }}
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const tabs = Array.from(
                    event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    ),
                  );
                  const index = tabs.indexOf(event.currentTarget);
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                          tabs.length;
                  tabs[next].focus();
                  tabs[next].click();
                }}
              >
                <TaskIcon name={icon} />
                <span>{label}</span>
              </button>
            ))}
        </div>
        {data?.can_manage && tab === "tasks" ? (
          <button
            className="tw-primary"
            type="button"
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            <TaskIcon name="plus" />
            Nouvelle tâche
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="tw-error" role="alert">
          {error}
          {!data ? (
            <button
              type="button"
              className="tw-text-button"
              onClick={() => {
                setError(null);
                void load().catch(() =>
                  setError("Impossible de charger les tâches. Réessayez."),
                );
              }}
            >
              Réessayer
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <div className="tw-notice" role="status">
          <TaskIcon name="check" />
          {notice}
          <button
            type="button"
            className="tw-text-button"
            aria-label="Masquer la confirmation"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <div
        role="tabpanel"
        id={`tasks-panel-${tab}`}
        aria-labelledby={`tasks-tab-${tab}`}
      >
        {tab === "tasks" ? (
          <>
            <div
              className={`tw-toolbar${filtersOpen ? " tw-toolbar--expanded" : ""}`}
            >
              <label className="tw-search">
                <TaskIcon name="search" />
                <input
                  type="search"
                  aria-label="Rechercher une tâche"
                  placeholder="Une tâche, un gîte, une personne…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="tw-secondary tw-filter-toggle"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                Filtres{giteId || assigneeId ? " •" : ""}
              </button>
              <label className="tw-filter">
                <span className="tw-sr-only">Filtrer par gîte</span>
                <select
                  aria-label="Filtrer par gîte"
                  value={giteId}
                  onChange={(event) => setGiteId(event.target.value)}
                >
                  <option value="">Tous les gîtes</option>
                  {gites.map((gite) => (
                    <option key={gite.id} value={gite.id}>
                      {gite.nom}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tw-filter">
                <span className="tw-sr-only">Filtrer par intervenant</span>
                <select
                  aria-label="Filtrer par intervenant"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                >
                  <option value="">Tous les intervenants</option>
                  <option value="unassigned">Non attribuées</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tw-list-options">
              <div
                className="tw-segments"
                role="group"
                aria-label="État des tâches"
              >
                {(
                  [
                    ["pending", "À faire"],
                    ["in_progress", "En cours"],
                    ["completed", "Terminées"],
                    ["all", "Toutes"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={view === value}
                    onClick={() => setView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="tw-filter">
                <select
                  aria-label="Filtrer par catégorie"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as typeof category)
                  }
                >
                  <option value="all">Toutes les catégories</option>
                  <option value="short">Rapides</option>
                  <option value="long">Long terme</option>
                </select>
              </label>
            </div>
            {loading && !data ? (
              <div className="tw-empty" role="status">
                Chargement des tâches…
              </div>
            ) : !data ? null : !visibleTasks.length ? (
              <div className="tw-empty">
                <TaskIcon name="check" />
                <h3>
                  {tasks.length
                    ? "Aucune tâche dans cette sélection"
                    : "Tout est en ordre"}
                </h3>
                <p>
                  {tasks.length
                    ? "Changez de filtre pour retrouver vos tâches."
                    : "Ajoutez ce qu’il faut faire, même lorsque c’est un tout petit détail."}
                </p>
                {tasks.length ? (
                  <button
                    type="button"
                    className="tw-secondary"
                    onClick={clearFilters}
                  >
                    Réinitialiser les filtres
                  </button>
                ) : data?.can_manage ? (
                  <button
                    className="tw-primary"
                    type="button"
                    onClick={() => setCreating(true)}
                  >
                    Créer une tâche
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="tw-results">
                  {visibleTasks.length} tâche
                  {visibleTasks.length > 1 ? "s" : ""} affichée
                  {visibleTasks.length > 1 ? "s" : ""}
                  {giteId ||
                  assigneeId ||
                  search ||
                  category !== "all" ||
                  view !== "pending" ? (
                    <button
                      className="tw-text-button"
                      type="button"
                      onClick={clearFilters}
                    >
                      Réinitialiser
                    </button>
                  ) : null}
                </div>
                {(["short", "long"] as const).map((kind) => {
                  const group = visibleTasks.filter(
                    (task) => task.category === kind,
                  );
                  return group.length ? (
                    <section
                      className={`tw-group tw-group--${kind}`}
                      key={kind}
                    >
                      <header>
                        <span
                          className={`tw-category-icon tw-category-icon--${kind}`}
                        >
                          <CategoryIcon category={kind} />
                        </span>
                        <div>
                          <h2>
                            {kind === "short"
                              ? "Tâches rapides"
                              : "À long terme"}{" "}
                            <span>{group.length}</span>
                          </h2>
                          <p>
                            {kind === "short"
                              ? "Les petites attentions qui font la différence."
                              : "À planifier, sans perdre le fil."}
                          </p>
                        </div>
                      </header>
                      <div className="tw-task-list">
                        {group.map((task) => (
                          <TaskRow
                            key={`${task.id}:${task.note}`}
                            task={task}
                            busy={busy}
                            manager={Boolean(data?.can_manage)}
                            reminderSettings={data?.reminder_settings}
                            canEditUrgency={Boolean(data?.can_manage || !task.assignee_id || task.assignee_id === data?.current_user_id)}
                            onUrgency={(urgency_level) => void run(() => apiFetch(`/action-tasks/tasks/${encodeURIComponent(task.id)}/urgency`, { method: "PATCH", json: { urgency_level, expected_updated_at: task.updated_at } }))}
                            onEdit={() => setSelectedTask(task)}
                            onComplete={() => {
                              setError(null);
                              setCompletion({
                                task,
                                assignee:
                                  task.assignee_id ||
                                  data?.assignees.find(
                                    (person) =>
                                      person.id === data.current_user_id,
                                  )?.id ||
                                  "",
                                minutes: String(task.spent_minutes ?? ""),
                              });
                            }}
                            onStatus={(status) =>
                              void changeStatus(task, status)
                            }
                            onNote={(note) =>
                              run(
                                () =>
                                  apiFetch(
                                    `/action-tasks/tasks/${encodeURIComponent(task.id)}/note`,
                                    { method: "PATCH", json: { note } },
                                  ),
                                "Note enregistrée.",
                              )
                            }
                          />
                        ))}
                      </div>
                    </section>
                  ) : null;
                })}
              </>
            )}
          </>
        ) : tab === "presets" && data ? (
          <TaskPresetsEditor
            items={data.shortcut_catalog}
            busy={busy}
            error={error}
            onSave={(shortcuts) =>
              run(async () => {
                const result = await apiFetch<{
                  shortcuts: ActionResponse["shortcuts"];
                }>("/action-tasks/shortcuts", {
                  method: "PUT",
                  json: {
                    shortcuts,
                    expected_shortcuts: data.shortcut_catalog,
                  },
                });
                setData((current) =>
                  current
                    ? {
                        ...current,
                        shortcut_catalog: result.shortcuts,
                        shortcuts: result.shortcuts.filter(
                          (item) => item.enabled,
                        ),
                      }
                    : current,
                );
              }, "Bibliothèque mise à jour. Les raccourcis sont disponibles dans tous les gîtes.")
            }
          />
        ) : tab === "automations" && data ? (
          <section className="tw-library">
            <div className="tw-section-heading">
              <div>
                <h2>Au rythme des séjours</h2>
                <p>
                  Les tâches créées automatiquement à chaque arrivée ou départ.
                </p>
              </div>
              <button
                type="button"
                className="tw-primary"
                onClick={() => {
                  setError(null);
                  setAutomation({ template: null });
                }}
              >
                <TaskIcon name="plus" />
                Nouvelle automatisation
              </button>
            </div>
            <div className="tw-library-info">
              <TaskIcon name="repeat" />
              <p>
                Une automatisation est liée à{" "}
                <strong>un gîte et un événement</strong>. Ses dates, son
                attribution et sa rémunération sont définies une fois, puis
                reprises à chaque séjour. Une mise en pause arrête la génération
                sans supprimer les tâches existantes.
              </p>
            </div>
            {data.templates.length ? (
              <div className="tw-automation-list">
                {data.templates.map((template) => (
                  <article className="tw-automation" key={template.id}>
                    <span
                      className={`tw-category-icon tw-category-icon--${template.category}`}
                    >
                      <CategoryIcon category={template.category} />
                    </span>
                    <div>
                      <h3>{template.title}</h3>
                      <p>
                        {
                          data.gites.find(
                            (gite) => gite.id === template.gite_id,
                          )?.nom
                        }{" "}
                        · À chaque{" "}
                        {template.trigger_event === "arrival"
                          ? "arrivée"
                          : "départ"}
                      </p>
                      <small>
                        {template.assignment_mode === "rotation"
                          ? "À tour de rôle"
                          : template.assignment_mode === "fixed"
                            ? data.assignees.find(
                                (person) =>
                                  person.id === template.default_assignee_id,
                              )?.name || "Intervenant habituel"
                            : "À attribuer plus tard"}{" "}
                        · Échéance{" "}
                        {template.due_offset_days === 0
                          ? "le jour même"
                          : template.due_offset_days === -1
                            ? "la veille"
                            : template.due_offset_days === 1
                              ? "le lendemain"
                              : `J${template.due_offset_days > 0 ? "+" : ""}${template.due_offset_days}`}{" "}
                        à {template.due_time}
                      </small>
                    </div>
                    <button
                      type="button"
                      className={`tw-pill tw-toggle${template.enabled ? "" : " tw-pill--muted"}`}
                      disabled={busy}
                      aria-label={`${template.enabled ? "Mettre en pause" : "Activer"} ${template.title}`}
                      onClick={() =>
                        void saveAutomation(
                          { ...template, enabled: !template.enabled },
                          template.id,
                        )
                      }
                    >
                      {template.enabled ? "Active" : "En pause"}
                    </button>
                    <button
                      className="tw-icon-button"
                      type="button"
                      aria-label={`Modifier l’automatisation ${template.title}`}
                      onClick={() => {
                        setError(null);
                        setAutomation({ template });
                      }}
                    >
                      <TaskEditIcon />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="tw-empty">
                <TaskIcon name="repeat" />
                <h3>Moins de répétitions, plus de sérénité</h3>
                <p>
                  Préparation du linge, vérification des équipements…
                  automatisez ce qui revient à chaque séjour.
                </p>
                <button
                  type="button"
                  className="tw-secondary"
                  onClick={() => setAutomation({ template: null })}
                >
                  Créer une automatisation
                </button>
              </div>
            )}
          </section>
        ) : null}
      </div>
      {selectedTask ? (
        <GiteTasksDrawer
          open
          giteId={selectedTask.gite_id}
          giteName={selectedTask.gite_name}
          initialTaskId={selectedTask.id}
          onClose={() => setSelectedTask(null)}
          onChanged={() =>
            void load().catch(() =>
              setError("Impossible d’actualiser la liste."),
            )
          }
        />
      ) : null}
      {creating && data ? (
        <TaskCreateDrawer
          data={data}
          busy={busy}
          error={error}
          giteId={giteId}
          onClose={() => setCreating(false)}
          onCreate={(payload) =>
            run(
              () =>
                apiFetch("/action-tasks/tasks", {
                  method: "POST",
                  json: payload,
                }),
              "Tâche créée.",
            )
          }
        />
      ) : null}
      {automation && data ? (
        <TaskAutomationDrawer
          data={data}
          busy={busy}
          error={error}
          template={automation.template}
          onClose={() => setAutomation(null)}
          onSave={saveAutomation}
        />
      ) : null}
      {completion ? (
        <ReservationDetailsDrawer
          open
          className="tw-form-drawer"
          eyebrow={completion.task.gite_name}
          title="Terminer la tâche"
          busy={busy}
          onClose={() => setCompletion(null)}
          footer={
            <>
              <button
                type="button"
                className="tw-secondary"
                disabled={busy}
                onClick={() => setCompletion(null)}
              >
                Annuler
              </button>
              <button
                form="task-complete-form"
                type="submit"
                className="tw-primary"
                disabled={busy}
              >
                <TaskIcon name="check" />
                Confirmer
              </button>
            </>
          }
        >
          <form
            id="task-complete-form"
            className="tw-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const saved = await run(async () => {
                if (completion.assignee !== (completion.task.assignee_id ?? ""))
                  await apiFetch(
                    `/action-tasks/tasks/${encodeURIComponent(completion.task.id)}/assignment`,
                    {
                      method: "PATCH",
                      json: { assignee_id: completion.assignee || null },
                    },
                  );
                await apiFetch(
                  `/action-tasks/tasks/${encodeURIComponent(completion.task.id)}/status`,
                  {
                    method: "PATCH",
                    json: {
                      status: "done",
                      ...(completion.task.compensation_mode === "time"
                        ? { spent_minutes: Number(completion.minutes) }
                        : {}),
                    },
                  },
                );
              }, "Tâche terminée. Merci !");
              if (saved) setCompletion(null);
            }}
          >
            <h3>{completion.task.title}</h3>
            {error ? (
              <p className="tw-error" role="alert">
                {error}
              </p>
            ) : null}
            {data?.can_manage ? (
              <label>
                Réalisée par
                <select
                  required={completion.task.compensation_mode !== "none"}
                  value={completion.assignee}
                  onChange={(event) =>
                    setCompletion({
                      ...completion,
                      assignee: event.target.value,
                    })
                  }
                >
                  <option value="">Non attribuée</option>
                  {data.assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <span className="tw-help">
                  Vérifiez la personne avant de confirmer.
                </span>
              </label>
            ) : (
              <p>Réalisée par {completion.task.assignee_name || "vous"}.</p>
            )}
            {completion.task.compensation_mode === "time" ? (
              <label>
                Temps réellement passé (minutes)
                <input
                  autoFocus
                  required
                  type="number"
                  min="1"
                  max="1440"
                  value={completion.minutes}
                  onChange={(event) =>
                    setCompletion({
                      ...completion,
                      minutes: event.target.value,
                    })
                  }
                />
              </label>
            ) : null}
            {completion.task.compensation_mode === "flat_rate" &&
            completion.task.compensation_amount !== null ? (
              <p className="tw-help">
                Forfait :{" "}
                {completion.task.compensation_amount.toLocaleString("fr-FR", {
                  style: "currency",
                  currency: "EUR",
                })}
              </p>
            ) : null}
          </form>
        </ReservationDetailsDrawer>
      ) : null}
    </div>
  );
}
