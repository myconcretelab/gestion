import { useEffect, useState } from "react";
import type {
  OtaImportChoice,
  OtaImportPreview,
  OtaSettlementAdjustment,
} from "@contrats/shared";
import { REPORT_CATEGORIES } from "@contrats/shared";
import { Link } from "react-router-dom";
import { apiFetch } from "../../../utils/api";
import {
  canCurrentUserWritePage,
  canCurrentUserAccessPage,
} from "../../../utils/auth";
import { formatEuro, formatDate } from "../../../utils/format";
import type { ReportWorkspace } from "./ReportsPage";
import ReportPageHeader from "./ReportPageHeader";
import "./ota.css";

type ImportHistory = {
  id: string;
  createdAt: string;
  fileName: string;
  rows: number;
  regularized?: number;
  roundingAdjustments?: Array<
    OtaSettlementAdjustment & {
      reservationId: string;
      reservationLabel?: string;
    }
  >;
  totals: OtaImportPreview["totals"];
};
export default function OtaImportPage({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<OtaImportPreview | null>(null);
  const [reservationSearch, setReservationSearch] = useState<
    Record<string, string>
  >({});
  const [editingRows, setEditingRows] = useState<Record<string, boolean>>({});
  const [autoRegularize, setAutoRegularize] = useState(false);
  const [choices, setChoices] = useState<Record<string, OtaImportChoice>>({});
  const [history, setHistory] = useState<ImportHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const allowed = workspace.canEdit && canCurrentUserWritePage("reservations");
  const loadHistory = async () =>
    setHistory(await apiFetch<ImportHistory[]>("/reports/ota/imports"));
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ImportHistory[]>("/reports/ota/imports", {
      signal: controller.signal,
    })
      .then(setHistory)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, []);
  const analyze = async (text: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    setChoices({});
    setAutoRegularize(false);
    setEditingRows({});
    setReservationSearch({});
    try {
      const data = await apiFetch<OtaImportPreview>("/reports/ota/preview", {
        method: "POST",
        json: { content: text },
      });
      setPreview(data);
      setChoices(
        Object.fromEntries(
          data.rows
            .filter((row) => row.type !== "payout")
            .map((row) => [
              row.key,
              {
                key: row.key,
                reservationId: row.reservationId ?? "",
                ...(row.suggestedBasis
                  ? { settlementBasis: row.suggestedBasis }
                  : {}),
              },
            ]),
        ),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pending =
    preview?.rows.filter(
      (row) => row.type !== "payout" && row.status === "new",
    ) ?? [];
  const effectiveChoices: Record<string, OtaImportChoice> = Object.fromEntries(
    Object.entries(choices).map(([key, choice]) => {
      const row = pending.find((row) => row.key === key);
      return [
        key,
        autoRegularize &&
        row?.roundingAdjustment &&
        row.reservationId === choice.reservationId &&
        !choice.settlementBasis
          ? {
              ...choice,
              settlementBasis: "reservation",
              regularizeOneCent: true,
            }
          : choice,
      ];
    }),
  );
  const roundingCandidates = pending.filter((row) => row.roundingAdjustment);
  const incomplete = pending.some(
    (row) =>
      !effectiveChoices[row.key]?.reservationId ||
      (row.type === "resolution"
        ? !effectiveChoices[row.key]?.category
        : !effectiveChoices[row.key]?.settlementBasis),
  );
  const change = (key: string, patch: Partial<OtaImportChoice>) =>
    setChoices((previous) => ({
      ...previous,
      [key]: { ...previous[key], ...patch },
    }));
  const apply = async () => {
    if (!preview || !allowed || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ added: number; regularized?: number }>(
        "/reports/ota/apply",
        {
          method: "POST",
          json: {
            content,
            fileName,
            fingerprint: preview.fingerprint,
            choices: Object.values(effectiveChoices),
          },
        },
      );
      setNotice(
        result.added
          ? `Import enregistré : ${result.added} lignes. ${result.regularized ? `${result.regularized} écart${result.regularized > 1 ? "s" : ""} de 0,01 € régularisé${result.regularized > 1 ? "s" : ""}. ` : ""}Les prix des réservations sont conservés.`
          : "Ce relevé est déjà importé.",
      );
      setPreview(null);
      setContent("");
      await workspace.refresh();
      await loadHistory();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ReportPageHeader
        title="Importer un relevé Airbnb"
        back={{ to: workspace.href(), label: "Tous les rapports" }}
      />
      {!allowed ? (
        <p>
          Les droits de modification des rapports et des réservations sont
          nécessaires pour importer.
        </p>
      ) : (
        <section className="rp-panel ota-upload">
          <label className="rp-field">
            Relevé CSV des transactions effectuées
            <input
              aria-label="Relevé Airbnb"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 5_000_000) {
                  setError("Le fichier dépasse 5 Mo.");
                  return;
                }
                setFileName(file.name);
                const text = await file.text();
                setContent(text);
                await analyze(text);
              }}
            />
          </label>
          <p className="rp-muted">
            Brut, commissions et net sont conservés séparément. La date est
            celle du versement Airbnb ; l’échéance d’arrivée en banque reste une
            information distincte. Un relevé réimporté ne crée aucun doublon.
          </p>
          <a
            href="https://www.airbnb.fr/help/article/3632"
            target="_blank"
            rel="noreferrer"
          >
            Télécharger le relevé depuis Airbnb
          </a>
        </section>
      )}
      {error && (
        <p className="rp-notice" role="alert">
          {error}
          {content && (
            <button
              type="button"
              className="rp-text-button"
              disabled={busy}
              onClick={() => void analyze(content)}
            >
              Recalculer l’aperçu
            </button>
          )}
        </p>
      )}
      {notice && (
        <p className="rp-notice" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status">
          {preview ? "Enregistrement…" : "Analyse du relevé…"}
        </p>
      )}
      {preview && (
        <section
          className="rp-panel ota-preview"
          aria-label="Aperçu de l’import"
        >
          <div className="rp-panel-heading">
            <h2>{fileName}</h2>
            <span>
              {preview.totals.reservations} réservation
              {preview.totals.reservations > 1 ? "s" : ""} ·{" "}
              {preview.totals.payouts} versement
              {preview.totals.payouts > 1 ? "s" : ""} ·{" "}
              {preview.totals.resolutions} complément
              {preview.totals.resolutions > 1 ? "s" : ""}
            </span>
          </div>
          <dl className="ota-totals">
            <div>
              <dt>Brut</dt>
              <dd>{formatEuro(preview.totals.grossCents / 100)}</dd>
            </div>
            <div>
              <dt>Commissions</dt>
              <dd>{formatEuro(preview.totals.feeCents / 100)}</dd>
            </div>
            <div>
              <dt>Net versé</dt>
              <dd>{formatEuro(preview.totals.netCents / 100)}</dd>
            </div>
          </dl>
          <p className="rp-muted">
            Le total des virements correspond au détail du relevé. Les prix
            enregistrés dans les réservations ne seront pas remplacés. En cas
            d’écart, le montant affecté au suivi du séjour se choisit ci-dessous
            ; le brut et le net du relevé restent inchangés.
          </p>
          {roundingCandidates.length > 0 && (
            <div className="ota-rounding">
              <label>
                <input
                  type="checkbox"
                  checked={autoRegularize}
                  disabled={busy || !allowed}
                  onChange={(event) => setAutoRegularize(event.target.checked)}
                />
                Régulariser automatiquement les écarts de 0,01 € (
                {roundingCandidates.length} réservation
                {roundingCandidates.length > 1 ? "s" : ""})
              </label>
              <p>
                Le suivi du séjour est soldé au prix enregistré. Les prix et les
                montants bruts, frais et nets du relevé sont conservés. Les
                écarts plus importants restent à traiter.
              </p>
            </div>
          )}
          <details className="ota-payouts">
            <summary>
              Afficher{" "}
              {preview.totals.payouts === 1
                ? "le virement regroupé"
                : `les ${preview.totals.payouts} virements regroupés`}
            </summary>
            <div className="ota-table-scroll">
              <table className="ota-table">
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Versement Airbnb</th>
                    <th>Arrivée au plus tard</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows
                    .filter((row) => row.type === "payout")
                    .map((row) => (
                      <tr key={row.key}>
                        <td>{row.payoutReference}</td>
                        <td>{formatDate(row.date)}</td>
                        <td>
                          {row.arrivalBy
                            ? formatDate(row.arrivalBy)
                            : "Non indiquée"}
                        </td>
                        <td>{formatEuro(row.netCents / 100)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="ota-table-scroll">
            <table className="ota-table ota-transactions">
              <thead>
                <tr>
                  <th>Réservation et versement</th>
                  <th>Brut / frais / net</th>
                  <th>Rattachement</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .filter((row) => row.type !== "payout")
                  .map((row) => (
                    <tr key={row.key}>
                      <td>
                        <strong>
                          {row.guest || "Règlement complémentaire"}
                        </strong>
                        <span>
                          {row.code} · {formatDate(row.date)}
                        </span>
                        <span>{row.listing}</span>
                        <small>
                          {row.type === "resolution"
                            ? "Demande d’argent / résolution"
                            : "Hébergement"}
                          {row.status === "imported"
                            ? " · Déjà importé"
                            : row.status === "conflict"
                              ? " · Référence en conflit"
                              : ""}
                        </small>
                        {row.warning &&
                          !effectiveChoices[row.key]?.regularizeOneCent &&
                          !(
                            row.type === "resolution" &&
                            effectiveChoices[row.key]?.category
                          ) && <p className="ota-warning">{row.warning}</p>}
                      </td>
                      <td className="ota-table__amount">
                        <strong>{formatEuro(row.grossCents / 100)}</strong>
                        <span>Frais {formatEuro(row.feeCents / 100)}</span>
                        <span>Net {formatEuro(row.netCents / 100)}</span>
                      </td>
                      <td>
                        <div className="ota-match">
                          <strong>
                            {preview.reservations.find(
                              (item) =>
                                item.id ===
                                effectiveChoices[row.key]?.reservationId,
                            )?.label ?? "À rattacher"}
                          </strong>
                          {row.type === "reservation" &&
                            effectiveChoices[row.key]?.settlementBasis && (
                              <span>
                                Suivi du séjour :{" "}
                                {effectiveChoices[row.key]?.settlementBasis ===
                                "net"
                                  ? "net"
                                  : effectiveChoices[row.key]
                                        ?.settlementBasis === "gross"
                                    ? "brut"
                                    : "prix enregistré"}{" "}
                                ·{" "}
                                {formatEuro(
                                  (effectiveChoices[row.key]
                                    ?.settlementBasis === "net"
                                    ? row.netCents
                                    : effectiveChoices[row.key]
                                          ?.settlementBasis === "gross"
                                      ? row.grossCents
                                      : (preview.reservations.find(
                                          (item) =>
                                            item.id ===
                                            effectiveChoices[row.key]
                                              ?.reservationId,
                                        )?.amountCents ??
                                        row.existingAmountCents ??
                                        0)) / 100,
                                )}
                              </span>
                            )}
                          {effectiveChoices[row.key]?.regularizeOneCent &&
                            row.roundingAdjustment && (
                              <span className="ota-rounding-note">
                                Écart d’arrondi du suivi :{" "}
                                {row.roundingAdjustment.adjustmentCents > 0
                                  ? "+"
                                  : ""}
                                {formatEuro(
                                  row.roundingAdjustment.adjustmentCents / 100,
                                )}{" "}
                                par rapport au{" "}
                                {row.roundingAdjustment.basis === "net"
                                  ? "net"
                                  : "brut"}{" "}
                                Airbnb. Régularisé à la confirmation de
                                l’import.
                              </span>
                            )}
                          {effectiveChoices[row.key]?.reservationId && (
                            <Link
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rp-text-button"
                              to={`/reservations/${encodeURIComponent(effectiveChoices[row.key].reservationId)}/reglements?back=${encodeURIComponent(workspace.href("/import-airbnb"))}`}
                            >
                              Ouvrir la réservation ↗
                            </Link>
                          )}
                          {row.status === "new" && (
                            <button
                              className="rp-text-button"
                              type="button"
                              onClick={() =>
                                setEditingRows((previous) => ({
                                  ...previous,
                                  [row.key]: !previous[row.key],
                                }))
                              }
                            >
                              {editingRows[row.key]
                                ? "Réduire les réglages"
                                : "Modifier le rattachement"}
                            </button>
                          )}
                        </div>
                        {(!row.reservationId || editingRows[row.key]) && (
                          <>
                            <label>
                              Rechercher une réservation
                              <input
                                type="search"
                                aria-label={`Rechercher ligne ${row.row}`}
                                value={reservationSearch[row.key] ?? ""}
                                onChange={(event) =>
                                  setReservationSearch((previous) => ({
                                    ...previous,
                                    [row.key]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Réservation
                              <select
                                aria-label={`Réservation ligne ${row.row}`}
                                disabled={busy || row.status !== "new"}
                                value={
                                  effectiveChoices[row.key]?.reservationId ?? ""
                                }
                                onChange={(event) =>
                                  change(row.key, {
                                    reservationId: event.target.value,
                                    settlementBasis: undefined,
                                    paymentId: undefined,
                                  })
                                }
                              >
                                <option value="">Sélectionner…</option>
                                {preview.reservations
                                  .filter(
                                    (item) =>
                                      item.id ===
                                        effectiveChoices[row.key]
                                          ?.reservationId ||
                                      item.label
                                        .toLocaleLowerCase("fr")
                                        .includes(
                                          (
                                            reservationSearch[row.key] ?? ""
                                          ).toLocaleLowerCase("fr"),
                                        ),
                                  )
                                  .map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.label}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          </>
                        )}
                        {row.status === "new" &&
                          (row.type === "resolution" ||
                            (!row.suggestedBasis &&
                              !effectiveChoices[row.key]?.regularizeOneCent) ||
                            editingRows[row.key]) &&
                          (row.type === "reservation" ? (
                            <label>
                              Montant affecté au suivi du séjour
                              <select
                                aria-label={`Montant suivi ligne ${row.row}`}
                                disabled={busy || row.status !== "new"}
                                value={
                                  effectiveChoices[row.key]?.settlementBasis ??
                                  ""
                                }
                                onChange={(event) =>
                                  change(row.key, {
                                    settlementBasis: event.target
                                      .value as OtaImportChoice["settlementBasis"],
                                  })
                                }
                              >
                                <option value="">Choisir…</option>
                                <option value="net">
                                  Net : {formatEuro(row.netCents / 100)}
                                </option>
                                <option value="gross">
                                  Brut : {formatEuro(row.grossCents / 100)}
                                </option>
                                <option value="reservation">
                                  Prix du séjour enregistré
                                  {(preview.reservations.find(
                                    (item) =>
                                      item.id ===
                                      effectiveChoices[row.key]?.reservationId,
                                  )?.amountCents ?? row.existingAmountCents) ==
                                  null
                                    ? ""
                                    : ` : ${formatEuro((preview.reservations.find((item) => item.id === effectiveChoices[row.key]?.reservationId)?.amountCents ?? row.existingAmountCents ?? 0) / 100)}`}
                                </option>
                              </select>
                            </label>
                          ) : (
                            <label>
                              Catégorie du complément
                              <select
                                aria-label={`Catégorie ligne ${row.row}`}
                                disabled={busy || row.status !== "new"}
                                value={
                                  effectiveChoices[row.key]?.category ?? ""
                                }
                                onChange={(event) =>
                                  change(row.key, {
                                    category: event.target
                                      .value as OtaImportChoice["category"],
                                  })
                                }
                              >
                                <option value="">Choisir…</option>
                                {REPORT_CATEGORIES.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        {(editingRows[row.key] ||
                          Boolean(
                            preview.reservations.find(
                              (item) =>
                                item.id ===
                                effectiveChoices[row.key]?.reservationId,
                            )?.payments?.length,
                          )) && (
                          <label>
                            Rapprochement d’un règlement déjà saisi
                            <select
                              aria-label={`Règlement ligne ${row.row}`}
                              disabled={busy || row.status !== "new"}
                              value={effectiveChoices[row.key]?.paymentId ?? ""}
                              onChange={(event) =>
                                change(row.key, {
                                  paymentId: event.target.value || undefined,
                                })
                              }
                            >
                              <option value="">
                                Aucun règlement existant à rapprocher
                              </option>
                              <option value="new">
                                Confirmer un nouveau règlement distinct
                              </option>
                              {preview.reservations
                                .find(
                                  (item) =>
                                    item.id ===
                                    effectiveChoices[row.key]?.reservationId,
                                )
                                ?.payments?.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="ota-import-actions">
            <span>
              {incomplete
                ? "Complétez les choix signalés avant de confirmer."
                : `${pending.length} règlement${pending.length > 1 ? "s" : ""} à importer.`}
            </span>
            <button
              className="rp-button"
              type="button"
              disabled={
                busy ||
                incomplete ||
                !pending.length ||
                preview.rows.some((row) => row.status === "conflict")
              }
              onClick={() => void apply()}
            >
              Confirmer l’import
            </button>
          </div>
        </section>
      )}
      <section className="rp-panel ota-history-panel">
        <div className="rp-panel-heading">
          <h2>Imports enregistrés</h2>
          <Link to="/parametres/reglements">Réglages des commissions</Link>
        </div>
        {!history.length ? (
          <p className="rp-muted">Aucun relevé importé.</p>
        ) : (
          <ul className="ota-history">
            {history.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.fileName}</strong>
                  <span>
                    {formatDate(item.createdAt)} · {item.rows} lignes
                  </span>
                  {Boolean(item.regularized) && (
                    <details>
                      <summary>
                        {item.regularized} écart
                        {item.regularized! > 1 ? "s" : ""} d’arrondi régularisé
                        {item.regularized! > 1 ? "s" : ""}
                      </summary>
                      {item.roundingAdjustments?.map((adjustment, index) => (
                        <p key={index}>
                          {canCurrentUserAccessPage("reservations") ? (
                            <Link
                              to={`/reservations/${encodeURIComponent(adjustment.reservationId)}/reglements?back=${encodeURIComponent(workspace.href("/import-airbnb"))}`}
                            >
                              {adjustment.reservationLabel ??
                                "Voir la réservation"}
                            </Link>
                          ) : (
                            (adjustment.reservationLabel ?? "Réservation")
                          )}
                          <span>
                            {formatEuro(adjustment.sourceAmountCents / 100)}{" "}
                            {adjustment.basis === "net" ? "nets" : "bruts"}{" "}
                            Airbnb →{" "}
                            {formatEuro(adjustment.recordedAmountCents / 100)}{" "}
                            au suivi du séjour.
                          </span>
                        </p>
                      ))}
                    </details>
                  )}
                </div>
                <strong>{formatEuro(item.totals.netCents / 100)} nets</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
