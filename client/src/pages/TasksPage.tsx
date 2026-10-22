import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api";
import ActionsPanel from "./ActionsPanel";
import CleaningPage from "./CleaningPage";
import PlanningOrganizationsPanel from "./tasks/PlanningOrganizationsPanel";
import "./tasks/planning.css";

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
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    let active = true;
    void apiFetch<{ can_manage: boolean }>(
      `/action-tasks?from=${today}&to=${today}`,
    )
      .then((result) => {
        if (active) setCanManage(result.can_manage);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [today]);
  const [section, setSection] = useState<
    "interventions" | "automations" | "documents"
  >("interventions");
  const [filter, setFilter] = useState<
    "all" | "cleaning" | "tasks" | "presets"
  >(
    new URLSearchParams(window.location.search).get("view") === "cleaning"
      ? "cleaning"
      : "all",
  );
  const [revision, setRevision] = useState(0);
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 335));

  return (
    <div className="cleaning-page tasks-page">
      <header className="cleaning-page__header tasks-page__header">
        <div>
          <span className="cleaning-page__eyebrow">Organisation des gîtes</span>
          <h1>Tâches & plannings</h1>
          {canManage ? <Link to="/parametres/taches" className="tw-text-button">Réglages des rappels Telegram</Link> : null}
          <p>
            Ménages, prestations et relais : une organisation commune pour votre
            équipe.
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
      <div
        className="po-workspace-tabs"
        role="tablist"
        aria-label="Tâches et plannings"
      >
        {(
          [
            ["interventions", "Interventions"],
            ["automations", "Automatisations"],
            ["documents", "Plannings & PDF"],
          ] as const
        )
          .filter(([key]) => canManage || key === "interventions")
          .map(([key, label]) => (
            <button
              type="button"
              key={key}
              role="tab"
              aria-selected={section === key}
              id={`workspace-${key}`}
              aria-controls={`workspace-panel-${key}`}
              onClick={() => setSection(key)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                );
                const index = buttons.indexOf(event.currentTarget);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          buttons.length) %
                        buttons.length;
                buttons[next].focus();
                buttons[next].click();
              }}
            >
              {label}
            </button>
          ))}
      </div>
      <div
        role="tabpanel"
        id={`workspace-panel-${section}`}
        aria-labelledby={`workspace-${section}`}
      >
        {section === "interventions" ? (
          <>
            <div
              className="po-workspace-filter"
              role="group"
              aria-label="Type d’intervention"
            >
              {(
                [
                  ["all", "Tout"],
                  ["cleaning", "Ménages"],
                  ["tasks", "Autres interventions"],
                  ["presets", "Préenregistrées"],
                ] as const
              )
                .filter(([key]) => canManage || key !== "presets")
                .map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ))}
            </div>
            {(filter === "all" || filter === "cleaning") && (
              <section className="po-workspace-group">
                <h2>Ménages</h2>
                <CleaningPage
                  key={`cleaning-${revision}`}
                  embedded
                  range={{ from, to }}
                />
              </section>
            )}
            {(filter === "all" ||
              filter === "tasks" ||
              filter === "presets") && (
              <section className="po-workspace-group">
                {filter === "all" && <h2>Autres interventions</h2>}
                <ActionsPanel
                  key={`tasks-${revision}`}
                  from={from}
                  to={to}
                  section={filter === "presets" ? "presets" : "tasks"}
                />
              </section>
            )}
          </>
        ) : section === "automations" ? (
          <>
            <PlanningOrganizationsPanel
              mode="automations"
              onChanged={() => setRevision((value) => value + 1)}
            />
            <details className="po-routine">
              <summary>Organisation habituelle des ménages</summary>
              <CleaningPage embedded rulesOnly range={{ from, to }} />
            </details>
            <details className="po-routine">
              <summary>
                Autres automatisations habituelles, à chaque séjour
              </summary>
              <ActionsPanel from={from} to={to} section="automations" />
            </details>
          </>
        ) : (
          <PlanningOrganizationsPanel mode="documents" />
        )}
      </div>
    </div>
  );
}
