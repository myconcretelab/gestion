import { Link } from "react-router-dom";
import type {
  EvaluatedOperation,
  NightRegister,
  NightRegisterRow,
} from "@contrats/shared";
import { canCurrentUserAccessPage } from "../../../utils/auth";
import { reservationPaymentsHref } from "../../../utils/reservationNavigation";
import ReportNightRegisterCompletion from "./ReportNightRegisterCompletion";
import type { ReportWorkspace } from "./ReportsPage";

export default function ReportNightRegisterIssues({
  data,
  operations,
  workspace,
  month,
  onSaved,
}: {
  data: NightRegister;
  operations: EvaluatedOperation[];
  workspace: ReportWorkspace;
  month: string;
  onSaved: () => void;
}) {
  const stays = new Map<
    string,
    { row: NightRegisterRow; issues: Set<string> }
  >();
  for (const row of data.rows) {
    if (!row.issues.length) continue;
    const stay = stays.get(row.reservationId) ?? {
      row,
      issues: new Set<string>(),
    };
    row.issues.forEach((issue) => stay.issues.add(issue));
    stays.set(row.reservationId, stay);
  }
  const guests = new Map(
    operations.map((row) => [row.reservationId, row.guest]),
  );
  const canAccessReservations = canCurrentUserAccessPage("reservations");
  return (
    <section
      id="rp-night-issues"
      className="rp-night-issues"
      aria-labelledby="rp-night-issues-heading"
    >
      <h3 id="rp-night-issues-heading">Séjours à compléter ({stays.size})</h3>
      <ul className="rp-night-issues__stays">
        {[...stays.values()].map(({ row, issues }) => (
          <li key={row.reservationId}>
            <strong>{guests.get(row.reservationId) || row.reference}</strong>
            <small>
              {row.propertyName} · {row.arrival.split("-").reverse().join("/")}{" "}
              au {row.departure.split("-").reverse().join("/")}
            </small>
            <ul>
              {[...issues].map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            {canAccessReservations && (
              <Link
                className="rp-text-button"
                to={reservationPaymentsHref(row.reservationId, row.arrival)}
              >
                Voir les règlements
              </Link>
            )}
          </li>
        ))}
      </ul>
      <ReportNightRegisterCompletion
        key={data.revision}
        data={data}
        workspace={workspace}
        month={month}
        onSaved={onSaved}
      />
    </section>
  );
}
