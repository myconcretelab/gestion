import {
  bookingEmailTemplateKeys,
  bookingEmailTemplates,
  type BookingEmailTemplateKey,
} from "@contrats/shared";

export default function BookingEmailTemplatesEditor({
  templates,
  disabled,
  onChange,
}: {
  templates: Record<BookingEmailTemplateKey, { subject: string; body: string }>;
  disabled: boolean;
  onChange: (
    key: BookingEmailTemplateKey,
    field: "subject" | "body",
    value: string,
  ) => void;
}) {
  return (
    <div className="settings-sms-text-list settings-sms-texts" style={{ marginTop: 20 }}>
      <p className="note">
        Ces textes utilisent la même présentation que les contrats : logo de
        l’organisation, photo principale publique du gîte et coordonnées. Les
        confirmations envoyées aux clients après paiement reprennent le modèle «
        Confirmation de réservation » ci-dessus. Les notifications aux
        propriétaires utilisent leurs propres modèles ci-dessous.
      </p>
      <p className="field-hint">
        Variables de règlement : <code>{"{{paymentSummary}}"}</code>,{" "}
        <code>{"{{paidAmount}}"}</code>, <code>{"{{remainingAmount}}"}</code>,{" "}
        <code>{"{{arrhesMontant}}"}</code>,{" "}
        <code>{"{{stayPaymentInstruction}}"}</code>. Autres variables :{" "}
        <code>{"{{holdExpiresAt}}"}</code>, <code>{"{{clientDetails}}"}</code>,{" "}
        <code>{"{{clientMessage}}"}</code>, <code>{"{{decisionNote}}"}</code>,{" "}
        <code>{"{{requestReference}}"}</code>. Les mêmes variables de séjour et
        d’options sont disponibles dans tous les modèles de réservation.
      </p>
      {bookingEmailTemplateKeys.map((key) => (
        <details key={key} className="settings-sms-text-row">
          <summary>
            <strong>{bookingEmailTemplates[key].label}</strong>
          </summary>
          <label className="field">
            Sujet
            <input
              type="text"
              value={templates[key].subject}
              disabled={disabled}
              onChange={(event) => onChange(key, "subject", event.target.value)}
            />
          </label>
          <label className="field">
            Corps du message
            <textarea
              rows={12}
              value={templates[key].body}
              disabled={disabled}
              onChange={(event) => onChange(key, "body", event.target.value)}
            />
          </label>
        </details>
      ))}
    </div>
  );
}
