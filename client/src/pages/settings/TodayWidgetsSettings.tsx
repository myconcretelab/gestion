import { useEffect, useMemo, useState } from "react";
import type { AppUser } from "../../utils/auth";
import {
  DEFAULT_TODAY_WIDGET_PREFERENCES,
  TODAY_REVENUE_METRICS,
  TODAY_WIDGET_CATALOG,
  WEEKDAY_OPTIONS,
  moveTodayWidget,
  normalizeTodayWidgetPreferences,
  readTodayWidgetPreferences,
  writeTodayWidgetPreferences,
  type TodayRevenueMetricId,
  type TodayWidgetId,
  type TodayWidgetPreferences,
  type TodayWidgetWidth,
  type TrashCollection,
} from "../../utils/todayWidgets";

const WIDTH_LABELS: Record<TodayWidgetWidth, string> = {
  small: "Compacte",
  medium: "Moyenne",
  large: "Large",
  full: "Ligne entière",
};

const localIsoDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const createCollection = (index: number): TrashCollection => ({
  id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `collection-${Date.now()}`,
  name: `Collecte ${index + 1}`,
  color: "#5B7CFA",
  alternateColor: null,
  frequencyWeeks: 1,
  weekday: 1,
  startDate: localIsoDate(),
  switchHour: 16,
});

function Toggle({ checked, label, hint, onChange }: { checked: boolean; label: string; hint?: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="widget-settings-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><strong>{label}</strong>{hint ? <small>{hint}</small> : null}</span>
    </label>
  );
}

