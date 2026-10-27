import type { CleaningBillingMode } from "@contrats/shared";

type Props = {
  value: CleaningBillingMode;
  onChange: (mode: CleaningBillingMode) => void;
};

const choices: { value: CleaningBillingMode; label: string }[] = [
  { value: "extra", label: "En supplément" },
  { value: "included", label: "Inclus" },
  { value: "gift", label: "Offert" },
];

export default function CleaningBillingControl({ value, onChange }: Props) {
  return (
    <div className="cleaning-billing">
      <span className="cleaning-billing__label">Facturation du ménage</span>
      <div
        className="cleaning-billing__choices"
        role="group"
        aria-label="Facturation du ménage"
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={value === choice.value}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <span className="field-hint" aria-live="polite">
        {value === "included"
          ? "Déjà compris dans le prix saisi, notamment via l’OTA. Aucun supplément."
          : value === "gift"
            ? "Prestation offerte au client. Aucun supplément."
            : "Le forfait ménage s’ajoute au prix du séjour."}
      </span>
    </div>
  );
}
