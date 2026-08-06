import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { apiFetch, isApiError } from "../utils/api";
import { formatEuro } from "../utils/format";
import {
  computeExpenseReport,
  parseStatisticsPayload,
  type ParsedStatisticsPayload,
  type StatisticsPayload,
} from "./statistics/statisticsUtils";
import {
  computePersonalExpenseReport,
  getRecurringExpenseEquivalents,
  getRecurringExpenseAmountForFullYear,
  type ExpenseCategory,
  type PersonalExpenseEntry,
  type PersonalExpensePayload,
  type PersonalRecurringExpense,
} from "./personalExpenses/personalExpenseUtils";
import {
  computeConsolidatedFinancialReport,
  type ConsolidatedFinancialMonth,
} from "./personalExpenses/consolidatedFinancialUtils";

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
const formatPercent = (value: number) => new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(value || 0);
const formatEuroCompact = (value: number) => new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
}).format(value || 0);

const FINANCIAL_TOOLTIP_ROWS = [
  { key: "giteExpenses", label: "Frais gîtes", color: "#F5A623" },
  { key: "personalRecurring", label: "Frais perso récurrents", color: "#FF5A64" },
  { key: "personalPaid", label: "Ponctuels payés", color: "#43B77D" },
  { key: "personalPlanned", label: "Ponctuels prévus", color: "#7E5BEF" },
  { key: "revenue", label: "Revenus gîtes", color: "#2D8CFF" },
] as const;

type ConsolidatedMonthlyTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: ConsolidatedFinancialMonth }>;
};

const ConsolidatedMonthlyTooltip = ({ active, payload }: ConsolidatedMonthlyTooltipProps) => {
  const month = payload?.[0]?.payload;
  if (!active || !month) return null;

  return (
    <div className="personal-expenses-monthly-tooltip">
      <strong className="personal-expenses-monthly-tooltip__month">{MONTH_NAMES[month.month - 1]}</strong>
      <div className="personal-expenses-monthly-tooltip__details">
        {FINANCIAL_TOOLTIP_ROWS.map((row) => (
          <div key={row.key} style={{ "--tooltip-color": row.color } as CSSProperties}>
            <span>{row.label}</span><strong>{formatEuro(month[row.key])}</strong>
          </div>
        ))}
      </div>
      <div className={`personal-expenses-monthly-tooltip__result ${month.net < 0 ? "is-negative" : "is-positive"}`}>
        <span>Résultat consolidé du mois</span>
        <strong>{formatEuro(month.net)}</strong>
      </div>
    </div>
  );
};

