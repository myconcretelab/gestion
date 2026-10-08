import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api";
import ActionsPanel from "./ActionsPanel";

type CleaningStatus = "planned" | "in_progress" | "done" | "verified";
type CleaningTask = {
  id: string; gite_id: string; gite_name: string; departure_reservation_id: string;
  assignee_id: string | null; assignee_name: string | null; status: CleaningStatus;
  starts_at: string; due_at: string | null; completed_at: string | null;
  checked_at: string | null; requires_check: boolean; note: string;
  schedule_conflict: boolean;
  notification_warning?: string | null;
};
type CleaningRule = {
  gite_id: string; generation_mode: "always" | "option_only" | "disabled";
  schedule_mode: "after_departure" | "day_before_arrival" | "arrival_day";
  default_assignee_id: string | null; requires_check: boolean;
  assignment_mode: "unassigned" | "fixed" | "rotation"; rotation_assignee_ids: string[];
  notify_on_complete: boolean; reminder_minutes: number;
  buffer_minutes: number;
};
type CleaningResponse = {
  tasks: CleaningTask[];
  gites: { id: string; nom: string }[];
  assignees: { id: string; name: string }[];
  rules: CleaningRule[];
  can_manage: boolean;
};

const parisDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
const formatDateTime = (value: string) => new Date(value).toLocaleString("fr-FR", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
});
const statusLabel: Record<CleaningStatus, string> = {
  planned: "À faire", in_progress: "En cours", done: "À contrôler", verified: "Prêt",
};
const generationLabel: Record<CleaningRule["generation_mode"], string> = {
  always: "Après chaque départ", option_only: "Si l’option ménage est prise", disabled: "Désactivé",
};
const scheduleLabel: Record<CleaningRule["schedule_mode"], string> = {
  after_departure: "Dès le départ", day_before_arrival: "La veille de l’arrivée", arrival_day: "Le jour de l’arrivée",
};

