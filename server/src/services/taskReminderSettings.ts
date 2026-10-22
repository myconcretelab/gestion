import { z } from "zod";
import { getOrganizationId } from "./organizationContext.js";
import {
  readRuntimeSetting,
  writeRuntimeSetting,
} from "../modules/organizations/runtimeSettings.js";

export const taskReminderSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  level_1_enabled: z.boolean().default(true),
  level_2_enabled: z.boolean().default(true),
  repeat_interval_minutes: z.number().int().min(15).max(1440).default(60),
  recipient_policy: z
    .enum(["creator_first", "assignee_or_manager", "manager_only"])
    .default("creator_first"),
  fallback_user_id: z.string().trim().min(1).nullable().default(null),
  link_validity_days: z.number().int().min(1).max(90).default(30),
  message_heading: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .default("Tâches rapides à faire"),
  done_button_label: z.string().trim().min(2).max(40).default("✅ C’est fait"),
  stop_button_label: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .default("🔕 Arrêter les rappels"),
});
export type TaskReminderSettings = z.infer<typeof taskReminderSettingsSchema>;
const definition = {
  key: "task-urgency-reminders",
  version: 1,
  schema: taskReminderSettingsSchema,
  defaultValue: taskReminderSettingsSchema.parse({}),
};
export const readTaskReminderSettings =
  async (): Promise<TaskReminderSettings> =>
    taskReminderSettingsSchema.parse(
      await readRuntimeSetting(getOrganizationId(), definition),
    );
export const saveTaskReminderSettings = async (
  value: unknown,
): Promise<TaskReminderSettings> =>
  taskReminderSettingsSchema.parse(
    await writeRuntimeSetting(getOrganizationId(), definition, value),
  );
