import { createContext, useContext, useId, useRef, useState, type ReactNode, type RefObject } from "react";

const exampleValues: Record<string, string> = {
  greeting: "Bonjour Camille Martin,",
  clientName: "Camille Martin",
  locataireNom: "Camille Martin",
  giteName: "Gîte des Hortensias",
  giteNameWithPreposition: "au Gîte des Hortensias",
  giteReference: "au Gîte des Hortensias",
  giteSentence: " au Gîte des Hortensias.",
  giteAddress: "12 rue des Hortensias, 35380 Paimpont",
  ownerPhone: "06 00 00 00 00",
  documentNumber: "2026-001",
  documentUrl: "https://exemple.fr/document.pdf",
  documentDeliveryIntroContract: "ci-dessous le lien vers",
  documentDeliveryIntroSentence: "Je vous joins un lien de téléchargement vers votre facture.",
  documentDeliveryLabel: "Lien de téléchargement du contrat :",
  documentDeliveryValue: "https://exemple.fr/document.pdf",
  heureArrivee: "16h00",
  heureDepart: "10h00",
  dateDebutLong: "samedi 7 novembre 2026",
  dateEntreeLong: "samedi 7 novembre 2026",
  dateFinLong: "samedi 14 novembre 2026",
  dateSortieLong: "samedi 14 novembre 2026",
  dateEntree: "07/11/2026",
  dateSortie: "14/11/2026",
  stayDuration: "7 nuits",
  travellersSummary: "2 adultes et 2 enfants",
  arrhesMontant: "300 €",
  arrhesDateLimiteLong: "samedi 31 octobre 2026",
  arrhesInstruction: "Merci de régler les arrhes de 300 € avant le samedi 31 octobre 2026.",
  soldeMontant: "700 €",
  totalGlobal: "1 000 €",
  totalOptions: "80 €",
  paidAmount: "300 €",
  remainingAmount: "700 €",
  paymentSummary: "Montant réglé : 300 €. Reste à régler : 700 €.",
  stayPaymentInstruction: "Le solde de 700 € est à régler avant votre arrivée.",
  optionsSummary: "Draps : 2 × 15 € = 30 €\nMénage : 1 × 50 € = 50 €",
  optionsDraps: "Draps : 2 × 15 € = 30 €",
  optionsLingeToilette: "",
  optionsMenage: "Ménage : 1 × 50 € = 50 €",
  optionsDepartTardif: "",
  optionsChiens: "",
  beddingReminder: "Pensez à apporter votre linge de toilette.",
  activitiesList: "Balade en forêt de Brocéliande.\nDécouverte de Paimpont.",
  guideUrl: "https://exemple.fr/guide",
  destinationUrl: "https://exemple.fr/destination",
  holdExpiresAt: "31 octobre 2026 à 18h00",
  clientDetails: "Camille Martin · camille@exemple.fr · 06 00 00 00 00",
  clientMessage: "Nous arriverons vers 17h.",
  decisionNote: "Le gîte est indisponible aux dates demandées.",
  requestReference: "Référence de réservation : RES-2026-001",
};

type PreviewContextValue = {
  text: string;
  setText: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement>;
  insertVariable: (key: string) => void;
};

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function EmailTextPreviewProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const insertVariable = (key: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? start;
    const variable = `{{${key}}}`;
    setText(text.slice(0, start) + variable + text.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };
  return (
    <PreviewContext.Provider value={{ text, setText, inputRef, insertVariable }}>
      {children}
    </PreviewContext.Provider>
  );
}

export function EmailVariable({ name }: { name: string }) {
  const preview = useContext(PreviewContext);
  const tooltipId = useId();
  const example = exampleValues[name];
  return (
    <span className="email-variable">
      <button
        type="button"
        className="email-variable__button"
        aria-label={`Insérer {{${name}}} dans le texte à tester`}
        aria-describedby={tooltipId}
        onMouseDown={event => event.preventDefault()}
        onClick={() => preview?.insertVariable(name)}
      >
        {`{{${name}}}`}
      </button>
      <span id={tooltipId} role="tooltip" className="email-variable__popover">
        Exemple : {example === "" ? "(vide si l’option n’est pas choisie)" : example ?? "Aucun exemple disponible"}
      </span>
    </span>
  );
}

export default function EmailTextPreview() {
  const { text, setText, inputRef } = useContext(PreviewContext)!;
  const unknownVariables = [...new Set(
    [...text.matchAll(/{{(\w+)}}/g)]
      .map(match => match[1])
      .filter(key => !Object.prototype.hasOwnProperty.call(exampleValues, key)),
  )];
  const result = text.replace(/{{(\w+)}}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(exampleValues, key) ? exampleValues[key] : placeholder,
  );

  return (
    <div className="card settings-card settings-card--blue settings-card--span-12">
      <div className="section-title">Tester une phrase</div>
      <p className="field-hint">
        Écrivez ou collez un texte avec des variables : l’aperçu se met à jour immédiatement.
        Les valeurs sont fictives et leur disponibilité dépend du type d’email.
        Cliquez sur une variable de la liste pour l’insérer ici ; survolez-la pour voir un exemple. Ce test ne modifie pas vos modèles.
      </p>
      <label className="field">
        Texte à tester
        <textarea ref={inputRef} rows={3} value={text} onChange={event => setText(event.target.value)} />
      </label>
      <div className="field">
        <span>Aperçu avec des valeurs d’exemple</span>
        <div className="note" role="status" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {result || "Saisissez une phrase pour voir le résultat."}
        </div>
      </div>
      {unknownVariables.length > 0 && (
        <p className="field-hint">
          Variables sans valeur d’exemple : {unknownVariables.map(key => `{{${key}}}`).join(", ")}.
          Vérifiez leur nom ; elles restent visibles dans cet aperçu.
        </p>
      )}
    </div>
  );
}