export default function TodayWidgetsSettings({ currentUser }: { currentUser?: AppUser | null }) {
  const [saved, setSaved] = useState(() => readTodayWidgetPreferences(currentUser?.id));
  const [draft, setDraft] = useState(saved);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const preferences = readTodayWidgetPreferences(currentUser?.id);
    setSaved(preferences);
    setDraft(preferences);
    setNotice("");
  }, [currentUser?.id]);

  const changed = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const installedOrder = draft.order.filter((id) => draft.widgets[id].enabled);

  const update = (transform: (current: TodayWidgetPreferences) => TodayWidgetPreferences) => {
    setDraft((current) => transform(current));
    setNotice("");
  };

  const updateWidget = (id: TodayWidgetId, values: Partial<TodayWidgetPreferences["widgets"][TodayWidgetId]>) =>
    update((current) => ({ ...current, widgets: { ...current.widgets, [id]: { ...current.widgets[id], ...values } } }));

  const updateCollection = (id: string, values: Partial<TrashCollection>) =>
    update((current) => ({
      ...current,
      options: {
        ...current.options,
        trash: {
          ...current.options.trash,
          collections: current.options.trash.collections.map((collection) => collection.id === id ? { ...collection, ...values } : collection),
        },
      },
    }));

  const save = () => {
    const normalized = normalizeTodayWidgetPreferences(draft);
    const persisted = writeTodayWidgetPreferences(currentUser?.id, normalized);
    setSaved(normalized);
    setDraft(normalized);
    setNotice(persisted ? "Configuration des widgets enregistrée." : "Configuration appliquée pour cette session, mais le navigateur ne permet pas de l’enregistrer.");
  };

  const toggleRevenueMetric = (id: TodayRevenueMetricId, checked: boolean) => {
    update((current) => {
      const metrics = checked
        ? [...new Set([...current.options.revenue.visibleMetrics, id])]
        : current.options.revenue.visibleMetrics.filter((metricId) => metricId !== id);
      if (metrics.length === 0) return current;
      return { ...current, options: { ...current.options, revenue: { ...current.options.revenue, visibleMetrics: metrics } } };
    });
  };

  return (
    <section className="settings-cluster widget-settings" aria-labelledby="widget-settings-title">
      <div className="settings-cluster__header">
        <div>
          <div className="settings-cluster__eyebrow">Tableau de bord personnel</div>
          <h2 id="widget-settings-title" className="settings-cluster__title">Widgets de la page Aujourd’hui</h2>
        </div>
        <p className="settings-cluster__text">Installez les widgets utiles, choisissez leur ordre et configurez précisément les informations qu’ils affichent.</p>
      </div>

      <div className="widget-settings__section">
        <div className="widget-settings__section-heading">
          <div><span>01</span><h3>Installation et disposition</h3></div>
          <p>{installedOrder.length} widget{installedOrder.length > 1 ? "s" : ""} installé{installedOrder.length > 1 ? "s" : ""}</p>
        </div>
        <div className="widget-settings__catalog">
          {TODAY_WIDGET_CATALOG.map((item) => {
            const widget = draft.widgets[item.id];
            const index = installedOrder.indexOf(item.id);
            return (
              <article key={item.id} className={`widget-settings__catalog-card${widget.enabled ? " is-enabled" : ""}`}>
                <div className="widget-settings__catalog-top">
                  <span className="widget-settings__catalog-icon" aria-hidden="true">{item.label.slice(0, 1)}</span>
                  <div><strong>{item.label}</strong><p>{item.description}</p></div>
                  <button type="button" className={widget.enabled ? "secondary" : ""} onClick={() => updateWidget(item.id, { enabled: !widget.enabled })}>{widget.enabled ? "Installé" : "Installer"}</button>
                </div>
                {widget.enabled ? (
                  <div className="widget-settings__catalog-controls">
                    <label><span>Largeur</span><select value={widget.width} onChange={(event) => updateWidget(item.id, { width: event.target.value as TodayWidgetWidth })}>{Object.entries(WIDTH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <div><span>Position</span><div className="widget-settings__move"><button type="button" disabled={index <= 0} onClick={() => update((current) => moveTodayWidget(current, item.id, -1))} aria-label={`Déplacer ${item.label} vers le haut`}>↑</button><button type="button" disabled={index < 0 || index >= installedOrder.length - 1} onClick={() => update((current) => moveTodayWidget(current, item.id, 1))} aria-label={`Déplacer ${item.label} vers le bas`}>↓</button></div></div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>

      <div className="widget-settings__section">
        <div className="widget-settings__section-heading"><div><span>02</span><h3>Options de chaque widget</h3></div><p>Les changements sont prévisualisés dans les réglages ci-dessous.</p></div>
        <div className="widget-settings__details">
          <article className="widget-settings-card widget-settings-card--full">
            <header><div><span className="widget-settings-card__number">Widget 01</span><h3>Poubelles et collectes</h3><p>Ajoutez jusqu’à 12 tournées, avec leurs noms, couleurs et calendriers.</p></div><Toggle checked={draft.options.trash.showNextPickup} label="Afficher la prochaine collecte" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, trash: { ...current.options.trash, showNextPickup: checked } } }))} /></header>
            <div className="trash-collection-settings">
              {draft.options.trash.collections.map((collection, index) => (
                <article className="trash-collection-setting" key={collection.id}>
                  <div className="trash-collection-setting__head"><span className="trash-collection-setting__swatch" style={{ background: collection.color }} /><strong>Collecte {index + 1}</strong><button type="button" className="table-action danger" onClick={() => update((current) => ({ ...current, options: { ...current.options, trash: { ...current.options.trash, collections: current.options.trash.collections.filter((item) => item.id !== collection.id) } } }))}>Supprimer</button></div>
                  <div className="trash-collection-setting__grid">
                    <label className="field"><span>Nom affiché</span><input value={collection.name} maxLength={80} onChange={(event) => updateCollection(collection.id, { name: event.target.value })} placeholder="Ex. Bac jaune" /></label>
                    <label className="field widget-color-field"><span>Couleur principale</span><div><input type="color" value={collection.color} onChange={(event) => updateCollection(collection.id, { color: event.target.value })} /><input value={collection.color} onChange={(event) => updateCollection(collection.id, { color: event.target.value })} aria-label={`Code couleur principal de ${collection.name}`} /></div></label>
                    <label className="field"><span>Périodicité</span><select value={collection.frequencyWeeks} onChange={(event) => updateCollection(collection.id, { frequencyWeeks: Number(event.target.value) })}>{[1, 2, 3, 4].map((weeks) => <option key={weeks} value={weeks}>Toutes les {weeks === 1 ? "semaines" : `${weeks} semaines`}</option>)}</select></label>
                    <label className="field"><span>Jour de passage</span><select value={collection.weekday} onChange={(event) => updateCollection(collection.id, { weekday: Number(event.target.value) })}>{WEEKDAY_OPTIONS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
                    <label className="field"><span>Début de la période</span><input type="date" value={collection.startDate} onChange={(event) => updateCollection(collection.id, { startDate: event.target.value })} /></label>
                    <label className="field"><span>Heure de bascule</span><select value={collection.switchHour} onChange={(event) => updateCollection(collection.id, { switchHour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label>
                    <label className="field widget-color-field"><span>Couleur alternée</span><div><input type="color" value={collection.alternateColor ?? collection.color} disabled={!collection.alternateColor} onChange={(event) => updateCollection(collection.id, { alternateColor: event.target.value })} /><input value={collection.alternateColor ?? ""} disabled={!collection.alternateColor} onChange={(event) => updateCollection(collection.id, { alternateColor: event.target.value || null })} placeholder="Aucune" aria-label={`Code couleur alterné de ${collection.name}`} /></div></label>
                    <Toggle checked={Boolean(collection.alternateColor)} label="Alterner la couleur à chaque passage" hint="Utile pour distinguer deux types de bacs sur une même tournée." onChange={(checked) => updateCollection(collection.id, { alternateColor: checked ? "#FFCB05" : null })} />
                  </div>
                </article>
              ))}
              {draft.options.trash.collections.length === 0 ? <div className="widget-settings__empty">Aucune collecte configurée. Le widget affichera un état vide.</div> : null}
              <button type="button" className="secondary widget-settings__add" disabled={draft.options.trash.collections.length >= 12} onClick={() => update((current) => ({ ...current, options: { ...current.options, trash: { ...current.options.trash, collections: [...current.options.trash.collections, createCollection(current.options.trash.collections.length)] } } }))}>＋ Ajouter une collecte</button>
            </div>
          </article>

          <article className="widget-settings-card widget-settings-card--full widget-settings-card--revenue">
            <header><div><span className="widget-settings-card__number">Widget 05</span><h3>Revenus nets moyens</h3><p>Choisissez les périodes présentées et le détail financier disponible dans chaque fiche.</p></div></header>
            <div className="revenue-widget-settings">
              <fieldset><legend>Périodes affichées</legend><div className="revenue-widget-settings__periods">{TODAY_REVENUE_METRICS.map((metric) => <Toggle key={metric.id} checked={draft.options.revenue.visibleMetrics.includes(metric.id)} label={metric.label} hint={metric.description} onChange={(checked) => toggleRevenueMetric(metric.id, checked)} />)}</div><small>Au moins une période doit rester sélectionnée.</small></fieldset>
              <fieldset><legend>Présentation des montants</legend><div className="widget-settings__toggle-grid">
                <Toggle checked={draft.options.revenue.showTrends} label="Afficher les tendances" hint="Écart par rapport à la période comparable." onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, revenue: { ...current.options.revenue, showTrends: checked } } }))} />
                <Toggle checked={draft.options.revenue.highlightCurrentMonth} label="Mettre en avant le mois courant" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, revenue: { ...current.options.revenue, highlightCurrentMonth: checked } } }))} />
                <Toggle checked={draft.options.revenue.roundAmounts} label="Arrondir à l’euro" hint="Masque les centimes dans le widget et son détail." onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, revenue: { ...current.options.revenue, roundAmounts: checked } } }))} />
              </div></fieldset>
              <fieldset><legend>Détail au clic</legend><div className="widget-settings__toggle-grid">
                <Toggle checked={draft.options.revenue.showGrossRevenue} label="Revenus bruts" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, revenue: { ...current.options.revenue, showGrossRevenue: checked } } }))} />
                <Toggle checked={draft.options.revenue.showExpenses} label="Dépenses totales" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, revenue: { ...current.options.revenue, showExpenses: checked } } }))} />
                <Toggle checked={draft.options.revenue.showExpenseBreakdown} label="Répartition des dépenses" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, revenue: { ...current.options.revenue, showExpenseBreakdown: checked } } }))} />
                <Toggle checked={draft.options.revenue.showOccasionalExpenses} label="Frais personnels ponctuels" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, revenue: { ...current.options.revenue, showOccasionalExpenses: checked } } }))} />
              </div></fieldset>
            </div>
          </article>

          <article className="widget-settings-card"><header><div><span className="widget-settings-card__number">Widget 02</span><h3>Remplissage</h3><p>Adaptez la densité de l’indicateur d’occupation.</p></div></header><div className="widget-settings__toggle-grid">
            <Toggle checked={draft.options.occupancy.showGauge} label="Afficher la jauge" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, occupancy: { ...current.options.occupancy, showGauge: checked } } }))} />
            <Toggle checked={draft.options.occupancy.showPercentage} label="Afficher le pourcentage" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, occupancy: { ...current.options.occupancy, showPercentage: checked } } }))} />
            <Toggle checked={draft.options.occupancy.showCount} label="Afficher le nombre de gîtes" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, occupancy: { ...current.options.occupancy, showCount: checked } } }))} />
          </div></article>

          <article className="widget-settings-card"><header><div><span className="widget-settings-card__number">Widget 03</span><h3>Heures</h3><p>Réglez les informations et raccourcis de saisie.</p></div></header><div className="widget-settings__toggle-grid">
            <Toggle checked={draft.options.hours.showDatePicker} label="Afficher le choix de date" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, hours: { ...current.options.hours, showDatePicker: checked } } }))} />
            <Toggle checked={draft.options.hours.showTotals} label="Afficher les compteurs à payer" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, hours: { ...current.options.hours, showTotals: checked } } }))} />
          </div><fieldset className="widget-settings__quick-times"><legend>Raccourcis en minutes</legend><div>{draft.options.hours.quickMinutes.map((minutes, index) => <label key={index}><span>Raccourci {index + 1}</span><input type="number" min={5} max={720} step={5} value={minutes} onChange={(event) => update((current) => ({ ...current, options: { ...current.options, hours: { ...current.options.hours, quickMinutes: current.options.hours.quickMinutes.map((value, itemIndex) => itemIndex === index ? Number(event.target.value) : value) } } }))} /></label>)}</div></fieldset></article>

          <article className="widget-settings-card"><header><div><span className="widget-settings-card__number">Widget 04</span><h3>Archives notifications</h3><p>Définissez la période et les événements du centre de notifications.</p></div></header><label className="widget-settings__days"><span>Période : <strong>{draft.options.notificationArchive.dayCount} jour{draft.options.notificationArchive.dayCount > 1 ? "s" : ""}</strong></span><input type="range" min={1} max={5} step={1} value={draft.options.notificationArchive.dayCount} onChange={(event) => update((current) => ({ ...current, options: { ...current.options, notificationArchive: { ...current.options.notificationArchive, dayCount: Number(event.target.value) } } }))} /><small><span>1 jour</span><span>5 jours</span></small></label><div className="widget-settings__toggle-grid">
            <Toggle checked={draft.options.notificationArchive.showReservations} label="Nouvelles réservations" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, notificationArchive: { ...current.options.notificationArchive, showReservations: checked } } }))} />
            <Toggle checked={draft.options.notificationArchive.showConflicts} label="Conflits iCal" onChange={(checked) => update((current) => ({ ...current, options: { ...current.options, notificationArchive: { ...current.options.notificationArchive, showConflicts: checked } } }))} />
          </div></article>
        </div>
      </div>

      <div className="widget-settings__actions">
        <div><button type="button" onClick={save} disabled={!changed}>Enregistrer les widgets</button><button type="button" className="secondary" disabled={!changed} onClick={() => { setDraft(saved); setNotice(""); }}>Annuler</button><button type="button" className="secondary" onClick={() => { setDraft(normalizeTodayWidgetPreferences(DEFAULT_TODAY_WIDGET_PREFERENCES)); setNotice("Réglages par défaut prêts à être enregistrés."); }}>Réinitialiser</button></div>
        <p role="status">{notice || (changed ? "Modifications en attente d’enregistrement." : "Les widgets de la page Aujourd’hui utilisent cette configuration.")}</p>
      </div>
    </section>
  );
}
