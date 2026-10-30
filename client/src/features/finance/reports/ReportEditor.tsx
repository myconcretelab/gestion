import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ReportWorkspace } from "./ReportsPage";
import AccommodationBreakdown from "./AccommodationBreakdown";
import ReportPageHeader from "./ReportPageHeader";
import {
  categoryLabel,
  cadenceLabel,
  createReport,
  evaluateWorkspaceReport,
  formatReportValue,
  getReportPeriod,
  REPORT_CATEGORIES,
  REPORT_TEMPLATES,
  type ReportCadence,
  type ReportDefinition,
  type ReportKind,
} from "./reportModel";
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
  const {
    state,
    setDraft,
    mutate,
    saving,
    propertyName,
    month,
    href,
    canEdit,
    notify,
    storageError,
  } = workspace;
  const navigate = useNavigate();
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [mobilePane, setMobilePane] = useState("settings");
  const base = state.reports.find((report) => report.id === reportId);
  const draftKey = reportId ?? "new";
  const draft = state.drafts[draftKey] ?? base;
  const [error, setError] = useState("");
  const choose = (kind: ReportKind) => {
    const next = {
      ...createReport(kind, crypto.randomUUID()),
      propertyIds: state.properties.map((property) => property.id),
    };
    if (kind === "social") {
      next.operatorId =
        state.operators.find((operator) => !operator.legacy)?.id ?? null;
      next.propertyIds = state.properties
        .filter(
          (property) =>
            !next.operatorId || property.operatorId === next.operatorId,
        )
        .map((property) => property.id);
      next.recipient =
        state.operators.find((operator) => operator.id === next.operatorId)
          ?.name ?? "À renseigner";
    }
    setDraft(draftKey, next);
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
        <ReportPageHeader
          title="Nouveau rapport"
          back={{ to: href(), label: "Tous les rapports" }}
        />
        {templates}
        <p className="rp-template-note">
          <ReportIcon name="info" />
          Sélectionnez les logements, les catégories et la période à utiliser.
        </p>
      </>
    );

  const update = (patch: Partial<ReportDefinition>) => {
    setError("");
    setDraft(draftKey, { ...draft, ...patch });
  };
  const result = evaluateWorkspaceReport(state, draft, month);
  const baseline = base ? evaluateWorkspaceReport(state, base, month) : null;
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
  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !draft.name.trim() ||
      !draft.recipient.trim() ||
      !draft.propertyIds.length ||
      !draft.categories.length ||
      (draft.kind === "social" && !draft.operatorId)
    ) {
      setError(
        "Renseignez un nom, un destinataire, au moins un logement, une catégorie et l’exploitant pour un rapport social.",
      );
      setMobilePane("settings");
      const fieldId =
        draft.kind === "social" && !draft.operatorId
          ? "rp-report-operator"
          : !draft.name.trim()
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
    if (
      !(await mutate({
        type: "save",
        definition: {
          ...draft,
          name: draft.name.trim(),
          recipient: draft.recipient.trim(),
        },
      }))
    )
      return;
    setDraft(draftKey, null);
    notify(
      base
        ? "Les nouvelles règles sont appliquées. Les copies confirmées sont conservées."
        : "Rapport créé.",
    );
    navigate(href(`/${draft.id}`));
  };
  return (
    <>
      <ReportPageHeader
        title={base ? "Réglages" : "Nouveau rapport"}
        back={{
          to: href(base ? `/${base.id}` : ""),
          label: base ? "Revenir au rapport" : "Tous les rapports",
        }}
        status={
          state.drafts[draftKey] && changed ? (
            <ReportBadge tone="attention">Brouillon non appliqué</ReportBadge>
          ) : undefined
        }
        meta={
          <>
            <span>{base?.name ?? draft.name}</span>
            {state.drafts[draftKey] && (
              <span className="rp-save-indicator">
                <ReportIcon name={storageError ? "info" : "check"} />
                {storageError
                  ? "En mémoire uniquement"
                  : "Enregistré dans cet onglet"}
              </span>
            )}
          </>
        }
      />
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
        onSubmit={(event) => void publish(event)}
        noValidate
      >
        <div className="rp-editor-settings">
          <section className="rp-panel rp-editor-section">
            <div className="rp-section-title">
              <span>01</span>
              <div>
                <h2>Identification</h2>
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
                <h2>Périmètre</h2>
              </div>
            </div>
            {draft.kind === "social" && (
              <label className="rp-field">
                Exploitant
                <select
                  id="rp-report-operator"
                  value={draft.operatorId ?? ""}
                  onChange={(event) => {
                    const operatorId = event.target.value || null;
                    const operator = state.operators.find(
                      (row) => row.id === operatorId,
                    );
                    update({
                      operatorId,
                      recipient: operator?.name ?? draft.recipient,
                      propertyIds: state.properties
                        .filter(
                          (property) =>
                            !operatorId ||
                            !property.operatorId ||
                            property.operatorId === operatorId,
                        )
                        .map((property) => property.id),
                    });
                  }}
                >
                  <option value="">Rattachement à vérifier</option>
                  {state.operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.name}
                      {operator.legacy ? " · propriétaire historique" : ""}
                    </option>
                  ))}
                </select>
                <small>
                  Le rattachement à l’établissement facturant est utilisé. Un
                  propriétaire historique reste à confirmer.
                </small>
              </label>
            )}
            <fieldset
              className="rp-choice-fieldset"
              id="rp-report-properties"
              tabIndex={-1}
            >
              <legend>Logements concernés</legend>
              <div className="rp-property-choices">
                {state.properties.map((property) => (
                  <label
                    key={property.id}
                    className={`rp-property-choice${draft.propertyIds.includes(property.id) ? " is-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={draft.propertyIds.includes(property.id)}
                      disabled={
                        draft.kind === "social" &&
                        Boolean(draft.operatorId) &&
                        Boolean(property.operatorId) &&
                        draft.operatorId !== property.operatorId
                      }
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
                    (draft.kind !== "tourist" ||
                      category.id === "accommodation") &&
                    (draft.kind !== "social" || category.id !== "tourist_tax"),
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
                  ? "Le rapport compte les personnes hébergées par nuit, y compris les enfants. Il ne calcule pas un montant de taxe."
                  : "Une même recette peut alimenter plusieurs rapports."}
              </p>
            </fieldset>
          </section>
          <section className="rp-panel rp-editor-section">
            <div className="rp-section-title">
              <span>03</span>
              <div>
                <h2>Période et date de référence</h2>
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
            {draft.kind !== "tourist" && draft.dateBasis === "payment" && <label className="rp-field">
              Base des recettes de plateformes
              <select aria-label="Base OTA" value={draft.otaAmountBasis ?? "gross"} onChange={event => update({ otaAmountBasis: event.target.value as "gross" | "net" })}>
                <option value="gross">Brut, avant commissions</option>
                <option value="net">Net plateforme, après commissions</option>
              </select>
              <span className="rp-field-help">Le choix concerne ce rapport. Le net plateforme n’est pas un bénéfice fiscal. Vérifiez la base applicable à votre démarche et à votre régime ; les deux montants restent conservés.</span>
            </label>}
            <fieldset className="rp-choice-fieldset">
              <legend>Quelle date détermine la période ?</legend>
              <div className="rp-radio-choices">
                {[
                  {
                    id: "payment" as const,
                    label: "Date du paiement reçu",
                    text: "L’opération apparaît dans le mois du paiement.",
                  },
                  {
                    id: "stay" as const,
                    label:
                      draft.kind === "tourist"
                        ? "Date des nuitées"
                        : "Date d’arrivée",
                    text:
                      draft.kind === "tourist"
                        ? "Les nuitées sont réparties dans chaque mois du séjour."
                        : "Le montant du séjour apparaît dans le mois de l’arrivée.",
                  },
                ]
                  .filter(
                    (choice) =>
                      (draft.kind !== "tourist" || choice.id === "stay") &&
                      (draft.kind !== "social" || choice.id === "payment"),
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
              {draft.kind !== "social" && draft.kind !== "tourist" ? (
                <div className="rp-date-example">
                  <strong>
                    Exemple : paiement le 25 octobre, arrivée le 2 novembre
                  </strong>
                  <dl>
                    <div
                      className={
                        draft.dateBasis === "payment" ? "is-selected" : ""
                      }
                    >
                      <dt>Date du paiement reçu</dt>
                      <dd>Rapport d’octobre</dd>
                    </div>
                    <div
                      className={
                        draft.dateBasis === "stay" ? "is-selected" : ""
                      }
                    >
                      <dt>Date d’arrivée</dt>
                      <dd>Rapport de novembre</dd>
                    </div>
                  </dl>
                  <p>
                    Le choix « Date d’arrivée » rattache le montant prévu du
                    séjour au mois de l’arrivée. Le choix « Date du paiement
                    reçu » utilise uniquement les règlements enregistrés.
                  </p>
                </div>
              ) : (
                <p className="rp-muted">
                  {draft.kind === "tourist"
                    ? "Une nuitée correspond à une personne hébergée pendant une nuit. Les séjours à cheval sur deux mois sont répartis entre ces mois."
                    : "Chaque règlement est retenu dans la période de son encaissement, indépendamment des dates du séjour."}
                </p>
              )}
            </fieldset>
          </section>
        </div>
        <aside className="rp-editor-preview" aria-label="Aperçu du rapport">
          <div className="rp-preview-card">
            <div className="rp-preview-card__top">
              <h2>{draft.name || "Rapport"}</h2>
              <ReportBadge tone="primary">En direct</ReportBadge>
            </div>
            <p className="rp-muted">
              {getReportPeriod(month, draft.cadence).label} ·{" "}
              {draft.recipient || "Destinataire"}
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
            <AccommodationBreakdown report={draft} result={result} />
            {changed && (
              <div className="rp-impact" aria-live="polite">
                <strong>{base ? "Effet du brouillon" : "Sélection"}</strong>
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
            {base ? "Brouillon non appliqué." : "Brouillon de création."}
          </span>
          <Link
            className="rp-button rp-button--secondary"
            to={href(base ? `/${base.id}` : "")}
          >
            Fermer le brouillon
          </Link>
          <button type="submit" className="rp-button" disabled={saving}>
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
