import { z } from "zod";
import { ACTION_TASK_SHORTCUTS } from "./actionTasks.js";
import { getOrganizationId } from "./organizationContext.js";
import { readRuntimeSetting } from "../modules/organizations/runtimeSettings.js";
import { tenantDatabase } from "../modules/system/tenantRepository.js";

export const taskShortcutSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  title: z.string().trim().min(2).max(120),
  category: z.enum(["short", "long"]),
  note: z.string().trim().max(2000),
  enabled: z.boolean(),
});
export const taskShortcutCatalogSchema = z
  .array(taskShortcutSchema)
  .max(80)
  .refine(
    (items) => new Set(items.map((item) => item.key)).size === items.length,
    "Chaque tâche préenregistrée doit avoir un identifiant unique.",
  );
export type TaskShortcut = z.infer<typeof taskShortcutSchema>;
const definition = {
  key: "task-shortcuts",
  version: 1,
  schema: taskShortcutCatalogSchema,
  defaultValue: ACTION_TASK_SHORTCUTS.map((item) => ({
    ...item,
    note: "",
    enabled: true,
  })),
};

export const readTaskShortcuts = () =>
  readRuntimeSetting(getOrganizationId(), definition);
export async function saveTaskShortcuts(
  items: unknown,
  expectedItems: unknown,
) {
  const parsed = taskShortcutCatalogSchema.parse(items);
  const expected = taskShortcutCatalogSchema.parse(expectedItems);
  const database = tenantDatabase(getOrganizationId());
  const row = await database.organizationRuntimeSetting.findFirst({
    where: { key: definition.key },
  });
  const current = row
    ? taskShortcutCatalogSchema.parse(JSON.parse(row.value_json))
    : definition.defaultValue;
  const conflict = () =>
    Object.assign(
      new Error(
        "La bibliothèque a été modifiée entre-temps. Rechargez la page avant de réessayer.",
      ),
      { status: 409 },
    );
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw conflict();
  const value = {
    version: definition.version,
    value_json: JSON.stringify(parsed),
    is_secret: false,
  };
  if (row) {
    const updated = await database.organizationRuntimeSetting.updateMany({
      where: { id: row.id, value_json: row.value_json },
      data: value,
    });
    if (!updated.count) throw conflict();
  } else {
    try {
      await database.organizationRuntimeSetting.create({
        data: {
          organization_id: getOrganizationId(),
          key: definition.key,
          ...value,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw conflict();
      throw error;
    }
  }
  return parsed;
}

// A preset is copied when a task is created, never linked to an existing task.
export function resolveTaskShortcut(items: TaskShortcut[], key: string) {
  return items.find((item) => item.key === key && item.enabled) ?? null;
}
