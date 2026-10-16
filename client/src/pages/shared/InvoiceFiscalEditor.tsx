import { useState } from "react";
import {
  computeInvoiceFiscal,
  invoiceFiscalInputSchema,
  b2bPaymentMentionFields,
  type InvoiceFiscalInput,
  type InvoiceFiscalLine,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { formatEuro } from "../../utils/format";
import "./invoiceFiscal.css";

export default function InvoiceFiscalEditor({
  value,
  onChange,
  payload,
  expectedTotal,
}: {
  value: InvoiceFiscalInput | null;
  onChange: (value: InvoiceFiscalInput) => void;
  payload: unknown;
  expectedTotal: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const result = await apiFetch<{ fiscal_input: InvoiceFiscalInput }>(
        "/invoices/fiscal-preview",
        { method: "POST", json: payload },
      );
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Préparation impossible.");
    } finally {
      setLoading(false);
    }
  };
  const update = (patch: Partial<InvoiceFiscalInput>) =>
    value && onChange({ ...value, reviewed: false, ...patch });
  const updateBuyer = (patch: Partial<InvoiceFiscalInput["buyer"]>) =>
    value && update({ buyer: { ...value.buyer, ...patch } });
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
  return (
    <section
      className="card invoice-fiscal"
      aria-label="Données fiscales de la facture"
    >
      <div className="section-title">Client fiscal, lignes et TVA</div>
      <p>
        Les prix restent TTC et le total du séjour ne change pas. Les taux et
        exonérations doivent être vérifiés avec votre comptable ; aucun taux
        n’est choisi automatiquement.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={loading}
        onClick={() => void prepare()}
      >
        {loading
          ? "Préparation…"
          : value
            ? "Reproposer les lignes depuis le séjour"
            : "Préparer les lignes depuis le séjour"}
      </button>
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
          <h3>Identité du client facturé</h3>
          <p>
            Le nom du destinataire est celui du champ « Nom » ci-dessus.
            L’adresse ci-dessous sera utilisée sur la facture émise.
          </p>
          <div className="grid-2">
            <label className="field">
              Type de client
              <select
                value={value.buyer.kind}
                onChange={(e) =>
                  updateBuyer({
                    kind: e.target.value as InvoiceFiscalInput["buyer"]["kind"],
                    siren: "",
                    vat_number: "",
                  })
                }
              >
                <option value="unknown">À préciser</option>
                <option value="individual">Particulier (B2C)</option>
                <option value="business">Entreprise</option>
              </select>
            </label>
            <label className="field">
              Pays du client (code ISO)
              <input
                value={value.buyer.country_code}
                maxLength={2}
                placeholder="FR"
                onChange={(e) =>
                  updateBuyer({ country_code: e.target.value.toUpperCase() })
                }
              />
            </label>
            <label className="field">
              Adresse de facturation
              <input
                value={value.buyer.address_line1}
                maxLength={500}
                onChange={(e) => updateBuyer({ address_line1: e.target.value })}
              />
            </label>
            <label className="field">
              Complément d’adresse
              <input
                value={value.buyer.address_line2}
                maxLength={500}
                onChange={(e) => updateBuyer({ address_line2: e.target.value })}
              />
            </label>
            <label className="field">
              Code postal
              <input
                value={value.buyer.postal_code}
                onChange={(e) => updateBuyer({ postal_code: e.target.value })}
              />
            </label>
            <label className="field">
              Ville
              <input
                value={value.buyer.city}
                onChange={(e) => updateBuyer({ city: e.target.value })}
              />
            </label>
            {value.buyer.kind === "business" && (
              <>
                <label className="field">
                  SIREN (entreprise française)
                  <input
                    value={value.buyer.siren}
                    maxLength={9}
                    onChange={(e) => updateBuyer({ siren: e.target.value })}
                  />
                </label>
                <label className="field">
                  Numéro de TVA du client, si applicable
                  <input
                    value={value.buyer.vat_number}
                    onChange={(e) =>
                      updateBuyer({ vat_number: e.target.value.toUpperCase() })
                    }
                  />
                </label>
              </>
            )}
          </div>
          <h3>Lignes de facture</h3>
          <p>
            La remise est déjà déduite de la location. Pour une réservation
            regroupée, ventilez les prestations si leurs traitements de TVA
            diffèrent. La taxe de séjour n’est ni ajoutée ni classée
            automatiquement : vérifiez sa collecte et sa présence dans les prix.
          </p>
          {value.lines.map((line, index) => (
            <fieldset key={line.id}>
              <legend>Ligne {index + 1}</legend>
              <div className="grid-2">
                <label className="field">
                  Libellé
                  <input
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
                      updateLine(line.id, { quantity: Number(e.target.value) })
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
                    <option value="DAY">Jour</option>
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
                <label className="field">
                  Traitement de TVA
                  <select
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
                    Taux de TVA (%)
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
                    Motif et référence légale
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
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  update({
                    lines: value.lines.filter((item) => item.id !== line.id),
                  })
                }
              >
                Retirer cette ligne
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={value.lines.length >= 100}
            onClick={() =>
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
              })
            }
          >
            Ajouter une ligne
          </button>
          <h3>Paiement à l’émission</h3>
          <p>
            Indiquez uniquement les sommes effectivement encaissées, pas les
            arrhes simplement prévues au contrat. Le suivi du paiement après
            émission restera indépendant du PDF archivé.
          </p>
          <div className="grid-2">
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
              Échéance du solde
              <input
                type="date"
                value={value.payment_due_date}
                onChange={(e) => update({ payment_due_date: e.target.value })}
              />
            </label>
            <label className="field">
              Conditions de paiement
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
                proposé automatiquement. Ces mêmes mentions figureront sur le
                PDF et dans les données électroniques, y compris pour un avoir.
              </p>
              <div className="grid-2">
                {b2bPaymentMentionFields.map(({ key, label }) => (
                  <label className="field" key={key}>
                    {label}
                    <textarea
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
          {totals && (
            <div className="note" aria-live="polite">
              <p>
                Total HT : {money(totals.net_cents)} · TVA :{" "}
                {money(totals.vat_cents)} · TTC : {money(totals.gross_cents)} ·
                Reste à régler : {money(totals.due_cents)}
              </p>
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
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.tourist_tax_reviewed}
              onChange={(e) =>
                update({ tourist_tax_reviewed: e.target.checked })
              }
            />
            J’ai vérifié le traitement et la collecte de la taxe de séjour, y
            compris pour chaque réservation regroupée.
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.reviewed}
              onChange={(e) => update({ reviewed: e.target.checked })}
            />
            J’ai vérifié le destinataire, la ventilation, les taux, les motifs
            fiscaux et les sommes réellement reçues.
          </label>
          <p className="field-hint">
            Ce détail prépare les données électroniques. Il ne constitue pas une
            certification de conformité et ne transmet rien à SuperPDP.
          </p>
        </>
      )}
    </section>
  );
}