const PersonalExpensesPage = () => {
  const currentYear = new Date().getUTCFullYear();
  const [payload, setPayload] = useState<PersonalExpensePayload | null>(null);
  const [statisticsDataset, setStatisticsDataset] = useState<ParsedStatisticsPayload | null>(null);
  const [statisticsDatasetYear, setStatisticsDatasetYear] = useState<number | null>(null);
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
      const [data, statisticsPayload] = await Promise.all([
        apiFetch<PersonalExpensePayload>("/personal-expenses"),
        apiFetch<StatisticsPayload>(`/statistics?year=${selectedYear}`),
      ]);
      setPayload(data);
      setStatisticsDataset(parseStatisticsPayload(statisticsPayload));
      setStatisticsDatasetYear(selectedYear);
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
      setError(isApiError(err) ? err.message : "Impossible de charger les données financières.");
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const report = useMemo(
    () => payload ? computePersonalExpenseReport({ payload, year: selectedYear, managerId: selectedManager }) : null,
    [payload, selectedManager, selectedYear]
  );
  const giteReport = useMemo(
    () => statisticsDataset && statisticsDatasetYear === selectedYear ? computeExpenseReport({
      entriesByGite: statisticsDataset.entriesByGite,
      gites: statisticsDataset.gites,
      expenseSettings: statisticsDataset.expenseSettings,
      selectedYear,
      selectedMonth: "",
      availableYears: statisticsDataset.availableYears,
    }) : null,
    [selectedYear, statisticsDataset, statisticsDatasetYear]
  );
  const giteMonthlyReports = useMemo(
    () => statisticsDataset && statisticsDatasetYear === selectedYear ? Array.from({ length: 12 }, (_, index) => computeExpenseReport({
      entriesByGite: statisticsDataset.entriesByGite,
      gites: statisticsDataset.gites,
      expenseSettings: statisticsDataset.expenseSettings,
      selectedYear,
      selectedMonth: index + 1,
      availableYears: statisticsDataset.availableYears,
    })) : [],
    [selectedYear, statisticsDataset, statisticsDatasetYear]
  );
  const consolidatedReport = useMemo(
    () => report && giteReport ? computeConsolidatedFinancialReport({
      gitePeriod: giteReport,
      giteMonths: giteMonthlyReports,
      personalPeriod: report,
    }) : null,
    [giteMonthlyReports, giteReport, report]
  );
  const consolidatedPeriodLabel = selectedYear === currentYear
    ? `${selectedYear} · au ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}`
    : String(selectedYear);
  const expenseDistribution = consolidatedReport ? [
    { name: "Frais des gîtes", value: consolidatedReport.giteExpenses, color: "#F5A623" },
    { name: "Frais perso récurrents", value: consolidatedReport.personalRecurring, color: "#FF5A64" },
    { name: "Ponctuels payés", value: consolidatedReport.personalPaid, color: "#43B77D" },
    { name: "Ponctuels prévus", value: consolidatedReport.personalPlanned, color: "#7E5BEF" },
  ].filter((item) => item.value > 0) : [];
  const years = useMemo(() => {
    const values = new Set([currentYear, currentYear - 1, currentYear + 1]);
    for (const expense of payload?.recurring ?? []) {
      values.add(new Date(expense.start_date).getUTCFullYear());
      if (expense.end_date) values.add(new Date(expense.end_date).getUTCFullYear());
    }
    for (const entry of payload?.entries ?? []) values.add(new Date(entry.expense_date).getUTCFullYear());
    for (const year of statisticsDataset?.availableYears ?? []) values.add(year);
    return [...values].sort((left, right) => right - left);
  }, [currentYear, payload, statisticsDataset?.availableYears]);

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

      <section className="card personal-expenses-financial-report">
        <div className="personal-expenses-financial-report__header">
          <div>
            <p className="personal-expenses-eyebrow">Rapport consolidé</p>
            <h2>Revenus et frais</h2>
            <p>Revenus globaux des gîtes comparés aux frais des gîtes et aux frais personnels.</p>
          </div>
          <span>{consolidatedPeriodLabel}</span>
        </div>

        {consolidatedReport ? <>
          <div className="personal-expenses-financial-kpis">
            <article><span>Revenus des gîtes</span><strong>{formatEuro(consolidatedReport.revenue)}</strong></article>
            <article><span>Frais des gîtes</span><strong>{formatEuro(consolidatedReport.giteExpenses)}</strong></article>
            <article><span>Frais personnels</span><strong>{formatEuro(consolidatedReport.personalExpenses)}</strong></article>
            <article className={consolidatedReport.net < 0 ? "is-negative" : "is-positive"}>
              <span>Résultat consolidé</span><strong>{formatEuro(consolidatedReport.net)}</strong>
              <small>{formatPercent(consolidatedReport.expenseRate)} du CA consacré aux frais</small>
            </article>
          </div>

          <div className="personal-expenses-financial-charts">
            <article className="personal-expenses-financial-panel">
              <div><h3>Comparaison mensuelle</h3><span>Revenus face au cumul des frais</span></div>
              {consolidatedReport.months.some((month) => month.revenue > 0 || month.totalExpenses > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={consolidatedReport.months} margin={{ top: 15, right: 10, left: 5, bottom: 5 }}>
                    <CartesianGrid vertical={false} stroke="#eef2f7" />
                    <XAxis dataKey="month" tickFormatter={(value) => MONTH_NAMES[Number(value) - 1]} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatEuroCompact(Number(value))} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ConsolidatedMonthlyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="revenue" name="Revenus gîtes" fill="#2D8CFF" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="giteExpenses" name="Frais gîtes" stackId="expenses" fill="#F5A623" isAnimationActive={false} />
                    <Bar dataKey="personalRecurring" name="Frais perso récurrents" stackId="expenses" fill="#FF5A64" isAnimationActive={false} />
                    <Bar dataKey="personalPaid" name="Ponctuels payés" stackId="expenses" fill="#43B77D" isAnimationActive={false} />
                    <Bar dataKey="personalPlanned" name="Ponctuels prévus" stackId="expenses" fill="#7E5BEF" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="stats-empty-chart">Aucune donnée financière sur cette période.</div>}
            </article>

            <article className="personal-expenses-financial-panel personal-expenses-financial-split">
              <div><h3>Répartition des frais</h3><span>{formatEuro(consolidatedReport.totalExpenses)} au total</span></div>
              {expenseDistribution.length ? <>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={expenseDistribution} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} isAnimationActive={false}>
                      {expenseDistribution.map((item) => <Cell key={item.name} fill={item.color} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatEuro(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="personal-expenses-financial-legend">
                  {expenseDistribution.map((item) => (
                    <div key={item.name} style={{ "--financial-color": item.color } as CSSProperties}>
                      <span /><span>{item.name}</span><strong>{formatEuro(item.value)}</strong>
                    </div>
                  ))}
                </div>
              </> : <div className="stats-empty-chart">Aucun frais sur cette période.</div>}
            </article>
          </div>

          <div className="personal-expenses-financial-table-wrap">
            <table className="personal-expenses-financial-table">
              <thead><tr><th>Mois</th><th>Revenus des gîtes</th><th>Frais des gîtes</th><th>Frais personnels</th><th>Résultat</th></tr></thead>
              <tbody>
                {consolidatedReport.months.filter((month) => !month.isFuture).map((month) => (
                  <tr key={month.month}>
                    <td><strong>{MONTH_NAMES[month.month - 1]}</strong></td>
                    <td>{formatEuro(month.revenue)}</td>
                    <td>{formatEuro(month.giteExpenses)}</td>
                    <td>{formatEuro(month.personalExpenses)}</td>
                    <td className={month.net < 0 ? "is-negative" : "is-positive"}>{formatEuro(month.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th>Total</th><th>{formatEuro(consolidatedReport.revenue)}</th><th>{formatEuro(consolidatedReport.giteExpenses)}</th><th>{formatEuro(consolidatedReport.personalExpenses)}</th><th className={consolidatedReport.net < 0 ? "is-negative" : "is-positive"}>{formatEuro(consolidatedReport.net)}</th></tr></tfoot>
            </table>
          </div>
        </> : <div className="stats-empty-chart">Chargement du rapport consolidé…</div>}
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
            const selectedYearTotal = getRecurringExpenseAmountForFullYear(expense, selectedYear);
            return (
              <article className="personal-expenses-recurring-row" key={expense.id} style={{ "--expense-color": expense.category.color } as CSSProperties}>
                <div className="personal-expenses-recurring-description"><strong>{expense.label}</strong><span>{managerName(expense.gestionnaire)} · {expense.category.name}</span></div>
                <div className="personal-expenses-recurring-amount personal-expenses-recurring-amount--monthly"><strong>{formatEuro(equivalents.monthly)}</strong><span>/ mois</span></div>
                <div className="personal-expenses-recurring-amount personal-expenses-recurring-amount--annual"><strong>{formatEuro(selectedYearTotal)}</strong><span>/ {selectedYear}</span></div>
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
