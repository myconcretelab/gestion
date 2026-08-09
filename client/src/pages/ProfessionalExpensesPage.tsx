import { useEffect, useMemo, useState } from "react";
import { apiFetch, formatApiErrorMessage } from "../utils/api";
import { formatEuro } from "../utils/format";
import type { Gite, Intervenant } from "../utils/types";

type Category = { id: string; name: string; color: string };
type RecurringLine = {
  id: string;
  label: string;
  category_id: string;
  monthly_amount: number;
  annual_amount: number;
  notes: string;
};
type ExpenseManagement = { version: 1; categories: Category[]; expenses: RecurringLine[] };
type DynamicRule = {
  id: string;
  label: string;
  category_id: string;
  basis: "urssaf_revenue";
  rate: number;
  enabled: boolean;
};
type OneOffExpense = {
  id: string;
  label: string;
  intervenant_id: string | null;
  intervenant_nom: string | null;
  scope: "all_gites" | "gite";
  gite_id: string | null;
  gite_nom: string | null;
  year: number;
  month: number;
  amount: number;
  notes: string;
};
type OneOffDraft = {
  label: string;
  month: string;
  amount: string;
  gite_id: string;
  intervenant_id: string;
  notes: string;
};
type Section = "overview" | "recurring" | "one-off" | "rules";

