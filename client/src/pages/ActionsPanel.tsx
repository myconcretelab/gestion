import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import GiteTasksDrawer, { TaskEditIcon } from "./shared/GiteTasksDrawer";

type AssignmentMode = "unassigned" | "fixed" | "rotation";
type ActionStatus = "planned" | "in_progress" | "done";
type ActionTask = {
  id: string; title: string; gite_id: string; gite_name: string; assignee_id: string | null; assignee_name: string | null;
  status: ActionStatus; starts_at: string; due_at: string; note: string; template_id: string | null;
  category: "short" | "long"; compensation_mode: "none" | "flat_rate" | "time";
  compensation_amount: number | null; spent_minutes: number | null;
};
type ActionTemplate = {
  id: string; gite_id: string; title: string; trigger_event: "arrival" | "departure";
  starts_offset_days: number; due_offset_days: number; start_time: string; due_time: string;
  assignment_mode: AssignmentMode; default_assignee_id: string | null;
  rotation_assignee_ids: string[]; enabled: boolean;
  category: "short" | "long"; compensation_mode: "none" | "flat_rate" | "time";
  compensation_amount: number; default_minutes: number | null;
};
type ActionResponse = {
  tasks: ActionTask[]; templates: ActionTemplate[]; gites: { id: string; nom: string }[];
  assignees: { id: string; name: string }[]; can_manage: boolean;
  shortcuts: Array<{ key: string; title: string; category: "short" | "long" }>;
};
type TemplateDraft = Omit<ActionTemplate, "id">;
const emptyTemplate = (giteId: string): TemplateDraft => ({
  gite_id: giteId, title: "", trigger_event: "departure", starts_offset_days: 0,
  due_offset_days: 0, start_time: "09:00", due_time: "17:00", assignment_mode: "unassigned",
  default_assignee_id: null, rotation_assignee_ids: [], enabled: true,
  category: "short", compensation_mode: "none", compensation_amount: 0, default_minutes: null,
});
const parisDay = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const displayDate = (value: string) => new Date(value).toLocaleString("fr-FR", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
});
const statusLabel: Record<ActionStatus, string> = { planned: "À faire", in_progress: "En cours", done: "Terminée" };

