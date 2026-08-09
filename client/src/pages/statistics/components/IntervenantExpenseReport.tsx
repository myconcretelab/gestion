import { formatEuro } from "../../../utils/format";
import type { StatisticsIntervenantExpense } from "../statisticsUtils";

type IntervenantExpenseReportProps = {
  expenses: StatisticsIntervenantExpense[];
  periodLabel: string;
};

const formatExpenseMonth = (year: number, month: number) =>
  new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

const IntervenantExpenseReport = ({
  expenses,
  periodLabel,
}: IntervenantExpenseReportProps) => {
  const total = Math.round(
    expenses.reduce((sum, expense) => sum + expense.amount, 0) * 100,
  ) / 100;

  return (
    <section className="card stats-intervenant-expenses">
      <div className="stats-intervenant-expenses__header">
        <div>
          <p className="stats-expense-report__eyebrow">Suivi informatif</p>
          <h2>Frais des intervenants</h2>
          <p>
            Frais ponctuels enregistrés pour {periodLabel.toLocaleLowerCase("fr-FR")}.
            Ils ne sont pas inclus dans les frais ni les résultats des gîtes.
          </p>
        </div>
        <div className="stats-intervenant-expenses__total">
          <span>Total informatif</span>
          <strong>{formatEuro(total)}</strong>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="stats-empty-chart">
          Aucun frais d’intervenant sur cette période.
        </div>
      ) : (
        <div className="stats-intervenant-expenses__table-wrap">
          <table className="stats-expense-table">
            <thead>
              <tr>
                <th>Mois</th>
                <th>Intervenant</th>
                <th>Portée</th>
                <th>Note</th>
                <th>Montant</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td className="stats-intervenant-expenses__month">
                    {formatExpenseMonth(expense.year, expense.month)}
                  </td>
                  <td><strong>{expense.intervenant_nom}</strong></td>
                  <td>
                    <span className="stats-intervenant-expenses__scope">
                      {expense.scope === "gite"
                        ? expense.gite_nom || "Gîte supprimé"
                        : "Tous les gîtes"}
                    </span>
                  </td>
                  <td>{expense.notes || "—"}</td>
                  <td><strong>{formatEuro(expense.amount)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default IntervenantExpenseReport;
