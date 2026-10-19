import { useState } from "react";
import ActionsPanel from "./ActionsPanel";

const parisDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000)
    .toISOString()
    .slice(0, 10);

export default function TasksPage() {
  const today = parisDay();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 335));

  return (
    <div className="cleaning-page tasks-page">
      <header className="cleaning-page__header tasks-page__header">
        <div>
          <span className="cleaning-page__eyebrow">Organisation des gîtes</span>
          <h1>Tâches</h1>
          <p>
            Les petites attentions d’aujourd’hui, les projets de demain. Tout
            est au même endroit.
          </p>
        </div>
        <details className="tasks-page__period">
          <summary>
            Période de suivi ·{" "}
            {new Date(`${from}T12:00:00`).toLocaleDateString("fr-FR")} —{" "}
            {new Date(`${to}T12:00:00`).toLocaleDateString("fr-FR")}
          </summary>
          <div className="cleaning-page__dates">
            <label>
              Du{" "}
              <input
                type="date"
                value={from}
                min={addDays(to, -366)}
                max={to}
                onChange={(event) => {
                  if (event.target.value && event.target.validity.valid)
                    setFrom(event.target.value);
                }}
              />
            </label>
            <label>
              Au{" "}
              <input
                type="date"
                value={to}
                min={from}
                max={addDays(from, 366)}
                onChange={(event) => {
                  if (event.target.value && event.target.validity.valid)
                    setTo(event.target.value);
                }}
              />
            </label>
          </div>
        </details>
      </header>
      <ActionsPanel from={from} to={to} />
    </div>
  );
}
