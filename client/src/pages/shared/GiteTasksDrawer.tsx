import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../utils/api";
import ReservationDetailsDrawer from "./ReservationDetailsDrawer";

export type GiteTaskSummary = { open_short: number; open_long: number; completed: number };

type GiteTask = {
  id: string;
  title: string;
  category: "short" | "long";
  status: "planned" | "in_progress" | "done";
  assignee_id: string | null;
  assignee_name: string | null;
  compensation_mode: "none" | "flat_rate" | "time";
  compensation_amount: number;
  spent_minutes: number | null;
  due_at: string;
  note: string;
};

type GiteTasksPayload = {
  gite: { id: string; nom: string };
  summary: GiteTaskSummary;
  shortcuts: Array<{ key: string; title: string; category: "short" | "long" }>;
  assignees: Array<{ id: string; name: string }>;
  can_manage: boolean;
  current_user_id: string | null;
  tasks: GiteTask[];
};

type DrawerProps = {
  open: boolean;
  giteId: string;
  giteName: string;
  reservationId?: string | null;
  sourceType?: "manual" | "check" | "cleaning" | "reservation";
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

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

const taskTone = (summary: GiteTaskSummary | null) =>
  summary?.open_short ? "short" : summary?.open_long ? "long" : "clear";

export const GiteTasksButton = ({
  giteId,
  giteName,
  reservationId,
  onChanged,
}: Omit<DrawerProps, "open" | "onClose">) => {
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
    <button type="button" className={`gite-tasks-button gite-tasks-button--${tone}`} aria-label={label} title={label} onClick={() => setOpen(true)}>
      <TaskHouseIcon />
      {count ? <span>{count}</span> : null}
    </button>
    <GiteTasksDrawer
      open={open}
      giteId={giteId}
      giteName={giteName}
      reservationId={reservationId}
      sourceType="reservation"
      onClose={() => setOpen(false)}
      onChanged={(nextSummary) => {
        setSummary(nextSummary);
        onChanged?.(nextSummary);
      }}
    />
  </>;
};

export default function GiteTasksDrawer({ open, giteId, giteName, reservationId, sourceType = "manual", onClose, onChanged }: DrawerProps) {
  const [data, setData] = useState<GiteTasksPayload | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"short" | "long">("short");
  const [minutes, setMinutes] = useState<Record<string, string>>({});
  const [assigneeSelections, setAssigneeSelections] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      // A suggestion becomes an attribution only after an explicit action.
      const selectedAssigneeId = assigneeSelections[task.id] ?? task.assignee_id ?? defaultAssigneeId;
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
      await apiFetch(`/action-tasks/tasks/${encodeURIComponent(task.id)}/assignment`, {
        method: "PATCH", json: { assignee_id: assigneeId },
      });
      setAssigneeSelections((current) => ({ ...current, [task.id]: assigneeId ?? "" }));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’attribuer la tâche.");
    } finally { setBusyId(null); }
  };

  const openTasks = useMemo(() => data?.tasks.filter((task) => task.status !== "done") ?? [], [data]);
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
      <section className="gite-tasks-drawer__list">
        <div className="gite-tasks-drawer__section-title"><strong>À faire</strong><span>{openTasks.length}</span></div>
        {!data ? <p className="field-hint">Chargement…</p> : !openTasks.length ? <div className="gite-tasks-drawer__empty"><TaskHouseIcon /><strong>Tout est fait</strong><span>Le gîte n’a aucune tâche en attente.</span></div> : openTasks.map((task) => {
          const selectedAssigneeId = assigneeSelections[task.id] ?? task.assignee_id ?? defaultAssigneeId;
          const selectedAssigneeName = data.assignees.find((assignee) => assignee.id === selectedAssigneeId)?.name ?? task.assignee_name ?? "";
          const canComplete = data.can_manage || selectedAssigneeId === data.current_user_id;
          return <article className={`gite-task-card gite-task-card--${task.category}`} key={task.id}>
          <button type="button" className="gite-task-card__check" disabled={Boolean(busyId) || !canComplete} onClick={() => void changeTask(task, "done")} aria-label={`Marquer ${task.title} comme réalisée${selectedAssigneeName ? ` par ${selectedAssigneeName}` : ""}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8" /></svg>
          </button>
          <div className="gite-task-card__copy">
            <strong>{task.title}</strong>
            <div className="gite-task-card__meta">
              <label className="gite-task-assignee" title={`Intervenant : ${selectedAssigneeName || "Non attribuée"}`}>
                <span className="gite-task-assignee__avatar" aria-hidden="true">{selectedAssigneeName ? initials(selectedAssigneeName) : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></svg>}</span>
                <select aria-label={`Intervenant pour ${task.title}`} value={selectedAssigneeId} disabled={Boolean(busyId) || !canComplete} onChange={(event) => void assignTask(task, event.target.value || null)}>
                  <option value="" disabled={!data.can_manage}>Non attribuée</option>
                  {task.assignee_id && !data.assignees.some((assignee) => assignee.id === task.assignee_id) ? <option value={task.assignee_id}>{task.assignee_name || "Intervenant attribué"}</option> : null}
                  {data.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}{assignee.id === data.current_user_id ? " (moi)" : ""}</option>)}
                </select>
                <svg className="gite-task-assignee__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
              </label>
            {task.compensation_mode === "flat_rate" ? <small>Forfait {task.compensation_amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</small> : null}
            {task.compensation_mode === "time" ? <label className="gite-task-card__time">Temps <input aria-label={`Minutes passées pour ${task.title}`} type="number" min={1} max={1440} inputMode="numeric" value={minutes[task.id] ?? ""} placeholder="0" onChange={(event) => setMinutes((current) => ({ ...current, [task.id]: event.target.value }))} /> min</label> : null}
            </div>
          </div>
          <span className={`gite-task-card__category gite-task-card__category--${task.category}`} role="img" aria-label={task.category === "short" ? "Tâche rapide" : "Tâche à long terme"} title={task.category === "short" ? "Tâche rapide" : "Tâche à long terme"}><TaskCategoryIcon category={task.category} /></span>
        </article>})}
      </section>

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

      {completedTasks.length ? <details className="gite-tasks-drawer__completed"><summary>{completedTasks.length} tâche{completedTasks.length > 1 ? "s" : ""} réalisée{completedTasks.length > 1 ? "s" : ""}</summary>
        <div>{completedTasks.map((task) => <article key={task.id}><span>✓</span><strong>{task.title}</strong>{data?.can_manage ? <button type="button" className="secondary" disabled={Boolean(busyId)} onClick={() => void changeTask(task, "planned")}>Rouvrir</button> : null}</article>)}</div>
      </details> : null}
    </div>
  </ReservationDetailsDrawer>;
}
