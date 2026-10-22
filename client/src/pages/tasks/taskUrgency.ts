export type UrgencyLevel = 0 | 1 | 2;
export type TaskReminderSettings = {
  enabled: boolean;
  level_1_enabled: boolean;
  level_2_enabled: boolean;
  repeat_interval_minutes: number;
  recipient_policy: "creator_first" | "assignee_or_manager" | "manager_only";
  fallback_user_id: string | null;
  link_validity_days: number;
  message_heading: string;
  done_button_label: string;
  stop_button_label: string;
};
export const nextUrgencyLevel = (
  level: UrgencyLevel,
  settings?: TaskReminderSettings,
): UrgencyLevel => {
  if (settings && !settings.enabled) return 0;
  const levels: UrgencyLevel[] = [
    0,
    ...(!settings || settings.level_1_enabled ? [1 as const] : []),
    ...(!settings || settings.level_2_enabled ? [2 as const] : []),
  ];
  return levels.find((candidate) => candidate > level) ?? 0;
};
export const reminderFrequency = (minutes = 60) =>
  minutes === 60
    ? "toutes les heures"
    : minutes % 60 === 0
      ? `toutes les ${minutes / 60} heures`
      : `toutes les ${minutes} minutes`;