export default function CleaningPage() {
  const today = parisDay();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(addDays(today, 45));
  const [data, setData] = useState<CleaningResponse | null>(null);
  const [rules, setRules] = useState<Record<string, CleaningRule>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [selectedGite, setSelectedGite] = useState("");
  const [view, setView] = useState<"pending" | "all" | "completed">("pending");
  const [section, setSection] = useState<"cleaning" | "actions">("cleaning");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<CleaningResponse>(`/cleaning-tasks?${new URLSearchParams({ from, to })}`);
      setData(result);
      setNoteDrafts(Object.fromEntries(result.tasks.map((task) => [task.id, task.note])));
      setRules(Object.fromEntries(result.rules.map((rule) => [rule.gite_id, rule])));
      setSelectedGite((current) => current || result.gites[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger les ménages.");
    } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const updateTask = async (task: CleaningTask, kind: "assignment" | "status", value: string | null) => {
    setBusyId(task.id); setError(null); setNotice(null);
    try {
      const updated = await apiFetch<CleaningTask>(`/cleaning-tasks/${encodeURIComponent(task.id)}/${kind}`, {
        method: "PATCH", json: kind === "assignment" ? { assignee_id: value } : { status: value },
      });
      setData((current) => current ? { ...current, tasks: current.tasks.map((item) => item.id === task.id ? updated : item) } : current);
      if (updated.notification_warning) setNotice(updated.notification_warning);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de modifier le ménage.");
    } finally { setBusyId(null); }
  };

  const saveRule = async () => {
    const rule = rules[selectedGite];
    if (!rule) return;
    setBusyId(`rule:${selectedGite}`); setError(null); setNotice(null);
    try {
      await apiFetch(`/cleaning-tasks/rules/${encodeURIComponent(selectedGite)}`, {
        method: "PUT", json: {
          generation_mode: rule.generation_mode, schedule_mode: rule.schedule_mode,
          default_assignee_id: rule.default_assignee_id, requires_check: rule.requires_check,
          assignment_mode: rule.assignment_mode, rotation_assignee_ids: rule.rotation_assignee_ids,
          notify_on_complete: rule.notify_on_complete, reminder_minutes: Number(rule.reminder_minutes),
          buffer_minutes: Number(rule.buffer_minutes),
        },
      });
      await load();
      setNotice("Règle enregistrée. Les horaires des ménages planifiés ont été recalculés ; les attributions existantes sont conservées.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer la règle.");
    } finally { setBusyId(null); }
  };

  const saveNote = async (task: CleaningTask) => {
    setBusyId(task.id); setError(null); setNotice(null);
    try {
      const updated = await apiFetch<CleaningTask>(`/cleaning-tasks/${encodeURIComponent(task.id)}/note`, {
        method: "PATCH", json: { note: noteDrafts[task.id] ?? "" },
      });
      setData((current) => current ? { ...current, tasks: current.tasks.map((item) => item.id === task.id ? updated : item) } : current);
      setNotice("Note enregistrée.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’enregistrer la note.");
    } finally { setBusyId(null); }
  };

  const visibleTasks = useMemo(() => (data?.tasks ?? []).filter((task) =>
    view === "all" || (view === "pending" ? task.status !== "verified" : task.status === "verified")
  ), [data?.tasks, view]);
  const currentRule = rules[selectedGite];
  const changeRule = (patch: Partial<CleaningRule>) => setRules((current) => ({
    ...current, [selectedGite]: { ...current[selectedGite], ...patch },
  }));

  return <div className="cleaning-page">
    <header className="cleaning-page__header">
      <div><span className="cleaning-page__eyebrow">Organisation</span><h1>Ménages</h1>
        <p>Organisez les ménages et les autres actions de votre équipe.</p></div>
      {data?.can_manage ? <Link className="button-secondary" to="/menages/partages">Plannings partagés</Link> : null}
    </header>

    {error ? <div className="card" role="alert">{error}</div> : null}
    {notice ? <div className="card" role="status">{notice}</div> : null}

    <div className="cleaning-page__tabs" role="group" aria-label="Type de travail">
      <button type="button" className={section === "cleaning" ? "is-selected" : ""} onClick={() => setSection("cleaning")}>Ménages</button>
      <button type="button" className={section === "actions" ? "is-selected" : ""} onClick={() => setSection("actions")}>Autres actions</button>
    </div>
    <div className="cleaning-page__dates">
      <label>Du <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Au <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
    </div>

    {section === "cleaning" ? <>

    <section className="card cleaning-page__section" aria-label="Liste des ménages">
      <div className="cleaning-page__toolbar">
        <div className="cleaning-page__tabs" role="group" aria-label="Filtrer les ménages">
          {([ ["pending", "À faire"], ["all", "Tous"], ["completed", "Terminés"] ] as const).map(([key, label]) =>
            <button key={key} type="button" className={view === key ? "is-selected" : ""} onClick={() => setView(key)}>{label}</button>
          )}
        </div>
      </div>
      {loading ? <p>Chargement des ménages…</p> : visibleTasks.length === 0 ?
        <p className="field-hint">Aucun ménage pour cette période et ce filtre.</p> :
        <div className="cleaning-page__list">{visibleTasks.map((task) => {
          const overdue = task.status !== "verified" && task.due_at && new Date(task.due_at) < new Date();
          return <article className={`cleaning-task${overdue ? " cleaning-task--overdue" : ""}`} key={task.id}>
            <div className="cleaning-task__main">
              <span className={`cleaning-task__status cleaning-task__status--${task.status}`}>{statusLabel[task.status]}</span>
              <h2>{task.gite_name}</h2>
              <p>À partir du {formatDateTime(task.starts_at)}{task.due_at ? ` · À terminer avant le ${formatDateTime(task.due_at)}` : ""}</p>
              {overdue ? <small className="cleaning-task__warning">Échéance dépassée</small> : null}
              {task.schedule_conflict ? <small className="cleaning-task__warning">Créneau impossible : vérifiez les horaires d’arrivée et de départ.</small> : null}
              {task.assignee_name && !data?.can_manage ? <small>Attribué à {task.assignee_name}</small> : null}
            </div>
            <div className="cleaning-task__actions">
              {data?.can_manage ? <label>Intervenant
                <select value={task.assignee_id ?? ""} disabled={busyId === task.id}
                  onChange={(event) => void updateTask(task, "assignment", event.target.value || null)}>
                  <option value="">Non attribué</option>
                  {data.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label> : null}
              {task.status === "planned" ? <button type="button" disabled={busyId === task.id}
                onClick={() => void updateTask(task, "status", "in_progress")}>Commencer</button> : null}
              {task.status === "in_progress" || task.status === "planned" ? <button type="button" disabled={busyId === task.id}
                onClick={() => void updateTask(task, "status", "done")}>Ménage terminé</button> : null}
              {task.status === "done" && (data?.can_manage || !task.requires_check) ? <button type="button" disabled={busyId === task.id}
                onClick={() => void updateTask(task, "status", "verified")}>Valider le contrôle</button> : null}
              {task.status === "verified" && data?.can_manage ? <button type="button" className="button-secondary" disabled={busyId === task.id}
                onClick={() => void updateTask(task, "status", "planned")}>Rouvrir</button> : null}
            </div>
            <details className="cleaning-task__note">
              <summary>{task.note ? "Consignes et note" : "Ajouter une note"}</summary>
              <textarea aria-label={`Note du ménage de ${task.gite_name}`} rows={3} maxLength={2000}
                value={noteDrafts[task.id] ?? task.note}
                onChange={(event) => setNoteDrafts((current) => ({ ...current, [task.id]: event.target.value }))} />
              <button type="button" disabled={busyId === task.id || (noteDrafts[task.id] ?? task.note) === task.note}
                onClick={() => void saveNote(task)}>Enregistrer la note</button>
            </details>
          </article>;
        })}</div>}
    </section>

    {data?.can_manage && currentRule ? <section className="card cleaning-page__section" aria-label="Règles automatiques">
      <h2>Règles automatiques</h2><p className="field-hint">Choisissez comment les prochains ménages seront créés pour chaque gîte.</p>
      <div className="cleaning-page__rules">
        <label className="field">Gîte<select value={selectedGite} onChange={(event) => setSelectedGite(event.target.value)}>
          {data.gites.map((gite) => <option key={gite.id} value={gite.id}>{gite.nom}</option>)}
        </select></label>
        <label className="field">Créer un ménage<select value={currentRule.generation_mode} onChange={(event) => changeRule({ generation_mode: event.target.value as CleaningRule["generation_mode"] })}>
          {Object.entries(generationLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="field">Moment prévu<select value={currentRule.schedule_mode} onChange={(event) => changeRule({ schedule_mode: event.target.value as CleaningRule["schedule_mode"] })}>
          {Object.entries(scheduleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="field">Attribution<select value={currentRule.assignment_mode} onChange={(event) => changeRule({ assignment_mode: event.target.value as CleaningRule["assignment_mode"] })}>
          <option value="unassigned">À attribuer manuellement</option><option value="fixed">Intervenant habituel</option><option value="rotation">Tour de rôle</option>
        </select></label>
        {currentRule.assignment_mode === "fixed" ? <label className="field">Intervenant habituel<select value={currentRule.default_assignee_id ?? ""} onChange={(event) => changeRule({ default_assignee_id: event.target.value || null })}>
          <option value="">À attribuer manuellement</option>
          {data.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label> : null}
        {currentRule.assignment_mode === "rotation" ? <fieldset className="actions-panel__pool"><legend>Intervenants du tour de rôle, dans cet ordre</legend>
          {data.assignees.map((item) => <label key={item.id}><input type="checkbox" checked={currentRule.rotation_assignee_ids.includes(item.id)}
            onChange={(event) => changeRule({ rotation_assignee_ids: event.target.checked
              ? [...currentRule.rotation_assignee_ids, item.id] : currentRule.rotation_assignee_ids.filter((id) => id !== item.id) })} /> {item.name}</label>)}
        </fieldset> : null}
        <label className="field">Terminer avant l’arrivée<select value={currentRule.buffer_minutes} onChange={(event) => changeRule({ buffer_minutes: Number(event.target.value) })}>
          {[0, 30, 60, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? "À l’heure prévue d’arrivée" : `${minutes} min avant l’arrivée`}</option>)}
        </select></label>
        <label className="cleaning-page__checkbox"><input type="checkbox" checked={currentRule.requires_check} onChange={(event) => changeRule({ requires_check: event.target.checked })} /> Contrôle par le gestionnaire avant « gîte prêt »</label>
        <label className="cleaning-page__checkbox"><input type="checkbox" checked={currentRule.notify_on_complete} onChange={(event) => changeRule({ notify_on_complete: event.target.checked })} /> Envoyer un Telegram quand le ménage est terminé</label>
        <label className="field">Rappel du contrôle avant l’arrivée<select value={currentRule.reminder_minutes} onChange={(event) => changeRule({ reminder_minutes: Number(event.target.value) })}>
          {[0, 60, 120, 240, 720, 1440].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? "Aucun rappel" : minutes < 60 ? `${minutes} min avant` : `${minutes / 60} h avant`}</option>)}
        </select></label>
      </div>
      <button type="button" disabled={busyId === `rule:${selectedGite}`} onClick={() => void saveRule()}>{busyId === `rule:${selectedGite}` ? "Enregistrement…" : "Enregistrer la règle"}</button>
    </section> : null}
    </> : <ActionsPanel from={from} to={to} />}
  </div>;
}
