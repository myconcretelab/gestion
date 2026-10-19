import assert from "node:assert/strict";
import test from "node:test";
import prisma, { systemPrisma } from "../src/db/prisma.js";
import { runWithOrganization } from "../src/services/organizationContext.js";
import {
  readTaskShortcuts,
  resolveTaskShortcut,
  saveTaskShortcuts,
  taskShortcutCatalogSchema,
} from "../src/services/taskShortcuts.js";

const preset = {
  key: "soap",
  title: "Apporter du savon",
  category: "short" as const,
  note: "Dans le placard",
  enabled: true,
};

test("la bibliothèque valide les noms, catégories, consignes, clés uniques et limites", () => {
  assert.equal(
    taskShortcutCatalogSchema.parse([{ ...preset, title: "  Savon  " }])[0]
      .title,
    "Savon",
  );
  for (const items of [
    [{ ...preset, title: " " }],
    [{ ...preset, category: "urgent" }],
    [{ ...preset, note: "x".repeat(2001) }],
    [{ ...preset, key: "../foo" }],
    [preset, preset],
    Array.from({ length: 81 }, (_, i) => ({ ...preset, key: `key-${i}` })),
  ])
    assert.equal(taskShortcutCatalogSchema.safeParse(items).success, false);
  assert.deepEqual(taskShortcutCatalogSchema.parse([]), []);
});

test("seuls les raccourcis actifs sont utilisables et leur contenu fait autorité", () => {
  assert.deepEqual(resolveTaskShortcut([preset], "soap"), preset);
  assert.equal(
    resolveTaskShortcut([{ ...preset, enabled: false }], "soap"),
    null,
  );
  assert.equal(resolveTaskShortcut([preset], "unknown"), null);
});

test("l’ajout rapide copie le raccourci enregistré et refuse un raccourci masqué sans toucher aux tâches existantes", async () => {
  const { default: router } =
    await import("../src/modules/operations/actionTasks.js");
  const handler = (router as any).stack.find(
    (layer: any) => layer.route?.path === "/tasks/quick",
  ).route.stack[0].handle;
  const original = {
    extends: systemPrisma.$extends,
    gite: prisma.gite.findUnique,
    create: prisma.actionTask.create,
    find: prisma.actionTask.findUnique,
  };
  let catalog = [{ ...preset, category: "long" }];
  const writes: any[] = [];
  try {
    systemPrisma.$extends = (() => ({
      organizationRuntimeSetting: {
        findFirst: async () => ({ value_json: JSON.stringify(catalog) }),
      },
    })) as any;
    prisma.gite.findUnique = (async () => ({
      id: "gite-a",
      nom: "La Grée",
    })) as any;
    prisma.actionTask.create = (async ({ data }: any) => {
      writes.push(data);
      return { id: "task-a" };
    }) as any;
    prisma.actionTask.findUnique = (async () => ({
      id: "task-a",
      ...writes.at(-1),
      updatedAt: new Date(),
      assignee_id: null,
      compensation_amount: 0,
      completed_at: null,
    })) as any;
    const invoke = async () => {
      const response = {
        statusCode: 200,
        body: null as any,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(body: unknown) {
          this.body = body;
          return this;
        },
      };
      let error: unknown;
      await handler(
        {
          headers: {},
          body: {
            gite_id: "gite-a",
            shortcut_key: "soap",
            title: "Ancien titre",
            category: "short",
            note: "Anciennes consignes",
          },
        },
        response,
        (reason: unknown) => {
          error = reason;
        },
      );
      assert.equal(error, undefined);
      return response;
    };
    assert.equal((await invoke()).statusCode, 201);
    assert.equal(writes[0].title, preset.title);
    assert.equal(writes[0].note, preset.note);
    assert.equal(writes[0].category, "long");
    assert.ok(
      writes[0].due_at.getTime() - writes[0].starts_at.getTime() >
        29 * 86400000,
    );
    catalog = [{ ...preset, category: "long", enabled: false }];
    assert.equal((await invoke()).statusCode, 409);
    catalog = [];
    assert.equal((await invoke()).statusCode, 409);
    assert.equal(writes.length, 1);
  } finally {
    systemPrisma.$extends = original.extends;
    prisma.gite.findUnique = original.gite;
    prisma.actionTask.create = original.create;
    prisma.actionTask.findUnique = original.find;
  }
});

test("la bibliothèque est persistante, ordonnée et strictement isolée par organisation", async () => {
  const original = systemPrisma.$extends;
  const rows = new Map<string, any>();
  let concurrentUpdate = false;
  // Exercise the real tenant extension and runtime-setting serialization without a live database.
  systemPrisma.$extends = ((extension: any) => ({
    organizationRuntimeSetting: {
      findFirst: (args: any) =>
        extension.query.$allModels.$allOperations({
          model: "OrganizationRuntimeSetting",
          operation: "findFirst",
          args,
          query: (scoped: any) =>
            rows.get(scoped.where.organization_id) ?? null,
        }),
      create: (args: any) =>
        extension.query.$allModels.$allOperations({
          model: "OrganizationRuntimeSetting",
          operation: "create",
          args,
          query: (scoped: any) => {
            const row = {
              id: `setting-${scoped.data.organization_id}`,
              ...scoped.data,
            };
            rows.set(row.organization_id, row);
            return row;
          },
        }),
      updateMany: (args: any) =>
        extension.query.$allModels.$allOperations({
          model: "OrganizationRuntimeSetting",
          operation: "updateMany",
          args,
          query: (scoped: any) => {
            const row = rows.get(scoped.where.organization_id);
            if (
              concurrentUpdate ||
              row?.id !== scoped.where.id ||
              JSON.stringify(row.value_json) !==
                JSON.stringify(scoped.where.value_json.equals)
            )
              return { count: 0 };
            rows.set(scoped.where.organization_id, { ...row, ...scoped.data });
            return { count: 1 };
          },
        }),
    },
  })) as any;
  const within = <T>(organizationId: string, fn: () => T) =>
    runWithOrganization({ organizationId, source: "test" }, fn);
  try {
    const defaults = await within("org-a", readTaskShortcuts);
    assert.ok(defaults.some((item) => item.key === "hand-soap"));
    const catalog = [
      preset,
      {
        ...preset,
        key: "paint",
        title: "Peindre",
        category: "long",
        enabled: false,
      },
    ];
    await within("org-a", () => saveTaskShortcuts(catalog, defaults));
    assert.deepEqual(await within("org-a", readTaskShortcuts), catalog);
    assert.deepEqual(await within("org-b", readTaskShortcuts), defaults);
    // PostgreSQL returns JSON values; SQLite returns the serialized text.
    rows.get("org-a").value_json = catalog;
    assert.deepEqual(await within("org-a", readTaskShortcuts), catalog);
    await assert.rejects(
      () => within("org-a", () => saveTaskShortcuts([], defaults)),
      { status: 409 },
    );
    concurrentUpdate = true;
    await assert.rejects(
      () => within("org-a", () => saveTaskShortcuts([], catalog)),
      { status: 409 },
    );
    concurrentUpdate = false;
    await within("org-a", () => saveTaskShortcuts([], catalog));
    assert.deepEqual(await within("org-a", readTaskShortcuts), []);
    assert.deepEqual(await within("org-b", readTaskShortcuts), defaults);
    await assert.rejects(() =>
      within("org-a", () => saveTaskShortcuts([preset, preset], [])),
    );
    assert.deepEqual(await within("org-a", readTaskShortcuts), []);
  } finally {
    systemPrisma.$extends = original;
  }
});
