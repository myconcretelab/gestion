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
}: {
  value: UrgencyLevel;
  onChange: (value: UrgencyLevel) => void;
  disabled?: boolean;
  settings?: TaskReminderSettings;
}) {
  const hintId = useId();
  const next = nextUrgencyLevel(value, settings);
  const unavailable =
    settings &&
    (!settings.enabled ||
      (!settings.level_1_enabled && !settings.level_2_enabled));
  const description = unavailable
    ? "Les rappels sont désactivés dans les paramètres des tâches."
    : value === 0
      ? "À votre rythme. Aucun rappel Telegram."
      : value === 1
        ? "Un rappel Telegram au prochain départ des locataires."
        : `Au prochain départ, puis ${reminderFrequency(settings?.repeat_interval_minutes)}. Arrêt possible depuis le message.`;
  return (
    <div className="task-urgency">
      <button
        type="button"
        className={`task-urgency__button task-urgency__button--${value}`}
        disabled={disabled || Boolean(unavailable && value === 0)}
        aria-describedby={hintId}
        aria-label={`${value ? `Urgence ${value}` : "Sans urgence"}. Passer à ${next ? `urgence ${next}` : "sans urgence"}`}
        onClick={() => onChange(next)}
      >
        <span className="task-urgency__symbol" key={value} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {value ? (
              <>
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                {value === 2 ? <path d="M2 5 1 8M22 5l1 3" /> : null}
              </>
            ) : (
              <>
                <path d="M6.4 6.4A6 6 0 0 0 6 8c0 7-3 7-3 9h14M10 21h4M10 2.4A6 6 0 0 1 18 8c0 2.5.4 4 1 5M3 3l18 18" />
              </>
            )}
          </svg>
        </span>
        <span className="task-urgency__copy">
          <span>Rappel Telegram</span>
          <b>{value ? `Urgence ${value}` : "Sans urgence"}</b>
        </span>
        <span className="task-urgency__steps" aria-hidden="true">
          {[0, 1, 2].map((level) => (
            <i key={level} className={value === level ? "is-current" : ""} />
          ))}
        </span>
        <svg
          className="task-urgency__cycle"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M19 7A8 8 0 1 0 20 16M19 2v5h-5" />
        </svg>
      </button>
      <span id={hintId} className="task-urgency__hint" aria-live="polite">
        {description}
      </span>
    </div>
  );
}

export function TaskUrgencyBadge({
  level = 0,
  stopped,
  sent,
}: {
  level?: UrgencyLevel;
  stopped?: string | null;
  sent?: string | null;
}) {
  if (!level) return null;
  return (
    <span
      className={`task-urgency-badge task-urgency-badge--${level}`}
      title={
        stopped
          ? "Les rappels sont arrêtés ; la tâche reste à faire."
          : sent
            ? level === 1
              ? "Rappel envoyé"
              : "Rappels Telegram actifs"
            : "En attente du prochain départ des locataires"
      }
    >
      <span aria-hidden="true">
        {stopped ? "🔕" : level === 2 ? "🚨" : "🔔"}
      </span>{" "}
      Urgence {level}
      {stopped ? " · rappels arrêtés" : !sent ? " · au prochain départ" : ""}
    </span>
  );
}
