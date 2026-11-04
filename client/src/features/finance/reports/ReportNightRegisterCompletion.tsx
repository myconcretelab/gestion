import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  nightRegisterCompletionSchema,
  type NightRegister,
} from "@contrats/shared";
import { canCurrentUserAccessPage } from "../../../utils/auth";
import { reservationPaymentsHref } from "../../../utils/reservationNavigation";
import type { ReportWorkspace } from "./ReportsPage";

const moneyInput = (value: number | null) =>
  value === null ? "" : (value / 100).toFixed(2);
const parseMoney = (value: string) =>
  value.trim() === ""
    ? null
    : Math.round(Number(value.replace(",", ".")) * 100);

export default function ReportNightRegisterCompletion({
  data,
  workspace,
  month,
  onSaved,
}: {
  data: NightRegister;
  workspace: ReportWorkspace;
  month: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(data.completion?.note ?? "");
  const [error, setError] = useState("");
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      data.rows.map((row) => [
        row.key,
        {
          collectionDate: row.collectionDate ?? "",
          collectedTaxCents: moneyInput(row.collectedTaxCents),
          collectedBaseTaxCents: moneyInput(row.collectedBaseTaxCents),
          additionalTaxes: row.additionalTaxes ?? "",
          nightlyPriceCents: moneyInput(row.nightlyPriceCents),
          nightlyPrices: Object.fromEntries(
            (row.nightlyPrices ?? []).map((night) => [
              night.date,
              moneyInput(night.amountCents),
            ]),
          ),
          allocationReviewed:
            data.completion?.rows[row.key]?.allocationReviewed ?? false,
        },
      ]),
    ),
  );
  if (!workspace.canEdit || data.archivedAt) return null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const completion = nightRegisterCompletionSchema.safeParse({
      sourceRevision: data.sourceRevision,
      note,
      rows: Object.fromEntries(
        Object.entries(rows).map(([key, row]) => [
          key,
          {
            ...row,
            collectionDate: row.collectionDate || null,
            collectedTaxCents: parseMoney(row.collectedTaxCents),
            collectedBaseTaxCents: parseMoney(row.collectedBaseTaxCents),
            nightlyPriceCents: parseMoney(row.nightlyPriceCents),
            nightlyPrices: Object.entries(row.nightlyPrices)
              .filter(([, amount]) => amount.trim())
              .map(([date, amount]) => ({
                date,
                amountCents: parseMoney(amount),
              })),
          },
        ]),
      ),
    });
    if (!completion.success) {
      setError(
        "Vérifiez les dates, les montants positifs et la note de justification (au moins 3 caractères).",
      );
      return;
    }
    setError("");
    if (
      await workspace.mutate(
        {
          type: "night-register-completion",
          reportId: data.reportId,
          completion: completion.data,
        },
        month,
      )
    ) {
      workspace.notify("Compléments du registre enregistrés.");
      onSaved();
    } else
      setError(
        "Les compléments n’ont pas été enregistrés. Rechargez l’aperçu si les sources ont changé ; votre saisie reste disponible.",
      );
  };
  if (!editing)
    return (
      <button
        type="button"
        className="rp-text-button"
        onClick={() => setEditing(true)}
      >
        Compléter les perceptions et leur ventilation
      </button>
    );
  return (
    <form className="rp-register-completion" onSubmit={save}>
      <h3>Compléments justifiés du registre</h3>
      <p className="rp-muted">
        Renseignez les perceptions à partir de vos justificatifs. Les montants
        sont affectés aux nuits de cette période. La saisie est conservée avec
        une note ; une modification des sources demandera une nouvelle
        vérification.
      </p>
      {data.rows.map((row) => {
        const edit = rows[row.key];
        const patch = (value: Partial<typeof edit>) =>
          setRows((current) => ({
            ...current,
            [row.key]: { ...current[row.key], ...value },
          }));
        return (
          <details key={row.key} className="rp-register-completion-row">
            <summary>
              {row.propertyName} · {row.reference} ·{" "}
              {row.arrival.split("-").reverse().join("/")}
            </summary>
            {canCurrentUserAccessPage("reservations") && (
              <Link
                className="rp-text-button"
                to={reservationPaymentsHref(row.reservationId, row.arrival)}
              >
                Vérifier la réservation et ses règlements
              </Link>
            )}
            {row.collector === "unknown" ? (
              <p>
                Précisez le barème, les occupants et le collecteur dans la
                réservation.
              </p>
            ) : (
              row.collector !== "not_applicable" && (
                <div className="rp-register-inputs">
                  <label className="rp-field">
                    Date réelle de perception
                    <input
                      type="date"
                      value={edit.collectionDate}
                      onChange={(event) =>
                        patch({ collectionDate: event.target.value })
                      }
                    />
                  </label>
                  <label className="rp-field">
                    Taxe collectée affectée à cette période (€)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={edit.collectedTaxCents}
                      onChange={(event) =>
                        patch({ collectedTaxCents: event.target.value })
                      }
                    />
                  </label>
                  <label className="rp-field">
                    Part hors taxes additionnelles (€)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={edit.collectedBaseTaxCents}
                      onChange={(event) =>
                        patch({ collectedBaseTaxCents: event.target.value })
                      }
                    />
                  </label>
                  <label className="rp-field">
                    Détail de chaque taxe additionnelle, ou absence
                    <input
                      maxLength={1000}
                      value={edit.additionalTaxes}
                      onChange={(event) =>
                        patch({ additionalTaxes: event.target.value })
                      }
                      placeholder="Taxe départementale : 1,20 €"
                    />
                  </label>
                  <label className="rp-reference-choice">
                    <input
                      type="checkbox"
                      checked={edit.allocationReviewed}
                      onChange={(event) =>
                        patch({ allocationReviewed: event.target.checked })
                      }
                    />
                    Ventilation entre périodes, hébergements et remboursements
                    vérifiée sur justificatifs
                  </label>
                </div>
              )
            )}
            {row.classified === false && (
              <>
                <label className="rp-field">
                  Prix uniforme de chaque nuit hors taxe de séjour, si vérifié
                  (€)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={edit.nightlyPriceCents}
                    onChange={(event) =>
                      patch({ nightlyPriceCents: event.target.value })
                    }
                  />
                </label>
                <details>
                  <summary>
                    Renseigner des prix différents selon les nuits
                  </summary>
                  <div className="rp-register-inputs">
                    {Array.from({ length: row.nights }, (_, index) =>
                      new Date(Date.parse(row.periodStart) + index * 86400000)
                        .toISOString()
                        .slice(0, 10),
                    ).map((date) => (
                      <label className="rp-field" key={date}>
                        Nuit du {date.split("-").reverse().join("/")} (€)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={edit.nightlyPrices[date] ?? ""}
                          onChange={(event) =>
                            patch({
                              nightlyPrices: {
                                ...edit.nightlyPrices,
                                [date]: event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </details>
                <p className="rp-field-help">
                  Renseignez un prix uniforme vérifié ou le prix de chaque nuit,
                  sans utiliser un prix moyen. Les montants détaillés couvrent
                  uniquement les nuits de cette période.
                </p>
              </>
            )}
          </details>
        );
      })}
      <label className="rp-field">
        Justification et références des pièces vérifiées
        <textarea
          required
          minLength={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error && (
        <p className="rp-notice" role="alert">
          {error}
        </p>
      )}
      <button
        className="rp-button"
        type="submit"
        disabled={workspace.saving || workspace.loading}
      >
        Enregistrer les compléments
      </button>
    </form>
  );
}
