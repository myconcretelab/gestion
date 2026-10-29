import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReportWorkspace } from "./ReportsPrototypePage";
import AccommodationBreakdown from "./AccommodationBreakdown";
import ReportPageHeader from "./ReportPageHeader";
import { sourceCorrectionHref } from "./ReportSourceEditor";
import {
  categoryLabel,
  evaluatePrototypeReport,
  paymentMethodLabel,
  formatReportValue,
  getReportPeriod,
  propertyName,
  reportCsv,
  reportPeriodKey,
  reportStatus,
  snapshotDiffers,
  type EvaluatedOperation,
  type OperationOverride,
  type OperationStatus,
} from "./reportPrototype";
import {
  ReportBadge,
  ReportDialog,
  ReportEmpty,
  ReportIcon,
  ReportKindIcon,
} from "./ReportUi";

const statusLabels: Record<OperationStatus, string> = {
  included: "Inclus",
  review: "À vérifier",
  excluded: "Hors périmètre",
};
const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: value.includes("T") ? "Europe/Paris" : "UTC",
      }).format(new Date(value.includes("T") ? value : value + "T12:00:00Z"))
    : "Date à vérifier";

export default function ReportDetail({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const { reportId } = useParams();
  const { state, setState, month, href, canEdit, notify } = workspace;
  const [filter, setFilter] = useState<OperationStatus>("included");
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState<EvaluatedOperation | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshotKey, setSnapshotKey] = useState<string | null>(null);
  const [lastCorrection, setLastCorrection] = useState<{
    key: string;
    id: string;
    previous?: OperationOverride;
  } | null>(null);
  const report = state.reports.find((item) => item.id === reportId);
  if (!report)
    return (
      <div className="rp-empty">
        <h1>Rapport introuvable</h1>
        <Link to={href()}>Revenir aux rapports</Link>
      </div>
    );
  const key = reportPeriodKey(report, month);
  const result = evaluatePrototypeReport(state, report, month);
  const progress = state.progress[key];
  const snapshots = Object.entries(state.progress)
    .filter(
      ([entryKey, value]) =>
        entryKey.startsWith(`${report.id}:`) && value.snapshot,
    )
    .sort((a, b) =>
      b[1].snapshot!.confirmedAt.localeCompare(a[1].snapshot!.confirmedAt),
    );
  const snapshot = snapshotKey
    ? state.progress[snapshotKey]?.snapshot
    : undefined;
  const displayedReport = snapshot?.definition ?? report;
  const displayedResult = snapshot?.result ?? result;
  const displayedMonth =
    snapshot && snapshotKey
      ? snapshotKey.slice(report.id.length + 1, report.id.length + 8)
      : month;
  const currentStatus = reportStatus(progress, result);
  const differs = Boolean(
    progress?.snapshot && snapshotDiffers(progress.snapshot, result),
  );
  const rows = displayedResult.rows.filter(
    (row) =>
      row.status === filter &&
      `${row.guest} ${row.reservation} ${propertyName(row.propertyId)} ${categoryLabel(row.category)}`
        .toLocaleLowerCase("fr")
        .includes(search.toLocaleLowerCase("fr")),
  );
  const issueLinks = result.rows
    .filter((row) => row.status === "review")
    .flatMap((row) =>
      row.issues.map((issue) => ({
        row,
        issue,
        id: `${issue.kind}:${issue.kind === "operator" ? row.propertyId : row.id}`,
      })),
    )
    .filter(
      (item, index, items) =>
        items.findIndex((other) => other.id === item.id) === index,
    );
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([reportCsv(displayedReport, displayedResult)], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `exemple-rapport-${report.kind}-${getReportPeriod(displayedMonth, displayedReport.cadence).start}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Export CSV généré.");
  };
  const correct = (row: EvaluatedOperation, override?: OperationOverride) => {
    if (!canEdit || snapshot) return;
    const previous = state.overrides[key]?.[row.id];
    setLastCorrection({ key, id: row.id, previous });
    setState((current) => {
      const overrides = { ...current.overrides[key] };
      if (override) overrides[row.id] = override;
      else delete overrides[row.id];
      return {
        ...current,
        overrides: { ...current.overrides, [key]: overrides },
        progress: {
          ...current.progress,
          [key]: { ...current.progress[key], ready: false },
        },
      };
    });
    setSelectedRow(null);
    notify(
      "La correction est appliquée à ce rapport et à cette période uniquement.",
    );
  };
  const undo = () => {
    if (!lastCorrection || !canEdit) return;
    const correction = lastCorrection;
    setState((current) => {
      const overrides = { ...current.overrides[correction.key] };
      if (correction.previous) overrides[correction.id] = correction.previous;
      else delete overrides[correction.id];
      return {
        ...current,
        overrides: { ...current.overrides, [correction.key]: overrides },
        progress: {
          ...current.progress,
          [correction.key]: {
            ...current.progress[correction.key],
            ready: false,
          },
        },
      };
    });
    setLastCorrection(null);
    notify("La dernière correction a été annulée.");
  };
  return (
    <>
      <ReportPageHeader
        title={displayedReport.name}
        back={{ to: href(), label: "Tous les rapports" }}
        status={
          <ReportBadge
            tone={
              snapshot
                ? "complete"
                : differs || result.reviewCount
                  ? "attention"
                  : progress?.ready
                    ? "primary"
                    : progress?.snapshot
                      ? "complete"
                      : "neutral"
            }
          >
            {snapshot ? "Copie confirmée" : currentStatus}
          </ReportBadge>
        }
        meta={
          <>
            <span>
              {getReportPeriod(displayedMonth, displayedReport.cadence).label}
            </span>
            <span aria-hidden="true">·</span>
            <span>{displayedReport.recipient}</span>
            {snapshot ? (
              <button
                className="rp-text-button"
                type="button"
                onClick={() => {
                  setSnapshotKey(null);
                  setFilter("included");
                }}
              >
                Revenir au calcul courant
              </button>
            ) : (
              progress?.snapshot && (
                <button
                  className="rp-text-button"
                  type="button"
                  onClick={() => {
                    setSnapshotKey(key);
                    setFilter("included");
                  }}
                >
                  Voir la copie confirmée
                </button>
              )
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="rp-button rp-button--secondary"
              onClick={() => setHistoryOpen(true)}
            >
              <ReportIcon name="clock" />
              Historique{snapshots.length ? ` (${snapshots.length})` : ""}
            </button>
            <button
              type="button"
              className="rp-button rp-button--secondary"
              onClick={exportCsv}
            >
              <ReportIcon name="download" />
              Exporter
            </button>
            {canEdit && (
              <Link
                className="rp-button rp-button--secondary"
                to={href(`/${report.id}/modifier`)}
              >
                <ReportIcon name="settings" />
                Réglages
              </Link>
            )}
          </>
        }
      />
      {snapshot && (
        <div className="rp-notice rp-notice--primary">
          <ReportIcon name="check" />
          <p>
            Copie figée le {dateLabel(snapshot.confirmedAt)}. Les corrections
            ultérieures ne modifient pas ce contenu.
          </p>
        </div>
      )}
      {!snapshot && differs && (
        <div className="rp-notice">
          <ReportIcon name="info" />
          <div>
            <strong>Les données ont évolué depuis votre confirmation.</strong>
            <p>
              Écart du calcul courant :{" "}
              {result.total - progress!.snapshot!.result.total > 0 ? "+" : ""}
              {formatReportValue(
                report,
                result.total - progress!.snapshot!.result.total,
              )}
              .{" "}
              <button
                type="button"
                className="rp-text-button"
                onClick={() => {
                  setSnapshotKey(key);
                  setFilter("included");
                }}
              >
                Consulter la copie confirmée
              </button>
            </p>
          </div>
        </div>
      )}
      {!snapshot && issueLinks.length > 0 && (
        <section className="rp-problems" aria-label="Problèmes à corriger">
          <h2>Problèmes à corriger</h2>
          {issueLinks.map(({ row, issue, id }) => (
            <div className="rp-notice" key={id}>
              <ReportIcon name="info" />
              <div>
                <strong>{issue.message}</strong>
                {issue.kind === "payment" && (
                  <p>
                    {row.guest} · {row.reservation} ·{" "}
                    {categoryLabel(row.category)}
                  </p>
                )}
              </div>
              <Link
                className="rp-text-button"
                to={sourceCorrectionHref(workspace, report.id, row, issue)}
              >
                {canEdit ? issue.actionLabel : "Consulter"}
                <ReportIcon name="arrow" />
              </Link>
            </div>
          ))}
        </section>
      )}
      <section className="rp-report-summary" aria-label="Synthèse du rapport">
        <div className="rp-total-card">
          <span className="rp-overline">
            {snapshot
              ? "Résultat confirmé"
              : "Résultat des opérations incluses"}
          </span>
          <strong className="rp-total-value">
            {formatReportValue(displayedReport, displayedResult.total)}
          </strong>
          <span>
            {displayedReport.kind === "tourist"
              ? "Nuitées des hébergements retenus dans cet exemple."
              : "Les opérations à vérifier et hors périmètre sont présentées séparément."}
          </span>
          <div className="rp-total-rule">
            <ReportIcon name="filter" />
            {displayedReport.propertyIds.length} logement
            {displayedReport.propertyIds.length > 1 ? "s" : ""} ·{" "}
            {displayedReport.categories.length} catégorie
            {displayedReport.categories.length > 1 ? "s" : ""} ·{" "}
            {displayedReport.dateBasis === "payment"
              ? "Date d’encaissement"
              : "Début du séjour"}
          </div>
          <AccommodationBreakdown
            report={displayedReport}
            result={displayedResult}
          />
        </div>
        <div className="rp-next-step">
          <span className="rp-overline">État du rapport</span>
          <h2>
            {snapshot
              ? "Copie enregistrée"
              : differs
                ? "Écart depuis la confirmation"
                : result.reviewCount
                  ? "Opérations à corriger"
                  : progress?.snapshot
                    ? "Transmission confirmée"
                    : progress?.ready
                      ? "Rapport prêt"
                      : "Préparation du rapport"}
          </h2>
          <p>
            {snapshot
              ? "Cette copie et son export reprennent les opérations au moment de votre confirmation."
              : differs
                ? "Consultez les opérations actuelles et comparez-les à la copie confirmée."
                : result.reviewCount
                  ? `${result.reviewCount} opération${result.reviewCount > 1 ? "s demandent" : " demande"} une vérification avant de préparer votre copie.`
                  : progress?.snapshot
                    ? "Votre confirmation et les chiffres correspondants sont disponibles dans l’historique."
                    : progress?.ready
                      ? "Après votre démarche sur le service concerné, vous pourrez en confirmer la transmission ici."
                      : "Examinez les opérations incluses, puis marquez ce rapport comme prêt."}
          </p>
          {!snapshot && result.reviewCount > 0 && (
            <button
              type="button"
              className="rp-button"
              onClick={() => setFilter("review")}
            >
              {result.reviewCount === 1
                ? "Examiner l’opération"
                : `Examiner les ${result.reviewCount} opérations`}
              <ReportIcon name="arrow" />
            </button>
          )}
          {!snapshot &&
            canEdit &&
            !result.reviewCount &&
            !progress?.snapshot &&
            (progress?.ready ? (
              <button
                type="button"
                className="rp-button"
                onClick={() => setConfirming(true)}
              >
                <ReportIcon name="check" />
                Confirmer la transmission
              </button>
            ) : (
              <button
                type="button"
                className="rp-button"
                onClick={() => {
                  setState((previous) => ({
                    ...previous,
                    progress: {
                      ...previous.progress,
                      [key]: { ...previous.progress[key], ready: true },
                    },
                  }));
                  notify("Le rapport de démonstration est prêt.");
                }}
                disabled={!result.includedCount}
              >
                <ReportIcon name="check" />
                Marquer comme prêt
              </button>
            ))}
          {!snapshot && progress?.snapshot && (
            <button
              type="button"
              className="rp-button rp-button--secondary"
              onClick={() => {
                setSnapshotKey(key);
                setFilter("included");
              }}
            >
              Consulter la copie
              <ReportIcon name="arrow" />
            </button>
          )}
        </div>
      </section>
      <section className="rp-panel" aria-labelledby="rp-operations-heading">
        <div className="rp-panel-heading">
          <div>
            <h2 id="rp-operations-heading">Opérations</h2>
          </div>
          <label className="rp-search">
            <ReportIcon name="search" />
            <span className="rp-sr-only">Rechercher une opération</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Voyageur, logement, catégorie…"
            />
          </label>
        </div>
        <div className="rp-operations-toolbar">
          <div className="rp-filter-tabs" aria-label="Filtrer les opérations">
            {(["included", "review", "excluded"] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={filter === status ? "is-active" : ""}
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
              >
                {statusLabels[status]}
                <span>
                  {
                    displayedResult.rows.filter((row) => row.status === status)
                      .length
                  }
                </span>
              </button>
            ))}
          </div>
          {lastCorrection && canEdit && !snapshot && (
            <button className="rp-text-button" type="button" onClick={undo}>
              <ReportIcon name="undo" />
              Annuler la dernière correction
            </button>
          )}
        </div>
        <div className="rp-operations-table">
          <div className="rp-operation-head" aria-hidden="true">
            <span>Opération</span>
            <span>Logement et catégorie</span>
            <span>Date retenue</span>
            <span>
              {displayedReport.kind === "tourist" ? "Nuitées" : "Montant"}
            </span>
            <span />
          </div>
          {rows.map((row) => (
            <button
              type="button"
              className="rp-operation-row"
              key={row.id}
              onClick={() => setSelectedRow(row)}
            >
              <span className="rp-operation-person">
                <span className="rp-avatar">
                  {row.guest
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
                <span>
                  <strong>{row.guest}</strong>
                  <small>
                    {row.reservation} · {paymentMethodLabel(row.paymentMethod)}
                  </small>
                </span>
              </span>
              <span className="rp-operation-category">
                <strong>{propertyName(row.propertyId)}</strong>
                <small>{categoryLabel(row.category)}</small>
              </span>
              <span className="rp-operation-date">
                {dateLabel(row.effectiveDate)}
              </span>
              <strong className="rp-operation-value">
                {formatReportValue(displayedReport, row.value)}
              </strong>
              <ReportIcon name="arrow" />
            </button>
          ))}
          {!rows.length && (
            <ReportEmpty
              title={
                search
                  ? "Aucune opération correspondante"
                  : filter === "review"
                    ? "Aucune opération à vérifier"
                    : "Aucune opération dans cette sélection"
              }
            >
              {search
                ? "Essayez un autre nom ou une autre catégorie."
                : "Les autres onglets présentent le reste des opérations de la période."}
            </ReportEmpty>
          )}
        </div>
      </section>
      {selectedRow && (
        <OperationDialog
          key={selectedRow.id}
          row={selectedRow}
          reportName={displayedReport.name}
          formattedValue={formatReportValue(displayedReport, selectedRow.value)}
          canEdit={canEdit && !snapshot}
          existingOverride={state.overrides[key]?.[selectedRow.id]}
          correctionLinks={selectedRow.issues.map((issue) => ({
            issue,
            href: sourceCorrectionHref(
              workspace,
              report.id,
              selectedRow,
              issue,
            ),
          }))}
          onClose={() => setSelectedRow(null)}
          onSave={(override) => correct(selectedRow, override)}
        />
      )}
      {confirming && (
        <ReportDialog
          title="Conserver une copie confirmée"
          onClose={() => setConfirming(false)}
        >
          <div className="rp-confirm-value">
            <ReportKindIcon kind={report.kind} />
            <strong>{formatReportValue(report, result.total)}</strong>
            <span>{getReportPeriod(month, report.cadence).label}</span>
          </div>
          <p>
            Dans cet aperçu, vous simulez une confirmation après une démarche
            externe. Les chiffres, les règles et les opérations de cette période
            seront conservés dans une copie figée.
          </p>
          <p className="rp-muted">
            Cette action n’envoie aucune information à un organisme.
          </p>
          <div className="rp-dialog__actions">
            <button
              type="button"
              className="rp-button rp-button--secondary"
              onClick={() => setConfirming(false)}
            >
              Revenir au rapport
            </button>
            <button
              type="button"
              className="rp-button"
              onClick={() => {
                if (!canEdit || result.reviewCount || progress?.snapshot)
                  return;
                setState((previous) => ({
                  ...previous,
                  progress: {
                    ...previous.progress,
                    [key]: {
                      ready: true,
                      snapshot: {
                        confirmedAt: new Date().toISOString(),
                        definition: structuredClone(report),
                        result: structuredClone(result),
                      },
                    },
                  },
                }));
                setConfirming(false);
                notify("Copie enregistrée dans cet onglet.");
              }}
            >
              Confirmer dans la démonstration
            </button>
          </div>
        </ReportDialog>
      )}
      {historyOpen && (
        <ReportDialog
          title="Historique du rapport"
          onClose={() => setHistoryOpen(false)}
        >
          {!snapshots.length ? (
            <ReportEmpty title="Aucune copie enregistrée">
              Une copie apparaîtra lorsque vous confirmerez la transmission
              d’une période dans la démonstration.
            </ReportEmpty>
          ) : (
            <div className="rp-history-list">
              {snapshots.map(([entryKey, entry]) => {
                const item = entry.snapshot!;
                const itemMonth = entryKey.slice(
                  report.id.length + 1,
                  report.id.length + 8,
                );
                return (
                  <button
                    type="button"
                    key={entryKey}
                    onClick={() => {
                      setSnapshotKey(entryKey);
                      setHistoryOpen(false);
                      setFilter("included");
                    }}
                  >
                    <ReportIcon name="document" />
                    <span>
                      <strong>
                        {
                          getReportPeriod(itemMonth, item.definition.cadence)
                            .label
                        }
                      </strong>
                      <small>Confirmé le {dateLabel(item.confirmedAt)}</small>
                    </span>
                    <b>
                      {formatReportValue(item.definition, item.result.total)}
                    </b>
                    <ReportIcon name="arrow" />
                  </button>
                );
              })}
            </div>
          )}
        </ReportDialog>
      )}
    </>
  );
}

function OperationDialog({
  row,
  reportName,
  formattedValue,
  canEdit,
  existingOverride,
  correctionLinks,
  onClose,
  onSave,
}: {
  row: EvaluatedOperation;
  reportName: string;
  formattedValue: string;
  canEdit: boolean;
  existingOverride?: OperationOverride;
  correctionLinks: Array<{
    issue: EvaluatedOperation["issues"][number];
    href: string;
  }>;
  onClose: () => void;
  onSave: (override?: OperationOverride) => void;
}) {
  const [status, setStatus] = useState(row.status);
  const [note, setNote] = useState(existingOverride?.note ?? "");
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (canEdit && note.trim()) onSave({ status, note: note.trim() });
  };
  return (
    <ReportDialog title="Détail de l’opération" onClose={onClose}>
      <div className="rp-operation-detail-heading">
        <div>
          <strong>{row.guest}</strong>
          <span>
            {row.reservation} · {categoryLabel(row.category)}
          </span>
        </div>
        <b>{formattedValue}</b>
      </div>
      <dl className="rp-operation-facts">
        <div>
          <dt>Logement</dt>
          <dd>{propertyName(row.propertyId)}</dd>
        </div>
        <div>
          <dt>Début du séjour</dt>
          <dd>{dateLabel(row.stayDate)}</dd>
        </div>
        <div>
          <dt>Encaissement</dt>
          <dd>{dateLabel(row.paymentDate)}</dd>
        </div>
        <div>
          <dt>Mode de paiement</dt>
          <dd>{paymentMethodLabel(row.paymentMethod)}</dd>
        </div>
        <div>
          <dt>Canal de réservation</dt>
          <dd>{row.channel}</dd>
        </div>
        <div>
          <dt>Rapport</dt>
          <dd>{reportName}</dd>
        </div>
      </dl>
      <div className="rp-operation-explanation">
        <ReportBadge
          tone={
            row.status === "review"
              ? "attention"
              : row.status === "included"
                ? "primary"
                : "neutral"
          }
        >
          {statusLabels[row.status]}
        </ReportBadge>
        <p>{row.reason}</p>
        {canEdit &&
          correctionLinks
            .filter(
              (item, index, items) =>
                items.findIndex((other) => other.href === item.href) === index,
            )
            .map(({ issue, href }) => (
              <Link
                className="rp-button rp-button--secondary"
                key={href}
                to={href}
              >
                {issue.actionLabel}
                <ReportIcon name="arrow" />
              </Link>
            ))}
      </div>
      {canEdit && !row.issues.length ? (
        <form onSubmit={save} className="rp-correction-form">
          <h3>Corriger pour cette période</h3>
          <p className="rp-muted">
            Cette correction concerne uniquement cette opération dans ce
            rapport. Les règles générales restent identiques.
          </p>
          <label className="rp-field">
            Traitement
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as OperationStatus)
              }
            >
              <option value="included">Inclure dans ce rapport</option>
              <option value="review">Garder à vérifier</option>
              <option value="excluded">Mettre hors périmètre</option>
            </select>
          </label>
          <label className="rp-field">
            Explication de votre correction
            <textarea
              required
              maxLength={500}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Précisez pourquoi vous ajustez cette opération…"
            />
          </label>
          <div className="rp-dialog__actions">
            {existingOverride && (
              <button
                type="button"
                className="rp-text-button"
                onClick={() => onSave()}
              >
                Rétablir la règle
              </button>
            )}
            <button
              type="button"
              className="rp-button rp-button--secondary"
              onClick={onClose}
            >
              Fermer
            </button>
            <button className="rp-button" type="submit" disabled={!note.trim()}>
              <ReportIcon name="check" />
              Appliquer la correction
            </button>
          </div>
        </form>
      ) : (
        <div className="rp-dialog__actions">
          <button
            type="button"
            className="rp-button rp-button--secondary"
            onClick={onClose}
          >
            Fermer le détail
          </button>
        </div>
      )}
    </ReportDialog>
  );
}
