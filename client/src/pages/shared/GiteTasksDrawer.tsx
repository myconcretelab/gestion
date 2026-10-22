import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../utils/api";
import ReservationDetailsDrawer from "./ReservationDetailsDrawer";
import TaskUrgencyControl from "../tasks/TaskUrgencyControl";
import type { TaskReminderSettings, UrgencyLevel } from "../tasks/taskUrgency";

export type GiteTaskSummary = { open_short: number; open_long: number; completed: number };

type GiteTask = {
  created_by_id?: string | null;
  created_by_name?: string | null;
  id: string;
  title: string;
  category: "short" | "long";
  status: "planned" | "in_progress" | "done";
  assignee_id: string | null;
  assignee_name: string | null;
  compensation_mode: "none" | "flat_rate" | "time";
  compensation_amount: number | null;
  spent_minutes: number | null;
  due_at: string;
  note: string;
  updated_at: string;
  urgency_level?: UrgencyLevel;
  urgency_stopped_at?: string | null;
  urgency_first_sent_at?: string | null;
};

type GiteTasksPayload = {
  gite: { id: string; nom: string };
  summary: GiteTaskSummary;
  shortcuts: Array<{ key: string; title: string; category: "short" | "long" }>;
  assignees: Array<{ id: string; name: string }>;
  can_manage: boolean;
  current_user_id: string | null;
  can_edit_compensation: boolean;
  tasks: GiteTask[];
  reminder_settings?: TaskReminderSettings;
};

type DrawerProps = {
  open: boolean;
  giteId: string;
  giteName: string;
  reservationId?: string | null;
  sourceType?: "manual" | "check" | "cleaning" | "reservation";
  initialTaskId?: string;
  onClose: () => void;
  onChanged?: (summary: GiteTaskSummary) => void;
};

const TaskHouseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="m8.5 10.5 2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TaskCategoryIcon = ({ category }: { category: "short" | "long" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {category === "short" ? <path d="m13 3-9 11h7l-1 7 10-12h-7l1-6Z" /> : <><path d="M6 3h12M6 21h12M7 3v4c0 3 10 7 10 10v4M17 3v4c0 3-10 7-10 10v4" /><path d="m8 18 4-3 4 3" /></>}
  </svg>
);

const PersonIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></svg>;
export const TaskEditIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" /></svg>;
type TaskEditDraft = {
  urgency_level: UrgencyLevel;
  task: GiteTask;
  title: string;
  category: "short" | "long";
  assignee_id: string;
  due_day: string;
  due_time: string;
  note: string;
  compensation_mode: "none" | "flat_rate" | "time";
  compensation_amount: number | null;
};
const taskDraft = (task: GiteTask): TaskEditDraft => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(task.due_at)).map(({ type, value }) => [type, value]));
  return { task, urgency_level: task.urgency_level ?? 0, title: task.title, category: task.category, assignee_id: task.assignee_id ?? "", due_day: `${parts.year}-${parts.month}-${parts.day}`, due_time: `${parts.hour}:${parts.minute}`, note: task.note, compensation_mode: task.compensation_mode, compensation_amount: task.compensation_amount };
};

const taskTone = (summary: GiteTaskSummary | null) =>
  summary?.open_short ? "short" : summary?.open_long ? "long" : "clear";

