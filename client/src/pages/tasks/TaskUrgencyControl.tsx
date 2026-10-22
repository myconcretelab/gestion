import { useId } from "react";
import {
  nextUrgencyLevel,
  reminderFrequency,
  type TaskReminderSettings,
  type UrgencyLevel,
} from "./taskUrgency";

export default function TaskUrgencyControl({
  value,
  onChange,
  disabled = false,
  settings,
  taskTitle,
  stopped,
  showHint = false,
}: {
  value: UrgencyLevel;
  onChange: (value: UrgencyLevel) => void;
  disabled?: boolean;
  settings?: TaskReminderSettings;
  taskTitle?: string;
  stopped?: string | null;
  showHint?: boolean;
}) {
  const hintId = useId();
  const next = nextUrgencyLevel(value, settings);
  const unavailable =
    settings &&
    (!settings.enabled ||
      (!settings.level_1_enabled && !settings.level_2_enabled));
  const description = unavailable
    ? "Les rappels sont désactivés dans les paramètres des tâches."
    : stopped && value
      ? "Rappels arrêtés. Cette tâche reste à faire."
      : value === 0
        ? "Aucun rappel pour cette tâche."
        : value === 1
          ? "Un rappel au prochain départ des locataires."
          : `Au prochain départ, puis ${reminderFrequency(settings?.repeat_interval_minutes)}.`;
  const label = `${taskTitle ? `Urgence pour « ${taskTitle} »` : "Urgence de cette tâche"} : ${value ? `niveau ${value}` : "désactivée"}`;
  return (
    <>
      <button
        type="button"
        className={`task-urgency__button task-urgency__button--${value}${stopped && value ? " is-paused" : ""}`}
        disabled={disabled || Boolean(unavailable && value === 0)}
        aria-describedby={showHint ? hintId : undefined}
        aria-label={`${label}. Passer à ${next ? `urgence ${next}` : "sans urgence"}`}
        title={`${label}. ${description} Cliquer pour ${next ? `passer au niveau ${next}` : "désactiver"}.`}
        onClick={() => onChange(next)}
      >
        <span className="task-urgency__symbol" key={value} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
            {value === 2 ? <path d="M2 5 1 8M22 5l1 3" /> : null}
          </svg>
        </span>
        {value ? (
          <span className="task-urgency__level" aria-hidden="true">
            {value}
          </span>
        ) : null}
      </button>
      {showHint ? (
        <span id={hintId} className="task-urgency__hint" aria-live="polite">
          {description}
        </span>
      ) : null}
    </>
  );
}
