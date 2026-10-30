import { useState } from "react";
import { Link } from "react-router-dom";
import { categoryLabel, formatReportValue } from "@contrats/shared";
import { canCurrentUserAccessPage } from "../../../utils/auth";
import type { ReportWorkspace } from "./ReportsPage";
import ReportPageHeader from "./ReportPageHeader";
import "./ota.css";

export default function UndatedPaymentsPage({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const [search, setSearch] = useState("");
  const [future, setFuture] = useState(false);
  const [limit, setLimit] = useState(50);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const rows = workspace.state.operations
    .filter(
      (row) =>
        row.basis === "payment" &&
        !row.paymentDate &&
        (future ? row.stayDate > today : row.stayDate <= today) &&
        `${row.guest} ${row.propertyLabel} ${row.channel}`
          .toLocaleLowerCase("fr")
          .includes(search.toLocaleLowerCase("fr")),
    )
    .sort(
      (a, b) =>
        b.stayDate.localeCompare(a.stayDate) || a.id.localeCompare(b.id),
    );
  return (
    <>
      <ReportPageHeader
        title="Versements à dater"
        back={{ to: workspace.href(), label: "Tous les rapports" }}
        actions={
          workspace.canEdit ? (
            <Link to={workspace.href("/import-airbnb")} className="rp-button">
              Importer un relevé Airbnb
            </Link>
          ) : undefined
        }
      />
      <section className="rp-panel ota-upload">
        <p>
          Ces versements n’ont pas de date d’encaissement et restent hors des
          totaux. Les montants automatiques sont des estimations. Un import ou
          la saisie du versement réel permet de les rattacher à une période.
        </p>
        <div className="rp-filter-tabs">
          <button
            type="button"
            className={!future ? "is-active" : ""}
            aria-pressed={!future}
            onClick={() => {
              setFuture(false);
              setLimit(50);
            }}
          >
            Séjours commencés
          </button>
          <button
            type="button"
            className={future ? "is-active" : ""}
            aria-pressed={future}
            onClick={() => {
              setFuture(true);
              setLimit(50);
            }}
          >
            Séjours à venir
          </button>
        </div>
        <label className="rp-field">
          Rechercher
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setLimit(50);
            }}
          />
        </label>
        <p>{rows.length} opération(s) dans cette sélection.</p>
        <div className="ota-table-scroll">
          <table className="ota-table">
            <thead>
              <tr>
                <th>Réservation</th>
                <th>Séjour et catégorie</th>
                <th>Montant hors total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.guest}</strong>
                    <span>
                      {row.propertyLabel} · {row.channel}
                    </span>
                  </td>
                  <td>
                    {row.stayDate}
                    <span>{categoryLabel(row.category)}</span>
                  </td>
                  <td>
                    {formatReportValue({ kind: "custom" }, row.amountCents)}
                    <span>{row.reviewReason}</span>
                  </td>
                  <td>
                    {canCurrentUserAccessPage("reservations") &&
                    row.reservationId ? (
                      <Link
                        to={`/reservations/${encodeURIComponent(row.reservationId)}/reglements?back=${encodeURIComponent(workspace.href("/versements-a-dater"))}`}
                      >
                        Compléter le règlement
                      </Link>
                    ) : (
                      "Accès aux règlements requis"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <button
            type="button"
            className="rp-button rp-button--secondary"
            onClick={() => setLimit((value) => value + 50)}
          >
            Afficher 50 lignes supplémentaires
          </button>
        )}
      </section>
    </>
  );
}
