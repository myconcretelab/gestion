import type { Facture } from "./types";

export const invoiceLifecycleLabel = (
  invoice: Pick<Facture, "lifecycle_status" | "document_kind">,
) =>
  invoice.lifecycle_status === "draft"
    ? "Brouillon"
    : invoice.lifecycle_status === "issued"
      ? invoice.document_kind === "credit_note"
        ? "Émis et verrouillé"
        : "Émise et verrouillée"
      : "Historique verrouillée";

export const invoiceDisplayNumber = (
  invoice: Pick<Facture, "numero_facture" | "lifecycle_status">,
) =>
  invoice.lifecycle_status === "draft"
    ? "Brouillon — sans numéro définitif"
    : invoice.numero_facture;
