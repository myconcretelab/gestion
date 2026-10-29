import type { ReportWorkspace } from "./ReportsPage";
import type { EvaluatedOperation, ReportIssue } from "./reportModel";
import { canCurrentUserAccessPage } from "../../../utils/auth";
import { buildMobileReservationEditorHref } from "../../../pages/shared/mobileReservationEditor";

export const canAccessReportSource = (
  issue: ReportIssue,
  row?: EvaluatedOperation,
) =>
  canCurrentUserAccessPage(
    issue.kind === "operator"
      ? row?.propertyId === "unassigned"
        ? "reservations"
        : "gites"
      : issue.kind === "fiscal"
        ? "settings"
        : issue.kind === "settings" || issue.kind === "correction"
          ? "statistics"
          : "reservations",
  );
export function sourceCorrectionHref(
  workspace: ReportWorkspace,
  reportId: string,
  row: EvaluatedOperation,
  issue: ReportIssue,
) {
  const back = workspace.href(`/${reportId}`);
  if (issue.kind === "fiscal")
    return `/parametres/entreprises?entreprise=${encodeURIComponent(issue.sourceId ?? "")}&back=${encodeURIComponent(back)}`;
  if (issue.kind === "settings" || issue.kind === "correction")
    return workspace.href(`/${reportId}/modifier`);
  if (issue.kind === "operator" && row.propertyId !== "unassigned")
    return `/gites?gite=${encodeURIComponent(row.propertyId)}&section=base-fiche&back=${encodeURIComponent(back)}`;
  const reservationId = row.reservationId ?? row.reservation;
  if (row.categoryUncertain || issue.actionLabel === "Vérifier les prestations")
    return `${workspace.href(`/ventiler/${encodeURIComponent(reservationId)}`)}&rapport=${encodeURIComponent(reportId)}`;
  if (issue.kind === "operator")
    return buildMobileReservationEditorHref({
      mode: "edit",
      origin: "calendar",
      backHref: back,
      reservationId,
    });
  return `/reservations/${encodeURIComponent(reservationId)}/reglements?back=${encodeURIComponent(back)}`;
}
