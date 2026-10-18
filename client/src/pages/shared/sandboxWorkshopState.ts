import type { InvoiceFiscalInput } from "@contrats/shared";
export type WorkshopRun = {
  id: string;
  revision: number;
  createdAt: string;
  number: string;
  kind: "invoice" | "credit_note";
  date: string;
  writable: boolean;
  source: { reservationId: string; label: string; total: number };
  original: { id: string; number: string; date: string } | null;
  input: InvoiceFiscalInput;
  status: string;
  nativeSha: string | null;
  artifactSha: string | null;
  remoteId: string | null;
  error: string | null;
  issues: string[];
  validation: { valid: boolean; checks: number; failures: string[] } | null;
  events: Array<{ id: string; code: string; text: string; at: string }>;
  hasSendIntent: boolean;
  hasCredit: boolean;
};
export type WorkshopOverview = {
  available: boolean;
  active: boolean;
  reason: string | null;
  sources: WorkshopRun["source"][];
  runs: WorkshopRun[];
};
export const workshopStatus: Record<string, string> = {
  draft: "Brouillon de test",
  issuing: "Création du PDF en cours",
  issued: "Émis localement — aucun dépôt",
  preparing: "Conversion et validation en cours",
  ready: "Factur-X validé — prêt à relire",
  sending: "Envoi commencé — ne pas renvoyer",
  submitted: "Dépôt confirmé",
  send_unknown: "Résultat inconnu — renvoi bloqué",
  issue_failed: "Émission locale interrompue",
  prepare_failed: "Préparation refusée — aucun dépôt",
};
export function workshopStep(run: WorkshopRun | null) {
  if (!run) return 0;
  if (["draft", "issuing", "issue_failed"].includes(run.status)) return 1;
  if (["issued", "preparing", "prepare_failed", "ready"].includes(run.status))
    return 2;
  return 3;
}
export const canSendWorkshop = (run: WorkshopRun) =>
  run.writable && run.status === "ready" && !run.hasSendIntent;
