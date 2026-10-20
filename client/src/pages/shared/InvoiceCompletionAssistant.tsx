import FormCompletionAssistant from "./FormCompletionAssistant";
import {
  invoiceCompletionProgress,
  type InvoiceCompletionItem,
} from "./invoiceFormCompletion";

export default function InvoiceCompletionAssistant({
  items,
  checking,
}: {
  items: InvoiceCompletionItem[];
  checking: boolean;
}) {
  return (
    <FormCompletionAssistant
      items={items}
      progress={invoiceCompletionProgress(items)}
      checking={checking}
      ariaLabel="Assistant de création de facture"
      checkingLabel="Préparation du séjour…"
      description="Enregistrez votre brouillon sans attendre la validation finale."
      completeMessage="Tout est renseigné. Enregistrez puis ouvrez la fiche pour la vérification finale."
    />
  );
}
