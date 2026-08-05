import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import {
  computePersonalExpenseReport,
  getRecurringExpenseEquivalents,
  type ExpenseCategory,
  type PersonalExpenseEntry,
  type PersonalExpensePayload,
  type PersonalRecurringExpense,
} from "./personalExpenses/personalExpenseUtils";

type RecurringDraft = {
  gestionnaire_id: string;
  category_id: string;
  label: string;
  frequency: "monthly" | "annual";
  amount: string;
  start_date: string;
  end_date: string;
  notes: string;
  is_active: boolean;
};

type EntryDraft = {
  gestionnaire_id: string;
  category_id: string;
  label: string;
  amount: string;
  expense_date: string;
  status: "planned" | "paid";
  notes: string;
};

type PersonalExpenseTab = "overview" | "recurring" | "entries" | "categories";

const MONTH_NAMES = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

const todayIso = () => new Date().toISOString().slice(0, 10);
const yearStartIso = () => `${new Date().getUTCFullYear()}-01-01`;
const emptyRecurring = (): RecurringDraft => ({
  gestionnaire_id: "",
  category_id: "",
  label: "",
  frequency: "monthly",
  amount: "",
  start_date: yearStartIso(),
  end_date: "",
  notes: "",
  is_active: true,
});
const emptyEntry = (): EntryDraft => ({
  gestionnaire_id: "",
  category_id: "",
  label: "",
  amount: "",
  expense_date: todayIso(),
  status: "paid",
  notes: "",
});
const managerName = (manager: { prenom: string; nom: string }) => `${manager.prenom} ${manager.nom}`.trim();
const dateOnly = (value: string) => value.slice(0, 10);

