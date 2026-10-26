import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

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
  documentDeliveryIntroSentence:
    "Je vous joins un lien de téléchargement vers votre facture.",
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
  arrhesInstruction:
    "Merci de régler les arrhes de 300 € avant le samedi 31 octobre 2026.",
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

export function EmailTextPreviewProvider({
  children,
}: {
  children: ReactNode;
}) {
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
      input?.setSelectionRange(
        start + variable.length,
        start + variable.length,
      );
    });
  };
  return (
    <PreviewContext.Provider
      value={{ text, setText, inputRef, insertVariable }}
    >
      {children}
    </PreviewContext.Provider>
  );
}

const variableGroups = [
  {
    label: "Séjour",
    names: [
      "heureArrivee",
      "heureDepart",
      "dateDebutLong",
      "dateFinLong",
      "dateEntreeLong",
      "dateSortieLong",
      "dateEntree",
      "dateSortie",
      "stayDuration",
      "travellersSummary",
    ],
  },
  {
    label: "Client et gîte",
    names: [
      "greeting",
      "clientName",
      "locataireNom",
      "clientDetails",
      "clientMessage",
      "giteName",
      "giteNameWithPreposition",
      "giteReference",
      "giteSentence",
      "giteAddress",
      "ownerPhone",
    ],
  },
  {
    label: "Montants et règlement",
    names: [
      "totalGlobal",
      "totalOptions",
      "arrhesMontant",
      "arrhesDateLimiteLong",
      "arrhesInstruction",
      "soldeMontant",
      "paidAmount",
      "remainingAmount",
      "paymentSummary",
      "stayPaymentInstruction",
    ],
  },
  {
    label: "Options",
    names: [
      "optionsSummary",
      "optionsDraps",
      "optionsLingeToilette",
      "optionsMenage",
      "optionsDepartTardif",
      "optionsChiens",
      "beddingReminder",
    ],
  },
  {
    label: "Documents et liens",
    names: [
      "documentNumber",
      "documentUrl",
      "documentDeliveryIntroContract",
      "documentDeliveryIntroSentence",
      "documentDeliveryLabel",
      "documentDeliveryValue",
      "activitiesList",
      "guideUrl",
      "destinationUrl",
      "holdExpiresAt",
      "decisionNote",
      "requestReference",
    ],
  },
];

function EmailVariables() {
  const { insertVariable } = useContext(PreviewContext)!;
  const [group, setGroup] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{
    name: string;
    top: number;
    left: number;
  } | null>(null);
  const touch = useRef(false);
  const example = (name: string) =>
    exampleValues[name] || "Vide si l’option n’est pas choisie.";
  return (
    <div className="email-variables">
      <div className="email-variables__heading">
        <strong>Insérer une variable</strong>
        <span className="field-hint">
          Survolez pour voir un exemple. Sur téléphone, touchez puis insérez.
        </span>
      </div>
      <div
        className="email-variables__groups"
        aria-label="Catégories de variables"
      >
        {variableGroups.map((item, index) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={group === index}
            onClick={() => {
              setGroup(index);
              setSelected(null);
              setHovered(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="email-variables__list">
        {variableGroups[group].names.map((name) => (
          <button
            type="button"
            key={name}
            className="email-variable__button"
            aria-label={`Insérer {{${name}}}`}
            aria-pressed={selected === name}
            onPointerDown={(event) => {
              touch.current = event.pointerType === "touch";
            }}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={(event) => {
              if (touch.current) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setHovered({
                name,
                top: Math.min(rect.bottom + 8, window.innerHeight - 150),
                left: Math.max(
                  16,
                  Math.min(rect.left, window.innerWidth - 296),
                ),
              });
            }}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setSelected(name)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSelected(null);
                setHovered(null);
              }
            }}
            onClick={() => {
              setSelected(name);
              setHovered(null);
              if (!touch.current) insertVariable(name);
            }}
          >
            {`{{${name}}}`}
          </button>
        ))}
      </div>
      {hovered && (
        <div
          className="email-variable__popover"
          role="tooltip"
          style={{ top: hovered.top, left: hovered.left }}
        >
          <strong>Exemple</strong>
          <span>{example(hovered.name)}</span>
        </div>
      )}
      {selected && (
        <div className="email-variables__example">
          <div>
            <strong>{`{{${selected}}}`}</strong>
            <p>{example(selected)}</p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => insertVariable(selected)}
          >
            Insérer dans le texte
          </button>
        </div>
      )}
      <p className="field-hint">
        Les variables disponibles dépendent du type d’email. Les options non
        choisies restent vides.
      </p>
    </div>
  );
}

export default function EmailTextPreview() {
  const { text, setText, inputRef } = useContext(PreviewContext)!;
  const unknownVariables = [
    ...new Set(
      [...text.matchAll(/{{(\w+)}}/g)]
        .map((match) => match[1])
        .filter(
          (key) => !Object.prototype.hasOwnProperty.call(exampleValues, key),
        ),
    ),
  ];
  const result = text.replace(/{{(\w+)}}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(exampleValues, key)
      ? exampleValues[key]
      : placeholder,
  );

  return (
    <div className="card settings-card settings-card--blue settings-card--span-12 email-preview">
      <div className="section-title">Tester une phrase</div>
      <p className="field-hint">
        Écrivez une phrase, ajoutez des variables et découvrez le résultat avec
        des valeurs fictives. Vos modèles restent inchangés.
      </p>
      <div className="email-preview__workspace">
        <label className="field">
          Texte à tester
          <textarea
            ref={inputRef}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div className="field">
          <span>Aperçu avec des valeurs d’exemple</span>
          <div className="email-preview__result" role="status">
            {result || "Saisissez une phrase pour voir le résultat."}
          </div>
        </div>
      </div>
      <EmailVariables />
      {unknownVariables.length > 0 && (
        <p className="field-hint">
          Variables sans valeur d’exemple :{" "}
          {unknownVariables.map((key) => `{{${key}}}`).join(", ")}. Vérifiez
          leur nom ; elles restent visibles dans cet aperçu.
        </p>
      )}
    </div>
  );
}
