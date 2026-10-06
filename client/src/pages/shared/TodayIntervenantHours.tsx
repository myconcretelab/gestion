import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isApiError } from "../../utils/api";
import { formatWorkMinutes, getWorkerColor, getWorkerInitials, parseWorkHours } from "../../utils/intervenantHours";
import "./todayIntervenantHours.css";

type Worker = {
  id: string; nom: string; is_active: boolean; show_on_today: boolean;
  unpaid_minutes: number; hourly_rate: number;
};
type HourEntry = {
  id: string; intervenant_id: string | null; intervenant_nom: string;
  worked_on: string; minutes: number; paid_at: string | null;
  hourly_rate_snapshot: number | null; created_at: string; updated_at: string;
};
type HoursData = { workers: Worker[]; entries: HourEntry[] };
type PendingAddition = { id: string; workerId: string; worked_on: string; minutes: number };
const QUICK_MINUTES = [30, 60, 120] as const;
const dayLabel = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("fr-FR", {
  weekday: "long", day: "numeric", month: "long",
});

export default function TodayIntervenantHours({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const previousToday = useRef(today);
  const [data, setData] = useState<HoursData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chosenMinutes, setChosenMinutes] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [customHours, setCustomHours] = useState("");
  const [choosingWorkers, setChoosingWorkers] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ entry: HourEntry; date: string; hours: string } | null>(null);
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; undo?: HourEntry } | null>(null);
  const [pendingAddition, setPendingAddition] = useState<PendingAddition | null>(null);
  const wheelRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const response = await apiFetch<HoursData>("/intervenants/hours?date=" + encodeURIComponent(date));
      if (sequence !== loadSequence.current) return;
      setData(response);
      setError(null);
    } catch (err) {
      if (sequence === loadSequence.current) {
        setError(err instanceof Error ? err.message : "Impossible de charger les heures.");
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void reload();
    return () => { loadSequence.current++; };
  }, [reload]);
  useEffect(() => {
    const previous = previousToday.current;
    previousToday.current = today;
    if (!busyRef.current && !pendingAddition) setDate((current) => current === previous ? today : current);
  }, [today, pendingAddition]);
  useEffect(() => {
    const refresh = () => { if (!busyRef.current && !pendingAddition) void reload(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [reload, pendingAddition]);

  const closePicker = () => {
    if (busyRef.current) return;
    setActiveId(null);
    setChosenMinutes(null);
    setCustom(false);
  };
  useEffect(() => {
    if (!activeId) return;
    const outside = (event: PointerEvent) => {
      if (!busyRef.current && !wheelRef.current?.contains(event.target as Node)) {
        setActiveId(null); setChosenMinutes(null); setCustom(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        const trigger = wheelRef.current?.querySelector<HTMLButtonElement>(".today-hours__orb");
        setActiveId(null); setChosenMinutes(null); setCustom(false);
        trigger?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [activeId]);
  useEffect(() => {
    if (!activeId) return;
    const selector = custom ? "input" : chosenMinutes ? ".today-hours__orb" : "[data-duration]";
    wheelRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [activeId, chosenMinutes, custom]);

  const mutate = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    // A GET started before this edit must not overwrite its result.
    loadSequence.current++;
    setLoading(false);
    setBusy(true);
    setError(null);
    try { await operation(); }
    catch (err) { setError(err instanceof Error ? err.message : "Impossible d'enregistrer les heures."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const addHours = async (worker: Worker, minutes: number) => {
    if (busyRef.current) return;
    const request = pendingAddition ?? {
      id: crypto.randomUUID(), workerId: worker.id, worked_on: date, minutes,
    };
    setPendingAddition(request);
    await mutate(async () => {
      let entry: HourEntry;
      try {
        entry = await apiFetch<HourEntry>("/intervenants/hours/" + request.workerId, {
          method: "POST",
          json: { id: request.id, worked_on: request.worked_on, minutes: request.minutes },
        });
      } catch (err) {
        // Only a definitive rejection unlocks a new operation. An ambiguous
        // network error retains the same request identifier for the retry.
        if (isApiError(err) && err.status >= 400 && err.status < 500 &&
            err.status !== 408 && err.status !== 429) setPendingAddition(null);
        throw err;
      }
      setData((current) => current ? {
        ...current, entries: [entry, ...current.entries.filter((item) => item.id !== entry.id)],
      } : current);
      setPendingAddition(null);
      setNotice({
        message: entry.intervenant_nom + " : +" + formatWorkMinutes(entry.minutes),
        undo: entry,
      });
      setActiveId(null); setChosenMinutes(null); setCustom(false);
    });
  };
  const removeEntry = async (entry: HourEntry) => {
    await apiFetch("/intervenants/hours/" + entry.intervenant_id + "/" + entry.id, { method: "DELETE" });
    setData((current) => current ? { ...current, entries: current.entries.filter((item) => item.id !== entry.id) } : current);
    setNotice({ message: "Saisie annulée pour " + entry.intervenant_nom + "." });
    setDeleteArmed(null);
    setEdit(null);
  };
  const toggleWorker = (worker: Worker, checked: boolean) => void mutate(async () => {
    await apiFetch("/intervenants/" + worker.id, { method: "PATCH", json: { show_on_today: checked } });
    setData((current) => current ? {
      ...current, workers: current.workers.map((item) => item.id === worker.id ? { ...item, show_on_today: checked } : item),
    } : current);
  });
  const changeDate = (next: string) => {
    if (!next || busyRef.current || pendingAddition) return;
    setDate(next); setData(null); setActiveId(null); setChosenMinutes(null);
    setCustom(false); setEdit(null); setDeleteArmed(null); setNotice(null);
  };
  const correctEntry = () => {
    if (!edit) return;
    const minutes = parseWorkHours(edit.hours);
    if (minutes === null) { setError("Saisissez une durée entre 1 minute et 24 heures, en heures décimales."); return; }
    const currentEdit = edit;
    void mutate(async () => {
      const entry = await apiFetch<HourEntry>("/intervenants/hours/" + currentEdit.entry.intervenant_id + "/" + currentEdit.entry.id, {
        method: "PATCH",
        json: { minutes, worked_on: currentEdit.date, expected_updated_at: currentEdit.entry.updated_at },
      });
      setData((current) => current ? {
        ...current,
        entries: current.entries.flatMap((item) => item.id === entry.id ? entry.worked_on === date ? [entry] : [] : [item]),
      } : current);
      setEdit(null);
      setNotice({ message: "Saisie corrigée pour " + entry.intervenant_nom + "." });
    });
  };
  const settleWorker = (worker: Worker) => {
    if (!worker.unpaid_minutes || !confirm(
      `Confirmer le paiement de ${formatWorkMinutes(worker.unpaid_minutes)} à ${worker.nom} et remettre son compteur à zéro ? Les heures resteront dans l'historique.`,
    )) return;
    void mutate(async () => {
      await apiFetch(`/intervenants/hours/${encodeURIComponent(worker.id)}/settle`, { method: "POST" });
      await reload();
      setNotice({ message: `Paiement de ${worker.nom} enregistré. Le compteur est remis à zéro.` });
    });
  };

  const visibleWorkers = data?.workers.filter((worker) => worker.is_active && worker.show_on_today) ?? [];
  const historyWorker = data?.workers.find((worker) => worker.id === historyId);
  const historyEntries = data?.entries.filter((entry) => entry.intervenant_id === historyId) ?? [];
  const locked = busy || Boolean(pendingAddition);
  const customMinutes = parseWorkHours(customHours);

  return (
    <div className="today-hours" aria-label="Heures des intervenants" aria-busy={busy || loading}>
      <div className="today-hours__heading">
        <span className="today-utility-strip__label">Heures</span>
        <label className="today-hours__date">
          <span>{date === today ? "Aujourd'hui" : dayLabel(date)}</span>
          <input type="date" aria-label="Date des heures" value={date} disabled={locked} onChange={(event) => changeDate(event.target.value)} />
        </label>
        <button type="button" className="today-hours__text-button" aria-expanded={choosingWorkers}
          disabled={locked} onClick={() => { closePicker(); setChoosingWorkers(!choosingWorkers); }}>
          Choisir
        </button>
      </div>
      {date !== today && <button type="button" className="today-hours__text-button" disabled={locked} onClick={() => changeDate(today)}>Revenir à aujourd'hui</button>}
      {error && <div role="alert" className="today-hours__error">
        {error}
        {pendingAddition ? <button type="button" disabled={busy} onClick={() => {
          const worker = data?.workers.find((item) => item.id === pendingAddition.workerId);
          if (worker) void addHours(worker, pendingAddition.minutes);
        }}>Réessayer le même ajout</button> :
          <button type="button" disabled={busy} onClick={() => { closePicker(); setEdit(null); setDeleteArmed(null); void reload(); }}>Recharger</button>}
      </div>}
      {pendingAddition && !busy && <p className="today-hours__hint">L'ajout attend une réponse : réessayez pour le confirmer sans le compter deux fois.</p>}
      {notice && <div role="status" className="today-hours__notice">
        <span>{notice.message}</span>
        {notice.undo && <button type="button" disabled={locked} className="today-hours__text-button"
          onClick={() => { const entry = notice.undo; if (entry) void mutate(() => removeEntry(entry)); }}>Annuler</button>}
      </div>}
      {loading && !data && <span className="today-hours__hint">Chargement des intervenants…</span>}
      {data && (
        <>
          {choosingWorkers && <div className="today-hours__selection">
            <p className="today-hours__hint">Choisissez les personnes à afficher.</p>
            {data.workers.filter((worker) => worker.is_active).map((worker) => (
              <label key={worker.id}>
                <input type="checkbox" checked={worker.show_on_today} disabled={locked}
                  onChange={(event) => toggleWorker(worker, event.target.checked)} />
                {worker.nom}
              </label>
            ))}
            <Link to="/interventions">Gérer les interventions</Link>
          </div>}
          {!visibleWorkers.length && !choosingWorkers && <button type="button"
            className="today-hours__empty" disabled={locked} onClick={() => setChoosingWorkers(true)}>
            + Choisir les intervenants
          </button>}
          <div className="today-hours__people">
            {visibleWorkers.map((worker) => {
              const active = activeId === worker.id;
              const total = worker.unpaid_minutes;
              const workerStyle = { "--worker-color": getWorkerColor(worker.id) } as CSSProperties;
              return (
                <div key={worker.id} style={workerStyle} ref={active ? wheelRef : undefined}
                  className={"today-hours__person" + (active ? " is-open" : "")}>
                  {active && <div className="today-hours__durations" role="group" aria-label={"Durée à ajouter pour " + worker.nom}>
                    {QUICK_MINUTES.map((minutes, index) => <button type="button" key={minutes}
                      className={"today-hours__duration today-hours__duration--" + index}
                      data-duration aria-pressed={chosenMinutes === minutes} disabled={locked}
                      onClick={() => { setChosenMinutes(minutes); setCustom(false); }}>
                      {minutes === 30 ? "½ h" : formatWorkMinutes(minutes)}
                    </button>)}
                    <button type="button" className="today-hours__duration today-hours__duration--3"
                      aria-pressed={custom} disabled={locked} onClick={() => { setCustom(true); setChosenMinutes(null); setCustomHours(""); }}>
                      Autre
                    </button>
                  </div>}
                  <button type="button" className={"today-hours__orb" + (active && chosenMinutes ? " is-confirming" : "")}
                    disabled={locked} aria-expanded={active}
                    aria-label={active && chosenMinutes ? "Ajouter " + formatWorkMinutes(chosenMinutes) + " à " + worker.nom + " le " + dayLabel(date) :
                      active ? "Fermer le choix des heures pour " + worker.nom :
                        "Ajouter des heures à " + worker.nom + " le " + dayLabel(date)}
                    onClick={() => {
                      if (active && chosenMinutes) { void addHours(worker, chosenMinutes); return; }
                      if (active) { closePicker(); return; }
                      setActiveId(worker.id); setChosenMinutes(null); setCustom(false); setChoosingWorkers(false);
                    }}>
                    {active && chosenMinutes ? <><span>+{formatWorkMinutes(chosenMinutes)}</span><small>✓ Valider</small></> : getWorkerInitials(worker.nom)}
                  </button>
                  <div className="today-hours__person-meta">
                    <span className="today-hours__name" title={worker.nom}>{worker.nom.split(" ")[0]}</span>
                    <button type="button" className="today-hours__total" disabled={locked}
                      aria-label={worker.nom + " : " + formatWorkMinutes(total) + ". Voir et corriger les saisies du " + dayLabel(date)}
                      aria-expanded={historyId === worker.id}
                      onClick={() => {
                        closePicker(); setHistoryId(historyId === worker.id ? null : worker.id);
                        setEdit(null); setDeleteArmed(null); void reload();
                      }}>{formatWorkMinutes(total)}</button>
                  </div>
                  {active && custom && <form className="today-hours__custom" onSubmit={(event) => {
                    event.preventDefault();
                    if (customMinutes !== null) { setChosenMinutes(customMinutes); setCustom(false); }
                  }}>
                    <label>Durée en heures
                      <input inputMode="decimal" placeholder="Ex. 1,5" value={customHours} disabled={locked}
                        onChange={(event) => setCustomHours(event.target.value)} />
                    </label>
                    <button type="submit" disabled={locked || customMinutes === null}>Choisir</button>
                    <small>1,5 = 1 h 30. Validation ensuite au centre.</small>
                  </form>}
                  {active && <button type="button" className="today-hours__text-button today-hours__cancel"
                    disabled={busy} onClick={closePicker}>Fermer</button>}
                </div>
              );
            })}
          </div>
          {activeId && !pendingAddition && <p className="today-hours__hint">Choisissez une durée, puis validez au centre de la boule.</p>}
          {historyWorker && <div className="today-hours__history">
            <div className="today-hours__heading">
              <strong>{historyWorker.nom} · {formatWorkMinutes(historyWorker.unpaid_minutes)} à payer</strong>
              <button type="button" className="today-hours__text-button" disabled={locked}
                onClick={() => { setHistoryId(null); setEdit(null); setDeleteArmed(null); }}>Fermer</button>
            </div>
            {historyWorker.unpaid_minutes > 0 && <button type="button" disabled={locked}
              onClick={() => settleWorker(historyWorker)}>Paiement effectué · remettre à 0</button>}
            {!historyEntries.length && <p className="today-hours__hint">Aucune heure enregistrée pour cette date.</p>}
            {historyEntries.map((entry) => <div className="today-hours__entry" key={entry.id}>
              <div className="today-hours__entry-line">
                <strong>{formatWorkMinutes(entry.minutes)}</strong>
                <span>{new Date(entry.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                {entry.paid_at ? <span>Payée</span> : <button type="button" className="today-hours__text-button" disabled={locked} onClick={() => {
                  setEdit({ entry, date: entry.worked_on, hours: String(entry.minutes / 60) }); setDeleteArmed(null);
                }}>Corriger</button>}
                {!entry.paid_at && <button type="button" className="today-hours__text-button" disabled={locked} onClick={() => {
                  setDeleteArmed(entry.id); setEdit(null);
                }}>Supprimer</button>}
              </div>
              {deleteArmed === entry.id && <div className="today-hours__entry-line">
                <span>Supprimer {formatWorkMinutes(entry.minutes)} ?</span>
                <button type="button" disabled={locked} onClick={() => void mutate(() => removeEntry(entry))}>Confirmer</button>
                <button type="button" disabled={locked} onClick={() => setDeleteArmed(null)}>Garder</button>
              </div>}
              {edit?.entry.id === entry.id && <form className="today-hours__edit" onSubmit={(event) => { event.preventDefault(); correctEntry(); }}>
                <label>Date<input type="date" required value={edit.date} disabled={locked}
                  onChange={(event) => setEdit((current) => current ? { ...current, date: event.target.value } : null)} /></label>
                <label>Heures<input inputMode="decimal" required value={edit.hours} disabled={locked}
                  onChange={(event) => setEdit((current) => current ? { ...current, hours: event.target.value } : null)} /></label>
                <button type="submit" disabled={locked || parseWorkHours(edit.hours) === null}>Enregistrer</button>
                <button type="button" disabled={locked} onClick={() => setEdit(null)}>Annuler</button>
              </form>}
            </div>)}
          </div>}
        </>
      )}
    </div>
  );
}
