import {
  invoiceOperationChoices,
  type InvoiceFiscalInput,
} from "@contrats/shared";

export default function InvoiceOperationEditor({
  value,
  onChange,
}: {
  value: InvoiceFiscalInput["operation_kind"];
  onChange: (value: InvoiceFiscalInput["operation_kind"]) => void;
}) {
  return (
    <fieldset>
      <legend>Nature de l’opération facturée — B2B</legend>
      <label className="field">
        Biens, services ou mixte <span className="invoice-fiscal__required">Requis</span>
        <select
          id="invoice-operation-kind"
          value={value}
          onChange={(event) =>
            onChange(event.target.value as InvoiceFiscalInput["operation_kind"])
          }
        >
          <option value="unknown">À qualifier — aucun choix automatique</option>
          {invoiceOperationChoices.map(({ value: optionValue, label }) => (
            <option key={optionValue} value={optionValue}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">
        Qualifiez cette facture avec votre conseil. Un gîte, un libellé ou un
        taux de TVA ne suffit pas à déterminer la nature de l’opération. « Mixte
        » désigne des biens et services distincts, et non plusieurs taux de TVA.
        Le choix sera figé à l’émission ; le suivi ultérieur du paiement ne le
        changera pas.
      </p>
      <p className="field-hint">
        Ce lot couvre les factures ordinaires et les factures entièrement payées
        à l’émission. Les paiements partiels, factures de solde après acompte,
        opérations déjà déclarées et autres cadres particuliers nécessitent un
        parcours dédié.
      </p>
    </fieldset>
  );
}
