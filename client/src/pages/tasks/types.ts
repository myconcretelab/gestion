export type Category = "short" | "long";
import type { TaskReminderSettings, UrgencyLevel } from "./taskUrgency";
export type CompensationMode = "none" | "flat_rate" | "time";
export type ActionStatus = "planned" | "in_progress" | "done";
export type ActionTask = {
  created_by_id?: string | null;
  created_by_name?: string | null;
  urgency_level?: UrgencyLevel;
  urgency_stopped_at?: string | null;
  urgency_first_sent_at?: string | null;
  id: string;
  title: string;
  gite_id: string;
  gite_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  status: ActionStatus;
  starts_at: string;
  due_at: string;
  note: string;
  template_id: string | null;
  category: Category;
  compensation_mode: CompensationMode;
  compensation_amount: number | null;
  spent_minutes: number | null;
};
export type ActionTemplate = {
  id: string;
  gite_id: string;
  title: string;
  trigger_event: "arrival" | "departure";
  starts_offset_days: number;
  due_offset_days: number;
  start_time: string;
  due_time: string;
  assignment_mode: "unassigned" | "fixed" | "rotation";
  default_assignee_id: string | null;
  rotation_assignee_ids: string[];
  enabled: boolean;
  category: Category;
  compensation_mode: CompensationMode;
  compensation_amount: number | null;
  default_minutes: number | null;
};
export type Shortcut = {
  key: string;
  title: string;
  category: Category;
  note: string;
  enabled: boolean;
};
export type ActionResponse = {
  reminder_settings?: TaskReminderSettings;
  tasks: ActionTask[];
  templates: ActionTemplate[];
  gites: { id: string; nom: string }[];
  assignees: { id: string; name: string }[];
  can_manage: boolean;
  can_edit_compensation: boolean;
  current_user_id: string | null;
  shortcuts: Shortcut[];
  shortcut_catalog: Shortcut[];
};
export const parisDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000)
    .toISOString()
    .slice(0, 10);
export const displayDate = (value: string) =>
  new Date(value).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
export const emptyTemplate = (giteId: string): Omit<ActionTemplate, "id"> => ({
  gite_id: giteId,
  title: "",
  trigger_event: "departure",
  starts_offset_days: 0,
  due_offset_days: 0,
  start_time: "09:00",
  due_time: "17:00",
  assignment_mode: "unassigned",
  default_assignee_id: null,
  rotation_assignee_ids: [],
  enabled: true,
  category: "short",
  compensation_mode: "none",
  compensation_amount: 0,
  default_minutes: null,
});
