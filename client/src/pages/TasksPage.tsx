import { useState } from "react";
import ActionsPanel from "./ActionsPanel";

const parisDay = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

export default function TasksPage() {
  const today = parisDay();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 335));

  return <div className="cleaning-page tasks-page">
    <header className="cleaning-page__header tasks-page__header">
      <div>
        <span className="cleaning-page__eyebrow">Organisation des gîtes</span>
        <h1>Tâches</h1>
        <p>Notez immédiatement ce qu’il faut faire, puis confiez-le à la bonne personne au bon moment.</p>
      </div>
      <div className="cleaning-page__dates">
        <label>Du <input type="date" value={from} min={addDays(to, -366)} max={to} onChange={(event) => { if (event.target.value && event.target.validity.valid) setFrom(event.target.value); }} /></label>
        <label>Au <input type="date" value={to} min={from} max={addDays(from, 366)} onChange={(event) => { if (event.target.value && event.target.validity.valid) setTo(event.target.value); }} /></label>
      </div>
    </header>
    <ActionsPanel from={from} to={to} />
  </div>;
}
