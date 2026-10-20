import {
  focusInvoiceField,
  type InvoiceValidationOptions,
} from "./invoiceFormCompletion";
import { useState, type ReactNode } from "react";
import {
  computeInvoiceFiscal,
  invoiceFiscalInputSchema,
  b2bPaymentMentionFields,
  type InvoiceFiscalInput,
  type InvoiceFiscalLine,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { formatDate, formatEuro } from "../../utils/format";
import "./invoiceFiscal.css";
import InvoiceOperationEditor from "./InvoiceOperationEditor";

export default function InvoiceFiscalEditor({
  value,
  onChange,
  payload,
  expectedTotal,
  children,
  touristTaxRequired = false,
  pricingEditor,
  onReprepared,
  manualLines = false,
  vatPresetHint,
}: {
  value: InvoiceFiscalInput | null;
  onChange: (value: InvoiceFiscalInput) => void;
  payload: unknown;
  expectedTotal: number;
  children?: ReactNode;
  touristTaxRequired?: boolean;
  pricingEditor?: ReactNode;
  onReprepared?: (options?: InvoiceValidationOptions) => void;
  vatPresetHint?: string;
  manualLines?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedLines, setExpandedLines] = useState<string[]>([]);
  const prepare = async () => {
    if (
      value?.lines.length &&
      !window.confirm(
        "Remplacer les lignes fiscales par une nouvelle proposition issue du séjour ? Les coordonnées client et les paiements saisis seront conservés.",
      )
    )
      return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{
        fiscal_input: InvoiceFiscalInput;
        validation_options?: InvoiceValidationOptions;
      }>("/invoices/fiscal-preview", {
        method: "POST",
        json: {
          ...(payload as Record<string, unknown>),
          fiscal_input: undefined,
        },
      });
      onChange(
        value
          ? {
              ...value,
              lines: result.fiscal_input.lines,
              reviewed: false,
              tourist_tax_reviewed: false,
            }
          : result.fiscal_input,
      );
      onReprepared?.(result.validation_options);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Préparation impossible.");
    } finally {
      setLoading(false);
    }
  };
  const update = (patch: Partial<InvoiceFiscalInput>) =>
    value && onChange({ ...value, reviewed: false, ...patch });
  const updateLine = (id: string, patch: Partial<InvoiceFiscalLine>) =>
    value &&
    update({
      lines: value.lines.map((line) =>
        line.id === id ? { ...line, ...patch } : line,
      ),
    });
  const validInput = invoiceFiscalInputSchema.safeParse(value);
  const totals = validInput.success
    ? computeInvoiceFiscal(validInput.data)
    : null;
  const money = (cents: number) => formatEuro(cents / 100);
  const required = (note = "Requis") => (
    <span className="invoice-fiscal__required">{note}</span>
  );
  const fieldLabel = (label: string, marker: ReactNode = required()) => (
    <span className="invoice-fiscal__label-row">
      <span>{label}</span>
      {marker}
    </span>
  );
  return (
    <section
      id="invoice-fiscal"
      data-invoice-step="2"
      tabIndex={-1}
      className="card invoice-fiscal"
      aria-label="Données fiscales de la facture"
    >
      <div className="invoice-fiscal__header">
        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => void prepare()}
        >
          {loading
            ? "Préparation…"
            : value
              ? "Recalculer les lignes"
              : "Préparer les lignes depuis le séjour"}
        </button>
      </div>
      {error && (
        <p role="alert" className="note">
          {error}
        </p>
      )}
      {value && (
        <>
          {!validInput.success && (
            <p role="alert" className="note">
              {validInput.error.issues[0]?.message}
            </p>
          )}
          <div className="invoice-fiscal__columns">
            <div
              className="invoice-fiscal__lines"
              id="invoice-lines"
              tabIndex={-1}
            >
              <h3>Lignes de facture</h3>
              {pricingEditor}
              {vatPresetHint && (
                <p className="field-hint invoice-fiscal__vat-hint">
                  {vatPresetHint}
                </p>
              )}
              {manualLines && (
                <p className="field-hint">
                  Votre ventilation personnalisée est conservée. Si vous
                  modifiez le séjour, vous pouvez recalculer les lignes ou
                  ajuster leur répartition ci-dessous. Le total doit rester
                  identique.
                </p>
              )}
              <p>
                La remise est déjà déduite de la location. Chaque séjour
                conserve ses prestations et ses frais. La taxe de séjour n’est
                ni ajoutée ni classée automatiquement : vérifiez sa collecte et
                sa présence dans les prix.
              </p>
              {value.lines.flatMap((line, index) => [
                line.source &&
                line.source.stay_id !==
                  value.lines[index - 1]?.source?.stay_id ? (
                  <div key={`stay-${line.id}`} className="invoice-stay-heading">
                    <strong>{line.source.stay_label}</strong>
                    <span>
                      {formatDate(line.source.date_debut)} —{" "}
                      {formatDate(line.source.date_fin)}
                    </span>
                    {line.source.discount > 0 && (
                      <small>
                        Tarif initial :{" "}
                        {formatEuro(line.source.original_nightly_price)} / nuit
                        · remise de {formatEuro(line.source.discount)} déjà
                        déduite des nuitées.
                      </small>
                    )}
                  </div>
                ) : null,
                <fieldset key={line.id}>
                  <legend>
                    Ligne {index + 1} ·{" "}
                    {formatEuro(line.quantity * line.unit_price_ttc)}
                  </legend>
                  <div className="invoice-line__header">
                    <div className="invoice-line__summary">
                      <strong>{line.label || "Ligne à compléter"}</strong>
                      <span>
                        {line.quantity}{" "}
                        {line.unit === "DAY"
                          ? /^Location(?: ·|$)/.test(line.label)
                            ? line.quantity > 1
                              ? "nuitées"
                              : "nuitée"
                            : line.quantity > 1
                              ? "jours"
                              : "jour"
                          : line.unit === "E48"
                            ? "prestation(s)"
                            : "unité(s)"}{" "}
                        × {formatEuro(line.unit_price_ttc)} TTC
                      </span>
                    </div>
                    <button
                      type="button"
                      className="secondary invoice-line__edit"
                      aria-expanded={expandedLines.includes(line.id)}
                      aria-controls={`invoice-line-edit-${line.id}`}
                      onClick={() =>
                        setExpandedLines((previous) =>
                          previous.includes(line.id)
                            ? previous.filter((id) => id !== line.id)
                            : [...previous, line.id],
                        )
                      }
                    >
                      Personnaliser cette ligne
                    </button>
                  </div>
                  <div
                    id={`invoice-line-edit-${line.id}`}
                    className="invoice-line__allocation"
                    hidden={!expandedLines.includes(line.id)}
                  >
                    <div className="grid-2">
                      <label className="field">
                        {fieldLabel("Libellé")}
                        <input
                          id={
                            index === 0
                              ? "invoice-line-label"
                              : `invoice-line-label-${index}`
                          }
                          value={line.label}
                          maxLength={500}
                          onChange={(e) =>
                            updateLine(line.id, { label: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        Quantité
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.id, {
                              quantity: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        Unité
                        <select
                          value={line.unit}
                          onChange={(e) =>
                            updateLine(line.id, {
                              unit: e.target.value as InvoiceFiscalLine["unit"],
                            })
                          }
                        >
                          <option value="C62">Unité / forfait</option>
                          <option value="DAY">Nuitée / jour</option>
                          <option value="E48">Prestation</option>
                        </select>
                      </label>
                      <label className="field">
                        Prix unitaire TTC (€)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_price_ttc}
                          onChange={(e) =>
                            updateLine(line.id, {
                              unit_price_ttc: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        update({
                          lines: value.lines.filter(
                            (item) => item.id !== line.id,
                          ),
                        })
                      }
                    >
                      Retirer cette ligne
                    </button>
                  </div>
                  <div className="grid-2">
                    <div className="invoice-fiscal__vat">
                      <div className="grid-2">
                        <label className="field">
                          {fieldLabel("Traitement de TVA")}
                          <select
                            id={
                              index === 0
                                ? "invoice-line-vat"
                                : `invoice-line-vat-${index}`
                            }
                            value={line.vat_category}
                            onChange={(e) =>
                              updateLine(line.id, {
                                vat_category: e.target
                                  .value as InvoiceFiscalLine["vat_category"],
                                vat_rate: 0,
                                exemption_reason: "",
                              })
                            }
                          >
                            <option value="unknown">À préciser</option>
                            <option value="S">Soumis à TVA (S)</option>
                            <option value="Z">Taux zéro (Z)</option>
                            <option value="E">Exonéré / franchise (E)</option>
                            <option value="O">Hors champ (O)</option>
                          </select>
                        </label>
                        {line.vat_category === "S" && (
                          <label className="field">
                            {fieldLabel("Taux de TVA (%)")}
                            <input
                              type="number"
                              min="0.01"
                              max="100"
                              step="0.01"
                              value={line.vat_rate}
                              onChange={(e) =>
                                updateLine(line.id, {
                                  vat_rate: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        )}
                        {["E", "O"].includes(line.vat_category) && (
                          <label className="field">
                            {fieldLabel("Motif et référence légale")}
                            <input
                              value={line.exemption_reason}
                              maxLength={500}
                              placeholder="Référence fiscale à vérifier"
                              onChange={(e) =>
                                updateLine(line.id, {
                                  exemption_reason: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                </fieldset>,
              ])}
              <details className="invoice-line__allocation">
                <summary>Ajouter une ventilation personnalisée</summary>
                <p className="field-hint">
                  Pour ajouter un montant à la facture, utilisez les frais
                  supplémentaires ci-dessus. La ventilation répartit le même
                  total entre les prestations.
                </p>
                <button
                  type="button"
                  className="secondary"
                  disabled={value.lines.length >= 100}
                  onClick={() => {
                    const index = value.lines.length;
                    update({
                      lines: [
                        ...value.lines,
                        {
                          id: crypto.randomUUID(),
                          label: "",
                          quantity: 1,
                          unit: "C62",
                          unit_price_ttc: 0,
                          vat_category: "unknown",
                          vat_rate: 0,
                          exemption_reason: "",
                        },
                      ],
                    });
                    window.setTimeout(
                      () =>
                        focusInvoiceField(
                          index
                            ? `invoice-line-label-${index}`
                            : "invoice-line-label",
                        ),
                      0,
                    );
                  }}
                >
                  Ajouter une ligne de ventilation
                </button>
              </details>
            </div>
            <div className="invoice-fiscal__payment">
              <h3>Paiement à l’émission</h3>
              <p>
                Indiquez uniquement les sommes effectivement encaissées, pas les
                arrhes simplement prévues au contrat. Le suivi du paiement après
                émission restera indépendant du PDF archivé.
              </p>
              <div className="grid-2" id="payment-details" tabIndex={-1}>
                <label className="field">
                  Sommes réellement reçues (€)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={value.paid_amount}
                    onChange={(e) =>
                      update({ paid_amount: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  {fieldLabel(
                    "Échéance du solde",
                    required("Requis si solde dû"),
                  )}
                  <input
                    type="date"
                    value={value.payment_due_date}
                    onChange={(e) =>
                      update({ payment_due_date: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  {fieldLabel(
                    "Conditions de paiement",
                    required("Alternative à l’échéance"),
                  )}
                  <textarea
                    value={value.payment_terms}
                    maxLength={2000}
                    onChange={(e) => update({ payment_terms: e.target.value })}
                  />
                </label>
              </div>
              {value.buyer.kind === "business" && (
                <fieldset>
                  <legend>Mentions de paiement — client professionnel</legend>
                  <p>
                    Renseignez les textes complets après vérification de vos
                    conditions avec votre comptable. Aucun montant ni taux n’est
                    proposé automatiquement. Ces mêmes mentions figureront sur
                    le PDF et dans les données électroniques, y compris pour un
                    avoir.
                  </p>
                  <div className="grid-2">
                    {b2bPaymentMentionFields.map(({ key, label }, index) => (
                      <label className="field" key={key}>
                        {fieldLabel(label)}
                        <textarea
                          id={index === 0 ? "b2b-payment-mentions" : undefined}
                          value={value.b2b_payment_mentions?.[key] ?? ""}
                          maxLength={500}
                          onChange={(e) =>
                            update({
                              b2b_payment_mentions: {
                                ...(value.b2b_payment_mentions ?? {
                                  late_payment_penalties: "",
                                  recovery_fee: "",
                                  early_payment_discount: "",
                                }),
                                [key]: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {value.buyer.kind === "business" && (
                <InvoiceOperationEditor
                  value={value.operation_kind}
                  onChange={(operation_kind) => update({ operation_kind })}
                />
              )}
            </div>
          </div>
          {totals && (
            <div className="invoice-fiscal__totals" aria-live="polite">
              <div className="invoice-fiscal__amounts">
                <div>
                  <span>Total HT</span>
                  <strong>{money(totals.net_cents)}</strong>
                </div>
                <div>
                  <span>TVA</span>
                  <strong>{money(totals.vat_cents)}</strong>
                </div>
                <div>
                  <span>Total TTC</span>
                  <strong>{money(totals.gross_cents)}</strong>
                </div>
                <div>
                  <span>Reste à régler</span>
                  <strong>{money(totals.due_cents)}</strong>
                </div>
              </div>
              {totals.rounding_cents !== 0 && (
                <p>Arrondi TTC explicite : {money(totals.rounding_cents)}.</p>
              )}
              {totals.gross_cents !== Math.round(expectedTotal * 100) && (
                <p role="alert">
                  Le détail ne correspond pas au total du séjour :{" "}
                  {formatEuro(expectedTotal)}. Corrigez les lignes ou
                  reproposez-les avant validation.
                </p>
              )}
            </div>
          )}
          <div className="invoice-fiscal__review">
            {touristTaxRequired && (
              <>
                <div className="invoice-fiscal__tourist-tax-help">
                  <strong>Taxe de séjour : où modifier les réglages ?</strong>
                  <p>
                    Le tarif par personne et par nuit se modifie dans Gîtes →
                    Gestion → Fiscalité & banque. Le montant calculé n’est pas
                    ajouté automatiquement au total de la facture.
                  </p>
                  <p>
                    Si la taxe est comprise dans le prix, utilisez «
                    Personnaliser cette ligne » et « Ajouter une ventilation
                    personnalisée » pour répartir le même total et renseigner
                    son traitement de TVA. Si elle est facturée en plus, ajoutez
                    un frais supplémentaire. Si une plateforme la collecte
                    séparément, ne l’ajoutez pas une seconde fois.
                  </p>
                  <p>
                    La case ci-dessous confirme votre vérification ; elle ne
                    modifie ni le montant ni le mode de collecte.
                  </p>
                </div>
                <label className="checkbox">
                  <input
                    id="tourist-tax-reviewed"
                    type="checkbox"
                    checked={value.tourist_tax_reviewed}
                    onChange={(e) =>
                      update({ tourist_tax_reviewed: e.target.checked })
                    }
                  />
                  J’ai vérifié le traitement et la collecte de la taxe de
                  séjour, y compris pour chaque réservation regroupée.{" "}
                  {required()}
                </label>
              </>
            )}
            <label className="checkbox">
              <input
                id="invoice-reviewed"
                type="checkbox"
                checked={value.reviewed}
                onChange={(e) => update({ reviewed: e.target.checked })}
              />
              J’ai vérifié le destinataire, la ventilation, les taux, les motifs
              fiscaux et les sommes réellement reçues. {required()}
            </label>
          </div>
          {children}
          <p className="field-hint">
            Ce détail prépare les données électroniques. Il ne constitue pas une
            certification de conformité et ne transmet rien à SuperPDP.
          </p>
        </>
      )}
    </section>
  );
}