const DEFAULT_CATEGORIES: Category[] = [
  { id: "energie", name: "Énergie", color: "#2d8cff" },
  { id: "entretien", name: "Entretien", color: "#43b77d" },
  { id: "taxes", name: "Taxes", color: "#f5a623" },
  { id: "assurance", name: "Assurance", color: "#7e5bef" },
];
const COLORS = ["#2d8cff", "#43b77d", "#f5a623", "#7e5bef", "#fe5c73", "#14b8a6"];
const localId = (prefix: string) => globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}`;
const monthValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const normalizeMoney = (value: unknown) => {
  const amount = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
};
const normalizeManagement = (gite: Gite, categories: Category[]): ExpenseManagement => ({
  version: 1,
  categories,
  expenses: (gite.frais_gestion?.expenses ?? []).map((line) => ({
    id: line.id,
    label: line.label ?? "",
    category_id: categories.some((category) => category.id === line.category_id)
      ? line.category_id
      : categories[0]?.id ?? "",
    monthly_amount: normalizeMoney(line.monthly_amount),
    annual_amount: normalizeMoney(line.annual_amount),
    notes: line.notes ?? "",
  })),
});
const buildOneOffPayload = (draft: OneOffDraft) => {
  const [year, month] = draft.month.split("-").map(Number);
  return {
    label: draft.label.trim(),
    year,
    month,
    amount: normalizeMoney(draft.amount),
    scope: draft.gite_id ? "gite" : "all_gites",
    gite_id: draft.gite_id || null,
    intervenant_id: draft.intervenant_id || null,
    notes: draft.notes.trim(),
  };
};
const draftFromOneOff = (expense: OneOffExpense): OneOffDraft => ({
  label: expense.label,
  month: `${expense.year}-${String(expense.month).padStart(2, "0")}`,
  amount: String(expense.amount),
  gite_id: expense.scope === "gite" ? expense.gite_id ?? "" : "",
  intervenant_id: expense.intervenant_id ?? "",
  notes: expense.notes,
});

const ProfessionalExpensesPage = () => {
  const [section, setSection] = useState<Section>("overview");
  const [gites, setGites] = useState<Gite[]>([]);
  const [intervenants, setIntervenants] = useState<Intervenant[]>([]);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [rules, setRules] = useState<DynamicRule[]>([]);
  const [recurringDrafts, setRecurringDrafts] = useState<Record<string, ExpenseManagement>>({});
  const [oneOffExpenses, setOneOffExpenses] = useState<OneOffExpense[]>([]);
  const [oneOffDrafts, setOneOffDrafts] = useState<Record<string, OneOffDraft>>({});
  const [newOneOff, setNewOneOff] = useState<OneOffDraft>({
    label: "", month: monthValue(), amount: "", gite_id: "", intervenant_id: "", notes: "",
  });
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [gitesData, settings, workers, oneOff] = await Promise.all([
        apiFetch<Gite[]>("/gites"),
        apiFetch<{ categories: Category[]; dynamic_expenses: DynamicRule[] }>("/gites/expense-categories"),
        apiFetch<Intervenant[]>("/intervenants"),
        apiFetch<OneOffExpense[]>("/professional-expenses/one-off"),
      ]);
      const nextCategories = settings.categories.length ? settings.categories : DEFAULT_CATEGORIES;
      setGites(gitesData);
      setCategories(nextCategories);
      setRules(settings.dynamic_expenses ?? []);
      setIntervenants(workers);
      setOneOffExpenses(oneOff);
      setRecurringDrafts(Object.fromEntries(gitesData.map((gite) => [gite.id, normalizeManagement(gite, nextCategories)])));
      setOneOffDrafts(Object.fromEntries(oneOff.map((expense) => [expense.id, draftFromOneOff(expense)])));
      setError(null);
    } catch (caught) {
      setError(formatApiErrorMessage(caught, "Impossible de charger les frais professionnels."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const recurringTotals = useMemo(() => Object.values(recurringDrafts).reduce(
    (totals, management) => {
      for (const line of management.expenses) {
        totals.monthly += normalizeMoney(line.monthly_amount);
        totals.annual += normalizeMoney(line.annual_amount);
      }
      return totals;
    },
    { monthly: 0, annual: 0 },
  ), [recurringDrafts]);
  const filteredOneOff = useMemo(
    () => oneOffExpenses.filter((expense) => expense.year === year),
    [oneOffExpenses, year],
  );
  const oneOffTotal = filteredOneOff.reduce((sum, expense) => sum + expense.amount, 0);
  const years = [...new Set([new Date().getFullYear(), ...oneOffExpenses.map((expense) => expense.year)])].sort((a, b) => b - a);

  const updateRecurring = (giteId: string, updater: (current: ExpenseManagement) => ExpenseManagement) =>
    setRecurringDrafts((current) => ({ ...current, [giteId]: updater(current[giteId]) }));
  const addRecurring = (giteId: string) => updateRecurring(giteId, (current) => ({
    ...current,
    expenses: [...current.expenses, {
      id: localId("fee"), label: "", category_id: categories[0]?.id ?? "",
      monthly_amount: 0, annual_amount: 0, notes: "",
    }],
  }));
  const patchRecurring = (giteId: string, expenseId: string, patch: Partial<RecurringLine>) =>
    updateRecurring(giteId, (current) => ({
      ...current,
      expenses: current.expenses.map((line) => line.id === expenseId ? { ...line, ...patch } : line),
    }));
  const saveRecurring = async (giteId: string) => {
    setSavingId(giteId); setError(null); setNotice(null);
    try {
      await apiFetch(`/gites/${giteId}/expenses`, {
        method: "PUT", json: { frais_gestion: { ...recurringDrafts[giteId], categories } },
      });
      setNotice("Frais récurrents enregistrés.");
    } catch (caught) { setError(formatApiErrorMessage(caught, "Enregistrement impossible.")); }
    finally { setSavingId(null); }
  };

  const validateOneOff = (draft: OneOffDraft) => {
    if (!draft.label.trim()) { setError("Le libellé est obligatoire."); return false; }
    if (!/^\d{4}-\d{2}$/.test(draft.month)) { setError("Choisissez un mois valide."); return false; }
    if (normalizeMoney(draft.amount) <= 0) { setError("Le montant doit être supérieur à zéro."); return false; }
    return true;
  };
  const createOneOff = async () => {
    if (!validateOneOff(newOneOff)) return;
    setSavingId("new-one-off"); setError(null); setNotice(null);
    try {
      await apiFetch("/professional-expenses/one-off", { method: "POST", json: buildOneOffPayload(newOneOff) });
      setNewOneOff({ label: "", month: newOneOff.month, amount: "", gite_id: "", intervenant_id: "", notes: "" });
      await load(); setNotice("Frais ponctuel ajouté.");
    } catch (caught) { setError(formatApiErrorMessage(caught, "Ajout impossible.")); }
    finally { setSavingId(null); }
  };
  const saveOneOff = async (expense: OneOffExpense) => {
    const draft = oneOffDrafts[expense.id]; if (!draft || !validateOneOff(draft)) return;
    setSavingId(expense.id); setError(null); setNotice(null);
    try {
      await apiFetch(`/professional-expenses/one-off/${expense.id}`, { method: "PATCH", json: buildOneOffPayload(draft) });
      await load(); setNotice("Frais ponctuel modifié.");
    } catch (caught) { setError(formatApiErrorMessage(caught, "Modification impossible.")); }
    finally { setSavingId(null); }
  };
  const deleteOneOff = async (expense: OneOffExpense) => {
    if (!confirm(`Supprimer « ${expense.label} » ?`)) return;
    setSavingId(expense.id);
    try { await apiFetch(`/professional-expenses/one-off/${expense.id}`, { method: "DELETE" }); await load(); setNotice("Frais supprimé."); }
    catch (caught) { setError(formatApiErrorMessage(caught, "Suppression impossible.")); }
    finally { setSavingId(null); }
  };
  const saveRules = async () => {
    setSavingId("rules"); setError(null); setNotice(null);
    try {
      await apiFetch("/gites/expense-categories", { method: "PUT", json: { categories, dynamic_expenses: rules } });
      setNotice("Catégories et règles enregistrées.");
    } catch (caught) { setError(formatApiErrorMessage(caught, "Enregistrement impossible.")); }
    finally { setSavingId(null); }
  };

  if (loading) return <div className="card">Chargement des frais professionnels...</div>;

  return (
    <div className="professional-expenses-page">
      <header className="professional-expenses-hero">
        <div><span>Gestion financière</span><h1>Frais professionnels</h1><p>Centralisez les charges récurrentes, les règles automatiques et les dépenses ponctuelles de tous les gîtes.</p></div>
        <label className="field">Année<select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item}>{item}</option>)}</select></label>
      </header>
      <nav className="professional-expenses-tabs" aria-label="Rubriques des frais professionnels">
        {([
          ["overview", "Vue d’ensemble"], ["recurring", "Frais récurrents"],
          ["one-off", "Frais ponctuels"], ["rules", "Catégories et règles"],
        ] as Array<[Section, string]>).map(([id, label]) => <button key={id} type="button" className={section === id ? "is-active" : ""} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      {notice ? <div className="note note--success">{notice}</div> : null}
      {error ? <div className="note">{error}</div> : null}

      {section === "overview" ? <section className="professional-expenses-overview">
        <article className="card"><span>Budget récurrent mensuel</span><strong>{formatEuro(recurringTotals.monthly)}</strong><small>Somme configurée pour les gîtes</small></article>
        <article className="card"><span>Budget récurrent annuel</span><strong>{formatEuro(recurringTotals.annual)}</strong><small>Hors règles dynamiques</small></article>
        <article className="card"><span>Frais ponctuels {year}</span><strong>{formatEuro(oneOffTotal)}</strong><small>{filteredOneOff.length} dépense(s), informatives dans les statistiques</small></article>
        <article className="card"><span>Règles automatiques</span><strong>{rules.filter((rule) => rule.enabled).length}</strong><small>règle(s) active(s)</small></article>
        <div className="card professional-expenses-breakdown"><h2>Répartition des frais ponctuels</h2>{gites.map((gite) => {
          const total = filteredOneOff.filter((expense) => expense.gite_id === gite.id).reduce((sum, expense) => sum + expense.amount, 0);
          return <div key={gite.id}><span>{gite.nom}</span><strong>{formatEuro(total)}</strong></div>;
        })}<div><span>Frais globaux</span><strong>{formatEuro(filteredOneOff.filter((expense) => expense.scope === "all_gites").reduce((sum, expense) => sum + expense.amount, 0))}</strong></div></div>
      </section> : null}

      {section === "recurring" ? <section className="professional-expenses-list">{gites.map((gite) => {
        const management = recurringDrafts[gite.id];
        return <article key={gite.id} className="card professional-expenses-gite"><header><div><span>Gîte</span><h2>{gite.nom}</h2></div><strong>{formatEuro(management.expenses.reduce((sum, line) => sum + line.annual_amount, 0))} / an</strong></header>
          {management.expenses.map((line) => <div key={line.id} className="professional-recurring-line">
            <input aria-label="Libellé" placeholder="Assurance, énergie..." value={line.label} onChange={(event) => patchRecurring(gite.id, line.id, { label: event.target.value })} />
            <select aria-label="Catégorie" value={line.category_id} onChange={(event) => patchRecurring(gite.id, line.id, { category_id: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <label><span>€/mois</span><input type="number" min="0" step="0.01" value={line.monthly_amount} onChange={(event) => { const monthly = normalizeMoney(event.target.value); patchRecurring(gite.id, line.id, { monthly_amount: monthly, annual_amount: normalizeMoney(monthly * 12) }); }} /></label>
            <label><span>€/an</span><input type="number" min="0" step="0.01" value={line.annual_amount} onChange={(event) => { const annual = normalizeMoney(event.target.value); patchRecurring(gite.id, line.id, { annual_amount: annual, monthly_amount: normalizeMoney(annual / 12) }); }} /></label>
            <input aria-label="Notes" placeholder="Notes" value={line.notes} onChange={(event) => patchRecurring(gite.id, line.id, { notes: event.target.value })} />
            <button type="button" className="danger" onClick={() => updateRecurring(gite.id, (current) => ({ ...current, expenses: current.expenses.filter((item) => item.id !== line.id) }))}>Supprimer</button>
          </div>)}
          <footer><button type="button" className="secondary" onClick={() => addRecurring(gite.id)}>Ajouter une ligne</button><button type="button" onClick={() => void saveRecurring(gite.id)} disabled={savingId === gite.id}>{savingId === gite.id ? "Enregistrement..." : "Enregistrer ce gîte"}</button></footer>
        </article>;
      })}</section> : null}

      {section === "one-off" ? <section className="professional-expenses-list">
        <article className="card professional-one-off-create"><h2>Ajouter un frais ponctuel</h2><div className="professional-one-off-grid">
          <label className="field">Libellé<input value={newOneOff.label} onChange={(event) => setNewOneOff((current) => ({ ...current, label: event.target.value }))} placeholder="Petit matériel, intervention..." /></label>
          <label className="field">Mois<input type="month" value={newOneOff.month} onChange={(event) => setNewOneOff((current) => ({ ...current, month: event.target.value }))} /></label>
          <label className="field">Montant (€)<input type="number" min="0.01" step="0.01" value={newOneOff.amount} onChange={(event) => setNewOneOff((current) => ({ ...current, amount: event.target.value }))} /></label>
          <label className="field">Portée<select value={newOneOff.gite_id} onChange={(event) => setNewOneOff((current) => ({ ...current, gite_id: event.target.value }))}><option value="">Tous les gîtes</option>{gites.map((gite) => <option key={gite.id} value={gite.id}>{gite.nom}</option>)}</select></label>
          <label className="field">Intervenant (facultatif)<select value={newOneOff.intervenant_id} onChange={(event) => setNewOneOff((current) => ({ ...current, intervenant_id: event.target.value }))}><option value="">Aucun</option>{intervenants.map((item) => <option key={item.id} value={item.id}>{item.nom}</option>)}</select></label>
          <label className="field">Note<input value={newOneOff.notes} onChange={(event) => setNewOneOff((current) => ({ ...current, notes: event.target.value }))} /></label>
        </div><button type="button" onClick={() => void createOneOff()} disabled={savingId === "new-one-off"}>{savingId === "new-one-off" ? "Ajout..." : "Ajouter le frais"}</button></article>
        {filteredOneOff.length === 0 ? <div className="card">Aucun frais ponctuel enregistré pour {year}.</div> : null}
        {filteredOneOff.map((expense) => { const draft = oneOffDrafts[expense.id]; return <article key={expense.id} className="card professional-one-off-item"><div className="professional-one-off-grid">
          <label className="field">Libellé<input value={draft.label} onChange={(event) => setOneOffDrafts((current) => ({ ...current, [expense.id]: { ...draft, label: event.target.value } }))} /></label>
          <label className="field">Mois<input type="month" value={draft.month} onChange={(event) => setOneOffDrafts((current) => ({ ...current, [expense.id]: { ...draft, month: event.target.value } }))} /></label>
          <label className="field">Montant (€)<input type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => setOneOffDrafts((current) => ({ ...current, [expense.id]: { ...draft, amount: event.target.value } }))} /></label>
          <label className="field">Portée<select value={draft.gite_id} onChange={(event) => setOneOffDrafts((current) => ({ ...current, [expense.id]: { ...draft, gite_id: event.target.value } }))}><option value="">Tous les gîtes</option>{gites.map((gite) => <option key={gite.id} value={gite.id}>{gite.nom}</option>)}</select></label>
          <label className="field">Intervenant<select value={draft.intervenant_id} onChange={(event) => setOneOffDrafts((current) => ({ ...current, [expense.id]: { ...draft, intervenant_id: event.target.value } }))}><option value="">Aucun</option>{intervenants.map((item) => <option key={item.id} value={item.id}>{item.nom}</option>)}</select></label>
          <label className="field">Note<input value={draft.notes} onChange={(event) => setOneOffDrafts((current) => ({ ...current, [expense.id]: { ...draft, notes: event.target.value } }))} /></label>
        </div><footer><button type="button" onClick={() => void saveOneOff(expense)} disabled={savingId === expense.id}>Enregistrer</button><button type="button" className="danger" onClick={() => void deleteOneOff(expense)} disabled={savingId === expense.id}>Supprimer</button></footer></article>; })}
      </section> : null}

      {section === "rules" ? <section className="professional-expenses-list"><article className="card"><h2>Catégories</h2><div className="professional-categories">{categories.map((category) => <div key={category.id}><input type="color" value={category.color} onChange={(event) => setCategories((current) => current.map((item) => item.id === category.id ? { ...item, color: event.target.value } : item))} /><input value={category.name} onChange={(event) => setCategories((current) => current.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item))} /></div>)}<button type="button" className="secondary" onClick={() => setCategories((current) => [...current, { id: localId("cat"), name: "Nouvelle catégorie", color: COLORS[current.length % COLORS.length] }])}>Ajouter une catégorie</button></div></article>
        <article className="card"><h2>Règles automatiques</h2>{rules.map((rule) => <div key={rule.id} className="professional-rule"><label><input type="checkbox" checked={rule.enabled} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item))} /> Active</label><input value={rule.label} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, label: event.target.value } : item))} /><select value={rule.category_id} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, category_id: event.target.value } : item))}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><label><input type="number" min="0" max="100" step="0.1" value={rule.rate * 100} onChange={(event) => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, rate: Number(event.target.value) / 100 } : item))} /> % du CA</label></div>)}<button type="button" onClick={() => void saveRules()} disabled={savingId === "rules"}>{savingId === "rules" ? "Enregistrement..." : "Enregistrer les catégories et règles"}</button></article>
      </section> : null}
    </div>
  );
};

export default ProfessionalExpensesPage;