export default function ActionsPanel({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<ActionResponse | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(emptyTemplate(""));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manual, setManual] = useState({ gite_id: "", title: "", start_day: parisDay(), start_time: "09:00",
    due_day: parisDay(), due_time: "17:00", assignee_id: "", note: "", category: "short" as "short" | "long",
    compensation_mode: "none" as "none" | "flat_rate" | "time", compensation_amount: 0, spent_minutes: null as number | null });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});
  const [view, setView] = useState<"pending" | "all" | "completed">("pending");
  const [categoryView, setCategoryView] = useState<"all" | "short" | "long">("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ActionTask | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await apiFetch<ActionResponse>(`/action-tasks?${new URLSearchParams({ from, to })}`);
      setData(result);
      setNotes(Object.fromEntries(result.tasks.map((task) => [task.id, task.note])));
      setTimeDrafts(Object.fromEntries(result.tasks.filter((task) => task.spent_minutes).map((task) => [task.id, String(task.spent_minutes)])));
      setDraft((current) => current.gite_id ? current : { ...current, gite_id: result.gites[0]?.id ?? "" });
      setManual((current) => current.gite_id ? current : { ...current, gite_id: result.gites[0]?.id ?? "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les actions."); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const visibleTasks = useMemo(() => (data?.tasks ?? []).filter((task) =>
    (categoryView === "all" || task.category === categoryView)
    && (view === "all" || (view === "pending" ? task.status !== "done" : task.status === "done")))
    .sort((a, b) => Number(b.category === "short") - Number(a.category === "short") || a.due_at.localeCompare(b.due_at)), [categoryView, data, view]);

  const run = async (operation: () => Promise<void>, success?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await operation(); await load(); if (success) setNotice(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "L’action n’a pas pu être enregistrée."); }
    finally { setBusy(false); }
  };
  const saveTemplate = () => run(async () => {
    await apiFetch(`/action-tasks/templates${editingId ? `/${encodeURIComponent(editingId)}` : ""}`, {
      method: editingId ? "PUT" : "POST", json: draft,
    });
    setEditingId(null);
    setDraft(emptyTemplate(draft.gite_id));
  }, editingId ? "Modèle mis à jour." : "Modèle créé : les actions liées aux séjours seront générées automatiquement.");
  const saveManual = () => run(async () => {
    await apiFetch("/action-tasks/tasks", { method: "POST", json: { ...manual, assignee_id: manual.assignee_id || null } });
    setManual((current) => ({ ...current, title: "", note: "" }));
  }, "Action ponctuelle créée.");
  const changeTask = (task: ActionTask, kind: "assignment" | "status" | "note", value: string | null) => run(async () => {
    const body = kind === "assignment" ? { assignee_id: value } : kind === "status"
      ? { status: value, ...(value === "done" && task.compensation_mode === "time" ? { spent_minutes: Number(timeDrafts[task.id] ?? 0) } : {}) }
      : { note: value ?? "" };
    await apiFetch(`/action-tasks/tasks/${encodeURIComponent(task.id)}/${kind}`, { method: "PATCH", json: body });
  });
  const addShortcut = (shortcut: ActionResponse["shortcuts"][number]) => run(async () => {
    await apiFetch("/action-tasks/tasks/quick", { method: "POST", json: {
      gite_id: manual.gite_id, title: shortcut.title, category: shortcut.category, shortcut_key: shortcut.key,
    } });
  }, `${shortcut.title} ajoutée.`);

  return <div className="actions-panel">
    {selectedTask ? <GiteTasksDrawer open giteId={selectedTask.gite_id} giteName={selectedTask.gite_name} initialTaskId={selectedTask.id} onClose={() => setSelectedTask(null)} onChanged={() => void load()} /> : null}
    {error ? <div className="card" role="alert">{error}</div> : null}
    {notice ? <div className="card" role="status">{notice}</div> : null}
    <section className="card cleaning-page__section">
      <h2>Tâches à réaliser</h2>
      <p className="field-hint">Les tâches rapides restent visibles sur Aujourd’hui. Les tâches à long terme restent dans votre suivi sans encombrer l’opérationnel.</p>
      <div className="cleaning-page__tabs" role="group" aria-label="Filtrer les actions">
        {([ ["pending", "À faire"], ["all", "Toutes"], ["completed", "Terminées"] ] as const).map(([key, label]) =>
          <button key={key} type="button" className={view === key ? "is-selected" : ""} onClick={() => setView(key)}>{label}</button>
        )}
      </div>
      <div className="cleaning-page__tabs" role="group" aria-label="Filtrer par catégorie">
        {([ ["all", "Toutes"], ["short", "Rapides"], ["long", "Long terme"] ] as const).map(([key, label]) =>
          <button key={key} type="button" className={categoryView === key ? "is-selected" : ""} onClick={() => setCategoryView(key)}>{label}</button>
        )}
      </div>
      {loading ? <p>Chargement des actions…</p> : visibleTasks.length === 0 ? <p className="field-hint">Aucune action pour cette période et ce filtre.</p> :
        <div className="cleaning-page__list">{visibleTasks.map((task) => <article className="cleaning-task" key={task.id}>
          <div className="cleaning-task__main">
            <span className={`cleaning-task__status cleaning-task__status--${task.status}`}>{statusLabel[task.status]}</span>
            <span className={`task-category task-category--${task.category}`}>{task.category === "short" ? "Rapide" : "Long terme"}</span>
            <h3>{task.status !== "done" ? <button type="button" className="task-title-link" onClick={() => setSelectedTask(task)}>{task.title}</button> : task.title}</h3><p>{task.gite_name} · Échéance {displayDate(task.due_at)}</p>
            {task.compensation_mode === "flat_rate" && task.compensation_amount !== null ? <small>Forfait : {task.compensation_amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</small> : null}
            {task.compensation_mode === "time" ? <label className="task-time-input">Temps passé <input type="number" min={1} max={1440} value={timeDrafts[task.id] ?? ""} placeholder="min" onChange={(event) => setTimeDrafts((current) => ({ ...current, [task.id]: event.target.value }))} /> min</label> : null}
            {new Date(task.due_at) < new Date() && task.status !== "done" ? <small className="cleaning-task__warning">Échéance dépassée</small> : null}
            {task.assignee_name && !data?.can_manage ? <small>Attribuée à {task.assignee_name}</small> : null}
          </div>
          <div className="cleaning-task__actions">
            {task.status !== "done" ? <button type="button" className="task-edit-action" disabled={busy} onClick={() => setSelectedTask(task)} aria-label={`Modifier ${task.title}`}><TaskEditIcon /><span>Modifier</span></button> : null}
            {data?.can_manage && task.status !== "done" ? <label>Intervenant<select value={task.assignee_id ?? ""} disabled={busy}
              onChange={(event) => void changeTask(task, "assignment", event.target.value || null)}>
              <option value="">Non attribuée</option>{data.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label> : null}
            {task.status === "planned" ? <button type="button" disabled={busy} onClick={() => void changeTask(task, "status", "in_progress")}>Commencer</button> : null}
            {task.status !== "done" ? <button type="button" disabled={busy || (task.compensation_mode === "time" && Number(timeDrafts[task.id] ?? 0) < 1)} onClick={() => void changeTask(task, "status", "done")}>Terminer</button> : null}
            {task.status === "done" && data?.can_manage ? <button type="button" className="button-secondary" disabled={busy}
              onClick={() => void changeTask(task, "status", "planned")}>Rouvrir</button> : null}
          </div>
          <details className="cleaning-task__note"><summary>{task.note ? "Consignes et note" : "Ajouter une note"}</summary>
            <textarea rows={3} maxLength={2000} aria-label={`Note de ${task.title}`} value={notes[task.id] ?? task.note}
              onChange={(event) => setNotes((current) => ({ ...current, [task.id]: event.target.value }))} />
            <button type="button" disabled={busy || (notes[task.id] ?? task.note) === task.note}
              onClick={() => void changeTask(task, "note", notes[task.id] ?? "")}>Enregistrer la note</button>
          </details>
        </article>)}</div>}
    </section>

    {data?.can_manage ? <>
      <section className="card cleaning-page__section">
        <h2>Ajout rapide</h2><p className="field-hint">Choisissez le gîte puis touchez un raccourci, ou décrivez une nouvelle tâche.</p>
        <label className="field">Gîte<select value={manual.gite_id} onChange={(event) => setManual({ ...manual, gite_id: event.target.value })}>
          {data.gites.map((gite) => <option key={gite.id} value={gite.id}>{gite.nom}</option>)}
        </select></label>
        <div className="gite-tasks-drawer__shortcuts">{data.shortcuts.map((shortcut) => <button type="button" key={shortcut.key} disabled={busy || !manual.gite_id} className={`gite-task-shortcut gite-task-shortcut--${shortcut.category}`} onClick={() => void addShortcut(shortcut)}>+ {shortcut.title}</button>)}</div>
        <h3>Nouvelle tâche</h3>
        <div className="cleaning-page__rules">
          <label className="field">Action<input value={manual.title} maxLength={120} placeholder="Ex. Vérifier la chaudière"
            onChange={(event) => setManual({ ...manual, title: event.target.value })} /></label>
          <label className="field">Catégorie<select value={manual.category} onChange={(event) => setManual({ ...manual, category: event.target.value as "short" | "long" })}>
            <option value="short">Rapide</option><option value="long">Long terme</option>
          </select></label>
          <label className="field">Début<input type="date" value={manual.start_day} onChange={(event) => setManual({ ...manual, start_day: event.target.value })} />
            <input type="time" value={manual.start_time} onChange={(event) => setManual({ ...manual, start_time: event.target.value })} /></label>
          <label className="field">Échéance<input type="date" value={manual.due_day} onChange={(event) => setManual({ ...manual, due_day: event.target.value })} />
            <input type="time" value={manual.due_time} onChange={(event) => setManual({ ...manual, due_time: event.target.value })} /></label>
          <label className="field">Intervenant<select value={manual.assignee_id} onChange={(event) => setManual({ ...manual, assignee_id: event.target.value })}>
            <option value="">À attribuer plus tard</option>{data.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className="field">Rémunération<select value={manual.compensation_mode} onChange={(event) => setManual({ ...manual, compensation_mode: event.target.value as typeof manual.compensation_mode })}>
            <option value="none">Aucune</option><option value="flat_rate">Forfait</option><option value="time">Temps passé</option>
          </select></label>
          {manual.compensation_mode === "flat_rate" ? <label className="field">Forfait (€)<input type="number" min={0} step="0.01" value={manual.compensation_amount} onChange={(event) => setManual({ ...manual, compensation_amount: Number(event.target.value) })} /></label> : null}
          {manual.compensation_mode === "time" ? <label className="field">Durée prévue (min)<input type="number" min={1} max={1440} value={manual.spent_minutes ?? ""} onChange={(event) => setManual({ ...manual, spent_minutes: event.target.value ? Number(event.target.value) : null })} /></label> : null}
          <label className="field">Consignes<input value={manual.note} maxLength={2000} onChange={(event) => setManual({ ...manual, note: event.target.value })} /></label>
        </div>
        <button type="button" disabled={busy || !manual.gite_id || manual.title.trim().length < 2} onClick={() => void saveManual()}>Créer la tâche</button>
      </section>

      <section className="card cleaning-page__section">
        <h2>Tâches automatiques</h2><p className="field-hint">Un modèle crée une tâche pour chaque arrivée ou départ du gîte choisi.</p>
        <div className="actions-panel__templates">{data.templates.map((template) => <div className="actions-panel__template" key={template.id}>
          <div><strong>{template.title}</strong><small>{data.gites.find((gite) => gite.id === template.gite_id)?.nom} · {template.trigger_event === "arrival" ? "Arrivée" : "Départ"}{template.enabled ? "" : " · En pause"}</small></div>
          <button type="button" className="button-secondary" onClick={() => { setEditingId(template.id); setDraft({ ...template }); }}>Modifier</button>
        </div>)}</div>
        <h3>{editingId ? "Modifier le modèle" : "Nouveau modèle"}</h3>
        <div className="cleaning-page__rules">
          <label className="field">Gîte<select value={draft.gite_id} onChange={(event) => setDraft({ ...draft, gite_id: event.target.value })}>
            {data.gites.map((gite) => <option key={gite.id} value={gite.id}>{gite.nom}</option>)}
          </select></label>
          <label className="field">Action<input value={draft.title} maxLength={120} placeholder="Ex. Préparer le linge"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="field">Catégorie<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as ActionTemplate["category"] })}>
            <option value="short">Rapide</option><option value="long">Long terme</option>
          </select></label>
          <label className="field">Déclencheur<select value={draft.trigger_event} onChange={(event) => setDraft({ ...draft, trigger_event: event.target.value as ActionTemplate["trigger_event"] })}>
            <option value="departure">Départ</option><option value="arrival">Arrivée</option>
          </select></label>
          <label className="field">Début : jours par rapport au séjour<input type="number" min={-30} max={30} value={draft.starts_offset_days}
            onChange={(event) => setDraft({ ...draft, starts_offset_days: Number(event.target.value) })} />
            <input type="time" value={draft.start_time} onChange={(event) => setDraft({ ...draft, start_time: event.target.value })} /></label>
          <label className="field">Échéance : jours par rapport au séjour<input type="number" min={-30} max={30} value={draft.due_offset_days}
            onChange={(event) => setDraft({ ...draft, due_offset_days: Number(event.target.value) })} />
            <input type="time" value={draft.due_time} onChange={(event) => setDraft({ ...draft, due_time: event.target.value })} /></label>
          <label className="field">Attribution<select value={draft.assignment_mode} onChange={(event) => setDraft({ ...draft, assignment_mode: event.target.value as AssignmentMode })}>
            <option value="unassigned">À attribuer manuellement</option><option value="fixed">Intervenant habituel</option><option value="rotation">Tour de rôle</option>
          </select></label>
          {draft.assignment_mode === "fixed" ? <label className="field">Intervenant<select value={draft.default_assignee_id ?? ""} onChange={(event) => setDraft({ ...draft, default_assignee_id: event.target.value || null })}>
            <option value="">Choisir…</option>{data.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label> : null}
          {draft.assignment_mode === "rotation" ? <fieldset className="actions-panel__pool"><legend>Intervenants du tour de rôle, dans cet ordre</legend>
            {data.assignees.map((item) => <label key={item.id}><input type="checkbox" checked={draft.rotation_assignee_ids.includes(item.id)}
              onChange={(event) => setDraft({ ...draft, rotation_assignee_ids: event.target.checked
                ? [...draft.rotation_assignee_ids, item.id] : draft.rotation_assignee_ids.filter((id) => id !== item.id) })} /> {item.name}</label>)}
          </fieldset> : null}
          <label className="field">Rémunération<select value={draft.compensation_mode} onChange={(event) => setDraft({ ...draft, compensation_mode: event.target.value as ActionTemplate["compensation_mode"] })}>
            <option value="none">Aucune</option><option value="flat_rate">Forfait</option><option value="time">Temps passé</option>
          </select></label>
          {draft.compensation_mode === "flat_rate" ? <label className="field">Forfait (€)<input type="number" min={0} step="0.01" value={draft.compensation_amount} onChange={(event) => setDraft({ ...draft, compensation_amount: Number(event.target.value) })} /></label> : null}
          {draft.compensation_mode === "time" ? <label className="field">Durée prévue (min)<input type="number" min={1} max={1440} value={draft.default_minutes ?? ""} onChange={(event) => setDraft({ ...draft, default_minutes: event.target.value ? Number(event.target.value) : null })} /></label> : null}
          <label className="cleaning-page__checkbox"><input type="checkbox" checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Modèle actif</label>
        </div>
        <div className="cleaning-task__actions"><button type="button" disabled={busy || !draft.gite_id || draft.title.trim().length < 2}
          onClick={() => void saveTemplate()}>{editingId ? "Enregistrer le modèle" : "Créer le modèle"}</button>
          {editingId ? <button type="button" className="button-secondary" onClick={() => { setEditingId(null); setDraft(emptyTemplate(data.gites[0]?.id ?? "")); }}>Annuler</button> : null}
        </div>
      </section>
    </> : null}
  </div>;
}