export const GiteTasksButton = ({
  giteId,
  giteName,
  reservationId,
  onChanged,
  displayName,
}: Omit<DrawerProps, "open" | "onClose"> & { displayName?: string }) => {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<GiteTaskSummary | null>(null);

  const loadSummary = useCallback(async () => {
    if (!giteId) return;
    try {
      const payload = await apiFetch<GiteTasksPayload>(`/action-tasks/gites/${encodeURIComponent(giteId)}`);
      setSummary(payload.summary);
    } catch {
      setSummary(null);
    }
  }, [giteId]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const tone = taskTone(summary);
  const count = (summary?.open_short ?? 0) + (summary?.open_long ?? 0);
  const label = count
    ? `${count} tâche${count > 1 ? "s" : ""} à faire dans ${giteName}`
    : `Toutes les tâches de ${giteName} sont réalisées`;

  return <>
    <button type="button" className={`gite-tasks-button gite-tasks-button--${tone}${displayName ? " gite-tasks-button--labeled" : ""}`} aria-label={label} title={label} onClick={() => setOpen(true)}>
      <TaskHouseIcon />
      {displayName ? <strong className="gite-tasks-button__label">{displayName}</strong> : null}
      {count ? <span>{count}</span> : null}
    </button>
    <GiteTasksDrawer
      open={open}
      giteId={giteId}
      giteName={giteName}
      reservationId={reservationId}
      sourceType={reservationId ? "reservation" : "manual"}
      onClose={() => setOpen(false)}
      onChanged={(nextSummary) => {
        setSummary(nextSummary);
        onChanged?.(nextSummary);
      }}
    />
  </>;
};

export default function GiteTasksDrawer({ open, giteId, giteName, reservationId, sourceType = "manual", initialTaskId, onClose, onChanged }: DrawerProps) {
  const [data, setData] = useState<GiteTasksPayload | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"short" | "long">("short");
  const [minutes, setMinutes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<TaskEditDraft | null>(null);
  const initialEditorOpenedRef = useRef<string | null>(null);
  const onChangedRef = useRef(onChanged);
  const defaultAssigneeId = data?.assignees.find((assignee) => assignee.id === data.current_user_id)?.id ?? "";

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const load = useCallback(async () => {
    if (!open || !giteId) return;
    setError(null);
    try {
      const payload = await apiFetch<GiteTasksPayload>(`/action-tasks/gites/${encodeURIComponent(giteId)}`);
      setData(payload);
      setMinutes(Object.fromEntries(payload.tasks.filter((task) => task.spent_minutes).map((task) => [task.id, String(task.spent_minutes)])));
      onChangedRef.current?.(payload.summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger les tâches.");
    }
  }, [giteId, open]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setEditor(null);
    initialEditorOpenedRef.current = null;
  }, [open, giteId]);

  useEffect(() => {
    if (!open || !initialTaskId || data?.gite.id !== giteId || initialEditorOpenedRef.current === initialTaskId) return;
    const task = data.tasks.find((item) => item.id === initialTaskId && item.status !== "done");
    if (task) {
      initialEditorOpenedRef.current = initialTaskId;
      setEditor(taskDraft(task));
    }
  }, [data, giteId, initialTaskId, open]);

  const saveEdit = async () => {
    if (!editor) return;
    setBusyId(editor.task.id); setError(null);
    try {
      const { task, compensation_mode, compensation_amount, ...draft } = editor;
      await apiFetch(`/action-tasks/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH", json: {
          ...draft, assignee_id: draft.assignee_id || null, expected_updated_at: task.updated_at,
          ...(data?.can_edit_compensation ? { compensation_mode, compensation_amount } : {}),
        },
      });
      setEditor(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer la tâche.");
    } finally { setBusyId(null); }
  };

  const addTask = async (taskTitle: string, taskCategory: "short" | "long", shortcutKey?: string) => {
    if (!taskTitle.trim()) return;
    setBusyId(shortcutKey ? `shortcut:${shortcutKey}` : "new"); setError(null);
    try {
      await apiFetch("/action-tasks/tasks/quick", {
        method: "POST",
        json: {
          gite_id: giteId,
          reservation_id: reservationId ?? null,
          title: taskTitle,
          category: taskCategory,
          urgency_level: 0,
          shortcut_key: shortcutKey ?? null,
          source_type: sourceType,
        },
      });
      setTitle("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’ajouter la tâche.");
    } finally { setBusyId(null); }
  };

  const changeUrgency = async (task: GiteTask, urgency_level: UrgencyLevel) => {
    setBusyId(task.id); setError(null);
    try {
      const saved = await apiFetch<GiteTask>(`/action-tasks/tasks/${encodeURIComponent(task.id)}/urgency`, {
        method: "PATCH", json: { urgency_level, expected_updated_at: task.updated_at },
      });
      setData((current) => current ? { ...current, tasks: current.tasks.map((row) => row.id === saved.id ? saved : row) } : current);
      setEditor((current) => current?.task.id === saved.id ? { ...current, task: saved, urgency_level: saved.urgency_level ?? 0 } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de modifier l’urgence de cette tâche.");
    } finally { setBusyId(null); }
  };

  const changeTask = async (task: GiteTask, status: "planned" | "done") => {
    const spentMinutes = task.compensation_mode === "time" && status === "done"
      ? Number(minutes[task.id] ?? task.spent_minutes ?? 0)
      : undefined;
    if (task.compensation_mode === "time" && status === "done" && (!Number.isInteger(spentMinutes) || (spentMinutes ?? 0) < 1)) {
      setError("Indiquez le nombre de minutes réellement passées.");
      return;
    }
    setBusyId(task.id); setError(null);
    try {
      // Completing an unassigned task explicitly attributes it to the current user.
      const selectedAssigneeId = task.assignee_id ?? defaultAssigneeId;
      if (status === "done" && !task.assignee_id && selectedAssigneeId) {
        await apiFetch(`/action-tasks/tasks/${encodeURIComponent(task.id)}/assignment`, {
          method: "PATCH", json: { assignee_id: selectedAssigneeId },
        });
      }
      await apiFetch(`/action-tasks/tasks/${encodeURIComponent(task.id)}/status`, {
        method: "PATCH", json: { status, ...(spentMinutes ? { spent_minutes: spentMinutes } : {}) },
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de modifier la tâche.");
    } finally { setBusyId(null); }
  };

  const assignTask = async (task: GiteTask, assigneeId: string | null) => {
    setBusyId(task.id); setError(null);
    try {
      const saved = await apiFetch<GiteTask>(`/action-tasks/tasks/${encodeURIComponent(task.id)}/assignment`, {
        method: "PATCH", json: { assignee_id: assigneeId },
      });
      setData((current) => current ? { ...current, tasks: current.tasks.map((row) => row.id === saved.id ? saved : row) } : current);
      setEditor((current) => current?.task.id === saved.id ? { ...current, task: saved, assignee_id: saved.assignee_id ?? "" } : current);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’attribuer la tâche.");
    } finally { setBusyId(null); }
  };

  const openTasks = useMemo(() => (data?.tasks.filter((task) => task.status !== "done") ?? []).sort((a, b) =>
    Number(b.category === "short") - Number(a.category === "short") || a.due_at.localeCompare(b.due_at)), [data]);
  const completedTasks = useMemo(() => data?.tasks.filter((task) => task.status === "done") ?? [], [data]);

  return <ReservationDetailsDrawer
    open={open}
    className="reservation-details-drawer--tasks"
    title={giteName}
    eyebrow="Tâches du gîte"
    busy={Boolean(busyId)}
    onClose={onClose}
  >
    <div className="gite-tasks-drawer">
      {error ? <div className="note" role="alert">{error}</div> : null}
      <section className="gite-tasks-drawer__quick">
        <div><strong>Ajout rapide</strong><span>Une pression suffit</span></div>
        <div className="gite-tasks-drawer__shortcuts">
          {(data?.shortcuts ?? []).map((shortcut) => <button
            type="button"
            key={shortcut.key}
            disabled={Boolean(busyId)}
            className={`gite-task-shortcut gite-task-shortcut--${shortcut.category}`}
            onClick={() => void addTask(shortcut.title, shortcut.category, shortcut.key)}
          >+ {shortcut.title.replace(/^Apporter (?:du |des |de la )?/, "").replace(/^Prévoir une /, "")}</button>)}
        </div>
      </section>

      <form className="gite-tasks-drawer__create" onSubmit={(event) => { event.preventDefault(); void addTask(title, category); }}>
        <input value={title} maxLength={120} placeholder="Une autre tâche…" aria-label="Nouvelle tâche" onChange={(event) => setTitle(event.target.value)} />
        <div className="gite-tasks-drawer__category" role="group" aria-label="Durée de la tâche">
          <button type="button" aria-pressed={category === "short"} className={category === "short" ? "is-selected" : ""} onClick={() => setCategory("short")}><TaskCategoryIcon category="short" />Rapide</button>
          <button type="button" aria-pressed={category === "long"} className={category === "long" ? "is-selected" : ""} onClick={() => setCategory("long")}><TaskCategoryIcon category="long" />Long terme</button>
        </div>
        <button type="submit" disabled={Boolean(busyId) || title.trim().length < 2}>Ajouter</button>
      </form>

      <section className="gite-tasks-drawer__list">
        <div className="gite-tasks-drawer__section-title"><strong>À faire</strong><span>{openTasks.length}</span></div>
        {!data ? <p className="field-hint">Chargement…</p> : !openTasks.length ? <div className="gite-tasks-drawer__empty"><TaskHouseIcon /><strong>Tout est fait</strong><span>Le gîte n’a aucune tâche en attente.</span></div> : openTasks.map((task) => {
          const selectedAssigneeId = task.assignee_id ?? "";
          const selectedAssigneeName = data.assignees.find((assignee) => assignee.id === selectedAssigneeId)?.name ?? task.assignee_name ?? (task.assignee_id ? "Intervenant attribué" : "");
          const canComplete = data.can_manage || task.assignee_id === data.current_user_id || (!task.assignee_id && Boolean(defaultAssigneeId));
          const canEdit = data.can_manage || !task.assignee_id || task.assignee_id === data.current_user_id;
          return <article className={`gite-task-card gite-task-card--${task.category}`} key={task.id}>
          <button type="button" className="gite-task-card__check" disabled={Boolean(busyId) || !canComplete} onClick={() => void changeTask(task, "done")} aria-label={`Marquer ${task.title} comme réalisée${selectedAssigneeName ? ` par ${selectedAssigneeName}` : ""}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8" /></svg>
          </button>
          <div className="gite-task-card__copy">
            <div className="gite-task-card__title-row">
              <span className={`gite-task-card__category gite-task-card__category--${task.category}`} role="img" aria-label={task.category === "short" ? "Tâche rapide" : "Tâche à long terme"} title={task.category === "short" ? "Tâche rapide" : "Tâche à long terme"}><TaskCategoryIcon category={task.category} /></span>
              {canEdit ? <button type="button" className="gite-task-card__title" onClick={() => setEditor(taskDraft(task))} disabled={Boolean(busyId)}>{task.title}</button> : <strong className="gite-task-card__title">{task.title}</strong>}
              <label className="gite-task-assignee gite-task-assignee--icon" title={`Intervenant : ${selectedAssigneeName || "Non attribuée"}`}>
                <PersonIcon />
                {selectedAssigneeId ? <span className="gite-task-assignee__dot" aria-hidden="true" /> : null}
                <select aria-label={`Intervenant pour ${task.title} : ${selectedAssigneeName || "Non attribuée"}`} value={selectedAssigneeId} disabled={Boolean(busyId) || !canComplete} onChange={(event) => void assignTask(task, event.target.value || null)}>
                  <option value="" disabled={!data.can_manage}>Non attribuée</option>
                  {task.assignee_id && !data.assignees.some((assignee) => assignee.id === task.assignee_id) ? <option value={task.assignee_id}>{task.assignee_name || "Intervenant attribué"}</option> : null}
                  {data.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}{assignee.id === data.current_user_id ? " (moi)" : ""}</option>)}
                </select>
              </label>
              {task.category === "short" ? <TaskUrgencyControl value={task.urgency_level ?? 0} taskTitle={task.title} stopped={task.urgency_stopped_at} disabled={Boolean(busyId) || !canEdit} settings={data.reminder_settings} onChange={(level) => void changeUrgency(task, level)} /> : null}
              {canEdit ? <button type="button" className="gite-task-card__edit" aria-label={`Modifier ${task.title}`} title="Modifier la tâche" disabled={Boolean(busyId)} onClick={() => setEditor(taskDraft(task))}><TaskEditIcon /></button> : null}
            </div>
            {task.compensation_mode !== "none" ?
            <div className="gite-task-card__meta">
            {task.compensation_mode === "flat_rate" ? <small>Forfait{task.compensation_amount !== null ? ` ${task.compensation_amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}</small> : null}
            {task.compensation_mode === "time" ? <label className="gite-task-card__time">Temps <input aria-label={`Minutes passées pour ${task.title}`} type="number" min={1} max={1440} inputMode="numeric" value={minutes[task.id] ?? ""} placeholder="0" onChange={(event) => setMinutes((current) => ({ ...current, [task.id]: event.target.value }))} /> min</label> : null}
            </div> : null}
          </div>
          {editor?.task.id === task.id ? <form className="gite-task-editor" aria-label="Modifier la tâche" onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}>
            <div className="gite-task-editor__heading"><strong>Modifier la tâche</strong><span>Les changements concernent cette tâche uniquement.</span></div>
            <label className="field gite-task-editor__wide">Intitulé<input autoFocus required minLength={2} maxLength={120} value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
            <label className="field">Catégorie<select value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value as TaskEditDraft["category"] })}><option value="short">Rapide</option><option value="long">Long terme</option></select></label>
            {editor.category === "short" ? <div className="gite-task-editor__wide task-urgency-field"><TaskUrgencyControl value={editor.urgency_level} onChange={(urgency_level) => setEditor({ ...editor, urgency_level })} disabled={Boolean(busyId)} settings={data.reminder_settings} showHint /></div> : null}
            <label className="field">Intervenant<select value={editor.assignee_id} onChange={(event) => setEditor({ ...editor, assignee_id: event.target.value })}><option value="" disabled={!data.can_manage && editor.task.assignee_id !== null}>Non attribuée</option>{editor.task.assignee_id && !data.assignees.some((assignee) => assignee.id === editor.task.assignee_id) ? <option value={editor.task.assignee_id}>{editor.task.assignee_name || "Intervenant attribué"}</option> : null}{data.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label>
            <label className="field">Échéance<input type="date" required value={editor.due_day} onChange={(event) => setEditor({ ...editor, due_day: event.target.value })} /></label>
            <label className="field">Heure<input type="time" required value={editor.due_time} onChange={(event) => setEditor({ ...editor, due_time: event.target.value })} /></label>
            <label className="field gite-task-editor__wide">Consignes<textarea rows={2} maxLength={2000} value={editor.note} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></label>
            <label className="field">Rémunération<select disabled={!data.can_edit_compensation} value={editor.compensation_mode} onChange={(event) => setEditor({ ...editor, compensation_mode: event.target.value as TaskEditDraft["compensation_mode"] })}><option value="none">Aucune</option><option value="flat_rate">Forfait</option><option value="time">Temps passé</option></select></label>
            {editor.compensation_mode === "flat_rate" && data.can_edit_compensation ? <label className="field">Forfait (€)<input type="number" required min={0.01} max={100000} step="0.01" value={editor.compensation_amount ?? ""} onChange={(event) => setEditor({ ...editor, compensation_amount: Number(event.target.value) })} /></label> : null}
            {editor.compensation_mode === "time" ? <p className="field-hint">Les minutes réellement passées seront saisies à la réalisation.</p> : null}
            <div className="gite-task-editor__actions"><button type="button" className="secondary" disabled={Boolean(busyId)} onClick={() => setEditor(null)}>Annuler</button><button type="submit" disabled={Boolean(busyId) || editor.title.trim().length < 2}>{busyId === task.id ? "Enregistrement…" : "Enregistrer"}</button></div>
          </form> : null}
        </article>})}
      </section>

      {completedTasks.length ? <details className="gite-tasks-drawer__completed"><summary>{completedTasks.length} tâche{completedTasks.length > 1 ? "s" : ""} réalisée{completedTasks.length > 1 ? "s" : ""}</summary>
        <div>{completedTasks.map((task) => <article key={task.id}><span>✓</span><strong>{task.title}</strong>{data?.can_manage ? <button type="button" className="secondary" disabled={Boolean(busyId)} onClick={() => void changeTask(task, "planned")}>Rouvrir</button> : null}</article>)}</div>
      </details> : null}
    </div>
  </ReservationDetailsDrawer>;
}