const PersonalExpensesPage = () => {
  const currentYear = new Date().getUTCFullYear();
  const [payload, setPayload] = useState<PersonalExpensePayload | null>(null);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedManager, setSelectedManager] = useState<string | "all">("all");
  const [activeTab, setActiveTab] = useState<PersonalExpenseTab>("overview");
  const [recurringDraft, setRecurringDraft] = useState<RecurringDraft>(emptyRecurring);
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(emptyEntry);
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#64748B");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<PersonalExpensePayload>("/personal-expenses");
      setPayload(data);
      const managerId = data.managers[0]?.id ?? "";
      const categoryId = data.categories[0]?.id ?? "";
      setRecurringDraft((current) => ({
        ...current,
        gestionnaire_id: current.gestionnaire_id || managerId,
        category_id: current.category_id || categoryId,
      }));
      setEntryDraft((current) => ({
        ...current,
        gestionnaire_id: current.gestionnaire_id || managerId,
        category_id: current.category_id || categoryId,
      }));
    } catch (err) {
      setError(isApiError(err) ? err.message : "Impossible de charger les frais personnels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const report = useMemo(
    () => payload ? computePersonalExpenseReport({ payload, year: selectedYear, managerId: selectedManager }) : null,
    [payload, selectedManager, selectedYear]
  );
  const years = useMemo(() => {
    const values = new Set([currentYear, currentYear - 1, currentYear + 1]);
    for (const expense of payload?.recurring ?? []) {
      values.add(new Date(expense.start_date).getUTCFullYear());
      if (expense.end_date) values.add(new Date(expense.end_date).getUTCFullYear());
    }
    for (const entry of payload?.entries ?? []) values.add(new Date(entry.expense_date).getUTCFullYear());
    return [...values].sort((left, right) => right - left);
  }, [currentYear, payload]);

  const recurringVisible = useMemo(
    () => (payload?.recurring ?? []).filter((expense) => selectedManager === "all" || expense.gestionnaire_id === selectedManager),
    [payload?.recurring, selectedManager]
  );
  const entriesVisible = useMemo(
    () => (payload?.entries ?? []).filter((entry) => {
      if (selectedManager !== "all" && entry.gestionnaire_id !== selectedManager) return false;
      return new Date(entry.expense_date).getUTCFullYear() === selectedYear;
    }),
    [payload?.entries, selectedManager, selectedYear]
  );

  const resetRecurring = () => {
    setEditingRecurringId(null);
    setRecurringDraft({
      ...emptyRecurring(),
      gestionnaire_id: payload?.managers[0]?.id ?? "",
      category_id: payload?.categories[0]?.id ?? "",
    });
  };
  const resetEntry = () => {
    setEditingEntryId(null);
    setEntryDraft({
      ...emptyEntry(),
      gestionnaire_id: payload?.managers[0]?.id ?? "",
      category_id: payload?.categories[0]?.id ?? "",
    });
  };

  const runMutation = async (action: () => Promise<unknown>, successMessage: string) => {
    try {
      setBusy(true);
      setError(null);
      setMessage(null);
      await action();
      setMessage(successMessage);
      await loadData();
      return true;
    } catch (err) {
      setError(isApiError(err) ? err.message : "L'opération n'a pas pu être enregistrée.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveRecurring = async () => {
    const success = await runMutation(
      () => apiFetch(editingRecurringId ? `/personal-expenses/recurring/${editingRecurringId}` : "/personal-expenses/recurring", {
        method: editingRecurringId ? "PUT" : "POST",
        json: {
          ...recurringDraft,
          amount: Number(recurringDraft.amount),
          end_date: recurringDraft.end_date || null,
        },
      }),
      editingRecurringId ? "Frais récurrent mis à jour." : "Frais récurrent ajouté."
    );
    if (success) resetRecurring();
  };

  const saveEntry = async () => {
    const success = await runMutation(
      () => apiFetch(editingEntryId ? `/personal-expenses/entries/${editingEntryId}` : "/personal-expenses/entries", {
        method: editingEntryId ? "PUT" : "POST",
        json: { ...entryDraft, amount: Number(entryDraft.amount) },
      }),
      editingEntryId ? "Dépense mise à jour." : "Dépense ajoutée."
    );
    if (success) resetEntry();
  };

  const editRecurring = (expense: PersonalRecurringExpense) => {
    setEditingRecurringId(expense.id);
    setRecurringDraft({
      gestionnaire_id: expense.gestionnaire_id,
      category_id: expense.category_id,
      label: expense.label,
      frequency: expense.frequency,
      amount: String(expense.amount),
      start_date: dateOnly(expense.start_date),
      end_date: expense.end_date ? dateOnly(expense.end_date) : "",
      notes: expense.notes,
      is_active: expense.is_active,
    });
    document.getElementById("personal-recurring-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const editEntry = (entry: PersonalExpenseEntry) => {
    setEditingEntryId(entry.id);
    setEntryDraft({
      gestionnaire_id: entry.gestionnaire_id,
      category_id: entry.category_id,
      label: entry.label,
      amount: String(entry.amount),
      expense_date: dateOnly(entry.expense_date),
      status: entry.status,
      notes: entry.notes,
    });
    document.getElementById("personal-entry-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const updateCategory = async (category: ExpenseCategory, patch: Partial<Pick<ExpenseCategory, "name" | "color">>) => {
    const next = { ...category, ...patch };
    setPayload((current) => current ? {
      ...current,
      categories: current.categories.map((item) => item.id === category.id ? next : item),
    } : current);
    await runMutation(
      () => apiFetch(`/personal-expenses/categories/${category.id}`, {
        method: "PUT",
        json: { name: next.name, color: next.color },
      }),
      "Catégorie mise à jour."
    );
  };

  if (loading && !payload) return <div className="card">Chargement des frais personnels…</div>;

  return (
    <div className="personal-expenses-page">
      <section className="card personal-expenses-hero">
        <div className="personal-expenses-hero__heading">
          <div>
            <p className="personal-expenses-eyebrow">Gestion financière</p>
            <h1>Frais personnels</h1>
            <p>Suivez les charges récurrentes et les dépenses ponctuelles de chaque personne.</p>
          </div>
          <div className="personal-expenses-tabs" aria-label="Périmètre des frais">
            <span className="active">Personnels</span>
            <Link to="/gites">Frais des gîtes</Link>
          </div>
        </div>

        <div className="personal-expenses-filters">
          <label className="field">
            Année
            <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="field">
            Personne
            <select value={selectedManager} onChange={(event) => setSelectedManager(event.target.value)}>
              <option value="all">Toutes les personnes</option>
              {(payload?.managers ?? []).map((manager) => (
                <option key={manager.id} value={manager.id}>{managerName(manager)}</option>
              ))}
            </select>
          </label>
        </div>
        {error ? <div className="stats-import-alert stats-import-alert--error">{error}</div> : null}
        {message ? <div className="stats-import-alert stats-import-alert--success">{message}</div> : null}
      </section>

      <nav className="card personal-expenses-section-tabs" aria-label="Sections des frais personnels">
        <button type="button" className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Vue d'ensemble</button>
        <button type="button" className={activeTab === "recurring" ? "active" : ""} onClick={() => setActiveTab("recurring")}>Récurrents <span>{recurringVisible.length}</span></button>
        <button type="button" className={activeTab === "entries" ? "active" : ""} onClick={() => setActiveTab("entries")}>Ponctuels <span>{entriesVisible.length}</span></button>
        <button type="button" className={activeTab === "categories" ? "active" : ""} onClick={() => setActiveTab("categories")}>Catégories <span>{payload?.categories.length ?? 0}</span></button>
      </nav>

      {activeTab === "overview" ? <>
      <section className="personal-expenses-kpis">
        <article className="card"><span>Frais récurrents</span><strong>{formatEuro(report?.recurring ?? 0)}</strong></article>
        <article className="card"><span>Ponctuels payés</span><strong>{formatEuro(report?.paid ?? 0)}</strong></article>
        <article className="card"><span>Ponctuels prévus</span><strong>{formatEuro(report?.planned ?? 0)}</strong></article>
        <article className="card personal-expenses-kpis__total">
          <span>Total à date</span><strong>{formatEuro(report?.total ?? 0)}</strong>
          <small>{formatEuro(report?.monthlyAverage ?? 0)} / mois en moyenne</small>
        </article>
      </section>

      <section className="personal-expenses-charts">
        <article className="card personal-expenses-chart">
          <h2>Évolution mensuelle</h2>
          <p>Récurrents, dépenses payées et dépenses prévues mois par mois.</p>
          {(report?.byMonth.some((row) => row.total > 0)) ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={report.byMonth} margin={{ top: 15, right: 10, left: 5, bottom: 5 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="month" tickFormatter={(value) => MONTH_NAMES[Number(value) - 1]} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => formatEuro(Number(value))} />
                <Legend />
                <Bar dataKey="recurring" name="Récurrents" stackId="expenses" fill="#2D8CFF" isAnimationActive={false} />
                <Bar dataKey="paid" name="Payés" stackId="expenses" fill="#43B77D" isAnimationActive={false} />
                <Bar dataKey="planned" name="Prévus" stackId="expenses" fill="#F5A623" radius={[5, 5, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="stats-empty-chart">Aucun frais sur cette période.</div>}
        </article>
        <article className="card personal-expenses-chart personal-expenses-category-chart">
          <h2>Répartition par catégorie</h2>
          <p>{formatEuro(report?.total ?? 0)} au total.</p>
          {(report?.byCategory.length ?? 0) > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={report?.byCategory} dataKey="total" nameKey="name" innerRadius={46} outerRadius={76} isAnimationActive={false}>
                    {report?.byCategory.map((category) => <Cell key={category.id} fill={category.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatEuro(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="personal-expenses-category-legend">
                {report?.byCategory.map((category) => (
                  <div key={category.id} style={{ "--category-color": category.color } as CSSProperties}>
                    <span /><span>{category.name}</span><strong>{formatEuro(category.total)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="stats-empty-chart">Aucune catégorie utilisée.</div>}
        </article>
      </section>
      </> : null}

      {activeTab === "recurring" ? <section className="card personal-expenses-editor">
        <div className="personal-expenses-section-heading">
          <div><h2>Frais récurrents</h2><p>Abonnements, assurances et autres charges mensuelles ou annuelles.</p></div>
          {editingRecurringId ? <button type="button" className="button-secondary" onClick={resetRecurring}>Annuler la modification</button> : null}
        </div>
        <div className="personal-expenses-list">
          {recurringVisible.map((expense) => {
            const equivalents = getRecurringExpenseEquivalents(expense);
            return (
              <article className="personal-expenses-recurring-row" key={expense.id} style={{ "--expense-color": expense.category.color } as CSSProperties}>
                <div className="personal-expenses-recurring-description"><strong>{expense.label}</strong><span>{managerName(expense.gestionnaire)} · {expense.category.name}</span></div>
                <div className="personal-expenses-recurring-amount personal-expenses-recurring-amount--monthly"><strong>{formatEuro(equivalents.monthly)}</strong><span>/ mois</span></div>
                <div className="personal-expenses-recurring-amount personal-expenses-recurring-amount--annual"><strong>{formatEuro(equivalents.annual)}</strong><span>/ an</span></div>
                <span className={`personal-expenses-status ${expense.is_active ? "is-paid" : "is-inactive"}`}>{expense.is_active ? "Actif" : "Inactif"}</span>
                <div className="personal-expenses-row-actions"><button type="button" className="table-action" onClick={() => editRecurring(expense)}>Modifier</button><button type="button" className="table-action table-action--danger" onClick={() => { if (window.confirm(`Supprimer « ${expense.label} » ?`)) void runMutation(() => apiFetch(`/personal-expenses/recurring/${expense.id}`, { method: "DELETE" }), "Frais supprimé."); }}>Supprimer</button></div>
              </article>
            );
          })}
          {recurringVisible.length === 0 ? <div className="stats-empty-chart">Aucun frais récurrent.</div> : null}
        </div>
        <div id="personal-recurring-form">
          {(payload?.managers.length ?? 0) === 0 ? <div className="note">Ajoutez d'abord une personne dans la gestion des gîtes.</div> : (
            <div className="personal-expenses-form-grid">
              <label className="field">Personne<select value={recurringDraft.gestionnaire_id} onChange={(e) => setRecurringDraft((d) => ({ ...d, gestionnaire_id: e.target.value }))}>{payload?.managers.map((m) => <option key={m.id} value={m.id}>{managerName(m)}</option>)}</select></label>
              <label className="field">Libellé<input value={recurringDraft.label} onChange={(e) => setRecurringDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Ex. Mutuelle" /></label>
              <label className="field">Catégorie<select value={recurringDraft.category_id} onChange={(e) => setRecurringDraft((d) => ({ ...d, category_id: e.target.value }))}>{payload?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="field">Fréquence<select value={recurringDraft.frequency} onChange={(e) => setRecurringDraft((d) => ({ ...d, frequency: e.target.value as RecurringDraft["frequency"] }))}><option value="monthly">Mensuelle</option><option value="annual">Annuelle</option></select></label>
              <label className="field">Montant<input type="number" min="0.01" step="0.01" value={recurringDraft.amount} onChange={(e) => setRecurringDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
              <label className="field">Début<input type="date" value={recurringDraft.start_date} onChange={(e) => setRecurringDraft((d) => ({ ...d, start_date: e.target.value }))} /></label>
              <label className="field">Fin facultative<input type="date" value={recurringDraft.end_date} onChange={(e) => setRecurringDraft((d) => ({ ...d, end_date: e.target.value }))} /></label>
              <label className="field personal-expenses-form-grid__notes">Notes<input value={recurringDraft.notes} onChange={(e) => setRecurringDraft((d) => ({ ...d, notes: e.target.value }))} /></label>
              <label className="personal-expenses-active"><input type="checkbox" checked={recurringDraft.is_active} onChange={(e) => setRecurringDraft((d) => ({ ...d, is_active: e.target.checked }))} />Actif</label>
              <button type="button" disabled={busy || !recurringDraft.label || !recurringDraft.amount || !recurringDraft.gestionnaire_id || !recurringDraft.category_id} onClick={() => void saveRecurring()}>{editingRecurringId ? "Mettre à jour" : "Ajouter le frais"}</button>
            </div>
          )}
        </div>
      </section> : null}

      {activeTab === "entries" ? <section className="card personal-expenses-editor" id="personal-entry-form">
        <div className="personal-expenses-section-heading">
          <div><h2>Dépenses ponctuelles</h2><p>Enregistrez une dépense payée ou prévue à une date précise.</p></div>
          {editingEntryId ? <button type="button" className="button-secondary" onClick={resetEntry}>Annuler la modification</button> : null}
        </div>
        <div className="personal-expenses-form-grid personal-expenses-form-grid--entry">
          <label className="field">Personne<select value={entryDraft.gestionnaire_id} onChange={(e) => setEntryDraft((d) => ({ ...d, gestionnaire_id: e.target.value }))}>{payload?.managers.map((m) => <option key={m.id} value={m.id}>{managerName(m)}</option>)}</select></label>
          <label className="field">Libellé<input value={entryDraft.label} onChange={(e) => setEntryDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Ex. Réparation véhicule" /></label>
          <label className="field">Catégorie<select value={entryDraft.category_id} onChange={(e) => setEntryDraft((d) => ({ ...d, category_id: e.target.value }))}>{payload?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field">Montant<input type="number" min="0.01" step="0.01" value={entryDraft.amount} onChange={(e) => setEntryDraft((d) => ({ ...d, amount: e.target.value }))} /></label>
          <label className="field">Date<input type="date" value={entryDraft.expense_date} onChange={(e) => setEntryDraft((d) => ({ ...d, expense_date: e.target.value }))} /></label>
          <label className="field">Statut<select value={entryDraft.status} onChange={(e) => setEntryDraft((d) => ({ ...d, status: e.target.value as EntryDraft["status"] }))}><option value="paid">Payée</option><option value="planned">Prévue</option></select></label>
          <label className="field personal-expenses-form-grid__notes">Notes<input value={entryDraft.notes} onChange={(e) => setEntryDraft((d) => ({ ...d, notes: e.target.value }))} /></label>
          <button type="button" disabled={busy || !entryDraft.label || !entryDraft.amount || !entryDraft.gestionnaire_id || !entryDraft.category_id} onClick={() => void saveEntry()}>{editingEntryId ? "Mettre à jour" : "Ajouter la dépense"}</button>
        </div>
        <div className="personal-expenses-list">
          {entriesVisible.map((entry) => (
            <article key={entry.id} style={{ "--expense-color": entry.category.color } as CSSProperties}>
              <div><strong>{entry.label}</strong><span>{managerName(entry.gestionnaire)} · {entry.category.name} · {new Date(entry.expense_date).toLocaleDateString("fr-FR")}</span></div>
              <div><strong>{formatEuro(entry.amount)}</strong></div>
              <span className={`personal-expenses-status ${entry.status === "paid" ? "is-paid" : "is-planned"}`}>{entry.status === "paid" ? "Payée" : "Prévue"}</span>
              <div className="personal-expenses-row-actions"><button type="button" className="table-action" onClick={() => editEntry(entry)}>Modifier</button><button type="button" className="table-action table-action--danger" onClick={() => { if (window.confirm(`Supprimer « ${entry.label} » ?`)) void runMutation(() => apiFetch(`/personal-expenses/entries/${entry.id}`, { method: "DELETE" }), "Dépense supprimée."); }}>Supprimer</button></div>
            </article>
          ))}
          {entriesVisible.length === 0 ? <div className="stats-empty-chart">Aucune dépense ponctuelle pour {selectedYear}.</div> : null}
        </div>
      </section> : null}

      {activeTab === "categories" ? <section className="card personal-expenses-editor">
        <div className="personal-expenses-section-heading"><div><h2>Catégories</h2><p>Les catégories sont communes aux rapports et pourront être réutilisées lors de la migration des frais des gîtes.</p></div></div>
        <div className="personal-expenses-category-editor">
          {payload?.categories.map((category) => (
            <article key={category.id} style={{ "--expense-color": category.color } as CSSProperties}>
              <input type="color" value={category.color} onChange={(event) => void updateCategory(category, { color: event.target.value })} aria-label={`Couleur ${category.name}`} />
              <input value={category.name} onChange={(event) => setPayload((current) => current ? { ...current, categories: current.categories.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item) } : current)} onBlur={(event) => { if (event.target.value.trim()) void updateCategory({ ...category, name: event.target.value }, {}); }} />
              <button type="button" className="table-action table-action--danger" onClick={() => { if (window.confirm(`Supprimer la catégorie « ${category.name} » ?`)) void runMutation(() => apiFetch(`/personal-expenses/categories/${category.id}`, { method: "DELETE" }), "Catégorie supprimée."); }}>Supprimer</button>
            </article>
          ))}
        </div>
        <div className="personal-expenses-category-add">
          <input type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} aria-label="Couleur de la nouvelle catégorie" />
          <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Nouvelle catégorie" />
          <button type="button" disabled={busy || !newCategoryName.trim()} onClick={() => void runMutation(() => apiFetch("/personal-expenses/categories", { method: "POST", json: { name: newCategoryName, color: newCategoryColor } }), "Catégorie ajoutée.").then((success) => { if (success) setNewCategoryName(""); })}>Ajouter</button>
        </div>
      </section> : null}
    </div>
  );
};

export default PersonalExpensesPage;
