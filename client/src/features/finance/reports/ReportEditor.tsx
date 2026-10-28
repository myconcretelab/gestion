import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ReportWorkspace } from "./ReportsPrototypePage";
import {
  categoryLabel,
  cadenceLabel,
  createReport,
  evaluateReport,
  formatReportValue,
  getReportPeriod,
  propertyName,
  REPORT_CATEGORIES,
  REPORT_PROPERTIES,
  REPORT_TEMPLATES,
  reportPeriodKey,
  type ReportCadence,
  type ReportDefinition,
  type ReportKind,
} from "./reportPrototype";
import {
  ReportBadge,
  ReportDialog,
  ReportIcon,
  ReportKindIcon,
} from "./ReportUi";

export default function ReportEditor({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const { reportId } = useParams();
  const { state, setState, month, href, canEdit, notify, storageError } =
    workspace;
  const navigate = useNavigate();
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [mobilePane, setMobilePane] = useState("settings");
  const base = state.reports.find((report) => report.id === reportId);
  const draftKey = reportId ?? "new";
  const draft = state.drafts[draftKey] ?? base;
  const [error, setError] = useState("");
  const choose = (kind: ReportKind) => {
    const next = createReport(kind, `demo-${crypto.randomUUID()}`);
    setState((previous) => ({
      ...previous,
      drafts: { ...previous.drafts, [draftKey]: next },
    }));
    setChoosingTemplate(false);
  };
  if (!canEdit)
    return (
      <div className="rp-empty">
        <h1>Consultation des rapports</h1>
        <p>
          Votre profil permet de consulter les rapports. La modification
          nécessite un droit d’écriture.
        </p>
        <Link to={href()}>Revenir aux rapports</Link>
      </div>
    );
  if (reportId && !base)
    return (
      <div className="rp-empty">
        <h1>Rapport introuvable</h1>
        <Link to={href()}>Revenir aux rapports</Link>
      </div>
    );
  const templates = (
    <div className="rp-template-grid">
      {REPORT_TEMPLATES.map((template) => (
        <button
          type="button"
          key={template.kind}
          className="rp-template-card"
          onClick={() => choose(template.kind)}
        >
          <ReportKindIcon kind={template.kind} />
          <strong>{template.name}</strong>
          <span>{template.description}</span>
          <span className="rp-template-card__action">
            Utiliser ce modèle <ReportIcon name="arrow" />
          </span>
        </button>
      ))}
    </div>
  );
  if (!draft)
    return (
      <>
        <Link className="rp-back-link" to={href()}>
          <ReportIcon name="back" />
          Tous les rapports
        </Link>
        <header className="rp-page-header">
          <div>
            <p className="rp-eyebrow">Un rapport à votre image</p>
            <h1>
              Partez du bon modèle<span className="rp-title-dot">.</span>
            </h1>
            <p className="rp-page-description">
              Choisissez un point de départ. Vous ajusterez ensuite le périmètre
              et les règles.
            </p>
          </div>
        </header>
        {templates}
        <p className="rp-template-note">
          <ReportIcon name="info" />
          Ces modèles illustrent le parcours. Leurs règles devront être validées
          avant un usage réel.
        </p>
      </>
    );

  const update = (patch: Partial<ReportDefinition>) => {
    setError("");
    setState((previous) => ({
      ...previous,
      drafts: {
        ...previous.drafts,
        [draftKey]: { ...(previous.drafts[draftKey] ?? draft), ...patch },
      },
    }));
  };
  const result = evaluateReport(
    draft,
    month,
    state.overrides[reportPeriodKey(draft, month)],
  );
  const baseline = base
    ? evaluateReport(base, month, state.overrides[reportPeriodKey(base, month)])
    : null;
  const previousIds = new Set(
    baseline?.rows
      .filter((row) => row.status === "included")
      .map((row) => row.id),
  );
  const nextIds = new Set(
    result.rows.filter((row) => row.status === "included").map((row) => row.id),
  );
  const additions = [...nextIds].filter((id) => !previousIds.has(id)).length;
  const removals = [...previousIds].filter((id) => !nextIds.has(id)).length;
  const difference = result.total - (baseline?.total ?? 0);
  const changed =
    !base ||
    JSON.stringify({ ...draft, favorite: base.favorite }) !==
      JSON.stringify(base);
  const publish = (event: FormEvent) => {
    event.preventDefault();
    if (
      !draft.name.trim() ||
      !draft.recipient.trim() ||
      !draft.propertyIds.length ||
      !draft.categories.length
    ) {
      setError(
        "Renseignez un nom, un destinataire, au moins un logement et une catégorie.",
      );
      setMobilePane("settings");
      const fieldId = !draft.name.trim()
        ? "rp-report-name"
        : !draft.recipient.trim()
          ? "rp-report-recipient"
          : !draft.propertyIds.length
            ? "rp-report-properties"
            : "rp-report-categories";
      window.requestAnimationFrame(() =>
        document.getElementById(fieldId)?.focus(),
      );
      return;
    }
    setState((previous) => {
      const current = previous.reports.find((report) => report.id === draft.id);
      const published = {
        ...draft,
        name: draft.name.trim(),
        recipient: draft.recipient.trim(),
        favorite: current?.favorite ?? draft.favorite,
      };
      const drafts = { ...previous.drafts };
      delete drafts[draftKey];
      // A new definition invalidates readiness; confirmed snapshots remain immutable.
      const progress = Object.fromEntries(
        Object.entries(previous.progress).map(([key, value]) => [
          key,
          key.startsWith(`${draft.id}:`) ? { ...value, ready: false } : value,
        ]),
      );
      return {
        ...previous,
        drafts,
        progress,
        reports: current
          ? previous.reports.map((report) =>
              report.id === draft.id ? published : report,
            )
          : [...previous.reports, published],
      };
    });
    notify(
      base
        ? "Les nouvelles règles sont appliquées. Les copies confirmées sont conservées."
        : "Votre rapport de démonstration est créé.",
    );
    navigate(href(`/${draft.id}`));
  };
  return (
    <>
      <Link className="rp-back-link" to={href(base ? `/${base.id}` : "")}>
        <ReportIcon name="back" />
        {base ? "Revenir au rapport" : "Tous les rapports"}
      </Link>
      <header className="rp-page-header rp-page-header--editor">
        <div>
          <p className="rp-eyebrow">Votre rapport, vos repères</p>
          <h1>
            {base ? "Ajuster les règles" : "Composer votre rapport"}
            <span className="rp-title-dot">.</span>
          </h1>
          <p className="rp-page-description">
            Voyez ce qui change avant d’appliquer vos choix.
          </p>
        </div>
        <span className="rp-save-indicator">
          <ReportIcon name={storageError ? "info" : "check"} />
          {storageError
            ? "Brouillon en mémoire uniquement"
            : "Brouillon conservé dans cet onglet"}
        </span>
      </header>
      <div className="rp-mobile-panes" aria-label="Vue de l’éditeur">
        <button
          type="button"
          aria-pressed={mobilePane === "settings"}
          onClick={() => setMobilePane("settings")}
        >
          <ReportIcon name="settings" />
          Réglages
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === "preview"}
          onClick={() => setMobilePane("preview")}
        >
          <ReportIcon name="document" />
          Aperçu · {formatReportValue(draft, result.total)}
        </button>
      </div>
      <form
        className={`rp-editor rp-editor--${mobilePane}`}
        onSubmit={publish}
        noValidate
      >
        <div className="rp-editor-settings">
          <section className="rp-panel rp-editor-section">
            <div className="rp-section-title">
              <span>01</span>
              <div>
                <h2>Les essentiels</h2>
                <p>Un nom et un destinataire faciles à retrouver.</p>
              </div>
            </div>
            <label className="rp-field">
              Nom du rapport
              <input
                id="rp-report-name"
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="Ex. Recettes du propriétaire"
              />
            </label>
            <label className="rp-field">
              Destinataire ou usage
              <input
                id="rp-report-recipient"
                required
                maxLength={120}
                value={draft.recipient}
                onChange={(event) => update({ recipient: event.target.value })}
                placeholder="Ex. Propriétaire · Maison du verger"
              />
            </label>
            <label className="rp-field">
              Description <span className="rp-optional">Facultatif</span>
              <textarea
                rows={2}
                maxLength={350}
                value={draft.description}
                onChange={(event) =>
                  update({ description: event.target.value })
                }
              />
            </label>
            {!base && (
              <button
                type="button"
                className="rp-text-button"
                onClick={() => setChoosingTemplate(true)}
              >
                Changer de modèle
              </button>
            )}
          </section>
          <section className="rp-panel rp-editor-section">
            <div className="rp-section-title">
              <span>02</span>
              <div>
                <h2>Le périmètre</h2>
                <p>Les opérations qui alimentent ce rapport.</p>
              </div>
            </div>
            <fieldset
              className="rp-choice-fieldset"
              id="rp-report-properties"
              tabIndex={-1}
            >
              <legend>Logements concernés</legend>
              <div className="rp-property-choices">
                {REPORT_PROPERTIES.map((property) => (
                  <label
                    key={property.id}
                    className={`rp-property-choice${draft.propertyIds.includes(property.id) ? " is-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={draft.propertyIds.includes(property.id)}
                      onChange={(event) =>
                        update({
                          propertyIds: event.target.checked
                            ? [...draft.propertyIds, property.id]
                            : draft.propertyIds.filter(
                                (id) => id !== property.id,
                              ),
                        })
                      }
                    />
                    <span className="rp-property-initials">
                      {property.initials}
                    </span>
                    <span>{property.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset
              className="rp-choice-fieldset"
              id="rp-report-categories"
              tabIndex={-1}
            >
              <legend>
                {draft.kind === "tourist"
                  ? "Données retenues"
                  : "Catégories de recettes"}
              </legend>
              <div className="rp-category-choices">
                {REPORT_CATEGORIES.filter(
                  (category) =>
                    draft.kind !== "tourist" || category.id === "accommodation",
                ).map((category) => (
                  <label
                    key={category.id}
                    className={
                      draft.categories.includes(category.id)
                        ? "is-selected"
                        : ""
                    }
                  >
                    <input
                      type="checkbox"
                      checked={draft.categories.includes(category.id)}
                      onChange={(event) =>
                        update({
                          categories: event.target.checked
                            ? [...draft.categories, category.id]
                            : draft.categories.filter(
                                (id) => id !== category.id,
                              ),
                        })
                      }
                    />
                    {category.label}
                  </label>
                ))}
              </div>
              <p className="rp-field-help">
                {draft.kind === "tourist"
                  ? "L’aperçu compte les nuitées des lignes d’hébergement. Il ne calcule pas un montant de taxe."
                  : "Une même recette peut alimenter plusieurs rapports."}
              </p>
            </fieldset>
          </section>
          <section className="rp-panel rp-editor-section">
            <div className="rp-section-title">
              <span>03</span>
              <div>
                <h2>Le rythme et les dates</h2>
                <p>La période et le point de départ du calcul.</p>
              </div>
            </div>
            <label className="rp-field">
              Périodicité
              <select
                value={draft.cadence}
                onChange={(event) =>
                  update({ cadence: event.target.value as ReportCadence })
                }
              >
                <option value="monthly">Chaque mois</option>
                <option value="quarterly">Chaque trimestre</option>
                <option value="yearly">Chaque année</option>
              </select>
            </label>
            <fieldset className="rp-choice-fieldset">
              <legend>Date de rattachement</legend>
              <div className="rp-radio-choices">
                {[
                  {
                    id: "payment" as const,
                    label: "Date d’encaissement",
                    text: "Le versement rejoint la période où il a été reçu.",
                  },
                  {
                    id: "stay" as const,
                    label: "Début du séjour",
                    text: "Dans cet aperçu, le séjour rejoint son mois d’arrivée.",
                  },
                ]
                  .filter(
                    (choice) =>
                      draft.kind !== "tourist" || choice.id === "stay",
                  )
                  .map((choice) => (
                    <label
                      key={choice.id}
                      className={
                        draft.dateBasis === choice.id ? "is-selected" : ""
                      }
                    >
                      <input
                        type="radio"
                        name="dateBasis"
                        checked={draft.dateBasis === choice.id}
                        onChange={() => update({ dateBasis: choice.id })}
                      />
                      <span>
                        <strong>{choice.label}</strong>
                        <small>{choice.text}</small>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          </section>
        </div>
        <aside className="rp-editor-preview" aria-label="Aperçu du rapport">
          <div className="rp-preview-card">
            <div className="rp-preview-card__top">
              <span className="rp-overline">Votre aperçu</span>
              <ReportBadge tone="primary">En direct</ReportBadge>
            </div>
            <ReportKindIcon kind={draft.kind} />
            <h2>{draft.name || "Votre rapport"}</h2>
            <p className="rp-muted">
              {getReportPeriod(month, draft.cadence).label} ·{" "}
              {draft.recipient || "Votre destinataire"}
            </p>
            <div
              className="rp-preview-value"
              aria-live="polite"
              aria-atomic="true"
            >
              {formatReportValue(draft, result.total)}
            </div>
            <p className="rp-muted">
              {result.includedCount} opération
              {result.includedCount > 1 ? "s" : ""} incluse
              {result.includedCount > 1 ? "s" : ""}
              {result.reviewCount ? ` · ${result.reviewCount} à vérifier` : ""}
            </p>
            <div className="rp-rule-summary">
              <ReportIcon name="filter" />
              <p>
                {draft.kind === "tourist" ? "Nuitées" : "Recettes"} de{" "}
                <strong>
                  {draft.propertyIds.length} logement
                  {draft.propertyIds.length > 1 ? "s" : ""}
                </strong>
                ,{" "}
                {draft.dateBasis === "payment"
                  ? "selon les encaissements"
                  : "selon le début des séjours"}
                , avec{" "}
                {draft.categories.length
                  ? draft.categories
                      .map(categoryLabel)
                      .join(", ")
                      .toLocaleLowerCase("fr")
                  : "aucune catégorie sélectionnée"}
                .
              </p>
            </div>
            <dl className="rp-preview-facts">
              <div>
                <dt>Périodicité</dt>
                <dd>{cadenceLabel(draft.cadence)}</dd>
              </div>
              <div>
                <dt>Hors périmètre</dt>
                <dd>
                  {result.excludedCount} opération
                  {result.excludedCount > 1 ? "s" : ""}
                </dd>
              </div>
              <div>
                <dt>À vérifier</dt>
                <dd>
                  {result.reviewCount} opération
                  {result.reviewCount > 1 ? "s" : ""}
                </dd>
              </div>
            </dl>
            {changed && (
              <div className="rp-impact" aria-live="polite">
                <strong>
                  {base ? "Effet de vos changements" : "Votre sélection"}
                </strong>
                <span>
                  {additions} opération{additions > 1 ? "s" : ""} ajoutée
                  {additions > 1 ? "s" : ""}
                  {removals
                    ? ` · ${removals} retirée${removals > 1 ? "s" : ""}`
                    : ""}
                </span>
                {base && (
                  <b>
                    {difference > 0 ? "+" : ""}
                    {formatReportValue(draft, difference)} sur cette période
                  </b>
                )}
              </div>
            )}
            <details className="rp-preview-lines">
              <summary>Voir les opérations incluses</summary>
              {result.rows
                .filter((row) => row.status === "included")
                .map((row) => (
                  <div key={row.id}>
                    <span>
                      {row.guest}
                      <small>
                        {propertyName(row.propertyId)} ·{" "}
                        {categoryLabel(row.category)}
                      </small>
                    </span>
                    <strong>{formatReportValue(draft, row.value)}</strong>
                  </div>
                ))}
              {!result.includedCount && (
                <p>Aucune opération incluse pour ces choix.</p>
              )}
            </details>
          </div>
          <div className="rp-preview-note">
            <ReportIcon name="info" />
            <p>
              Ces choix s’appliquent au calcul courant. Les copies dont la
              transmission a été confirmée sont conservées.
            </p>
          </div>
        </aside>
        <div className="rp-editor-actions">
          {error && (
            <p className="rp-form-error" role="alert">
              {error}
            </p>
          )}
          <span className="rp-muted">
            {base
              ? "Votre rapport reste inchangé tant que vous n’appliquez pas le brouillon."
              : "Vous pourrez ajuster ce rapport à tout moment."}
          </span>
          <Link
            className="rp-button rp-button--secondary"
            to={href(base ? `/${base.id}` : "")}
          >
            Revenir plus tard
          </Link>
          <button type="submit" className="rp-button">
            <ReportIcon name="check" />
            {base ? "Appliquer les règles" : "Créer ce rapport"}
          </button>
        </div>
      </form>
      {choosingTemplate && (
        <ReportDialog
          title="Choisir un autre modèle"
          onClose={() => setChoosingTemplate(false)}
          wide
        >
          <p>
            Le modèle choisi remplacera les réglages de ce nouveau brouillon.
          </p>
          {templates}
        </ReportDialog>
      )}
    </>
  );
}
